/**
 * Sessions and passphrases.
 *
 * Workers have no bcrypt/argon2, so passphrases use PBKDF2-SHA256 via WebCrypto
 * at 210,000 iterations (OWASP's 2023 floor for PBKDF2-SHA256). Session cookie
 * tokens are random 256-bit values; only their SHA-256 digest is stored, so a
 * leaked database still cannot be used to impersonate anyone.
 */

const PBKDF2_ITERATIONS = 210_000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days — few re-logins.
export const SESSION_COOKIE = 'buc_session';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time comparison, so we never leak a hash byte-by-byte via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(
  passphrase: string,
  salt: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

/** Produce a storable `pbkdf2$<iterations>$<salt>$<hash>` string. */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passphrase, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${hash}`;
}

export async function verifyPassphrase(
  passphrase: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const [scheme, , saltHex, expected] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !expected) return false;
  const actual = await pbkdf2(passphrase, fromHex(saltHex));
  return timingSafeEqual(actual, expected);
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export interface Viewer {
  id: string;
  full_name: string;
  preferred_name: string | null;
  role: 'member' | 'admin';
}

/** Create a session row and return the raw token for the cookie. */
export async function createSession(
  db: D1Database,
  memberId: string,
  userAgent: string | null,
): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  await db
    .prepare(
      `INSERT INTO sessions (id, member_id, expires_at, user_agent)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(await sha256Hex(token), memberId, expiresAt, userAgent)
    .run();

  return token;
}

/** Resolve a cookie token to a member, or null. Suspended members are cut off. */
export async function resolveSession(
  db: D1Database,
  token: string | undefined,
): Promise<Viewer | null> {
  if (!token) return null;

  const viewer = await db
    .prepare(
      `SELECT m.id, m.full_name, m.preferred_name, m.role
         FROM sessions s
         JOIN members m ON m.id = s.member_id
        WHERE s.id = ?1
          AND s.expires_at > unixepoch()
          AND m.status = 'active'`,
    )
    .bind(await sha256Hex(token))
    .first<Viewer>();

  return viewer ?? null;
}

export async function destroySession(
  db: D1Database,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE id = ?1')
    .bind(await sha256Hex(token))
    .run();
}

export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ');
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** A 6-digit sign-in code. Short enough to read aloud over WhatsApp. */
export function generateLoginCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
    .padStart(6, '0');
}

export async function hashLoginCode(code: string): Promise<string> {
  return sha256Hex(code);
}
