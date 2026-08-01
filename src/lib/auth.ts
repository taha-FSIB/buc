/**
 * Sessions, sign-in links, and passphrases.
 *
 * Signing in is normally passwordless: the member types their email, receives
 * a single-use link, and clicks it. A passphrase is the fallback for anyone
 * whose email is unreliable.
 *
 * Workers have no bcrypt/argon2, so passphrases use PBKDF2-SHA256 via WebCrypto
 * at 210,000 iterations (OWASP's 2023 floor for PBKDF2-SHA256). Session cookie
 * tokens and sign-in link tokens are random 256-bit values; only their SHA-256
 * digest is stored, so a leaked database still cannot be used to impersonate
 * anyone.
 */

import { newId } from './ids';

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
    // Cast: workers-types narrows BufferSource to views over a plain
    // ArrayBuffer, while Uint8Array is typed over ArrayBufferLike.
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
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

/* -- Single-use sign-in links ---------------------------------------------- */

/**
 * How long a link works for.
 *
 * The usual advice is 15 minutes. That is wrong for this audience: members
 * check email once a day, some have a grandchild read it to them, and an admin
 * may pass the link on over WhatsApp hours later. A short expiry here would
 * not buy security, it would produce a wall of "this link has expired" and a
 * batch of 70-year-olds concluding the site is broken. Single use plus a
 * hashed token is where the safety actually comes from.
 */
const SIGNIN_LINK_TTL = 60 * 60 * 24;       // 1 day
const INVITE_LINK_TTL = 60 * 60 * 24 * 14;  // 2 weeks

export type LinkPurpose = 'signin' | 'invite';

/**
 * Issue a link token. Any earlier unused link for this member is retired, so
 * only the newest email in an inbox ever works.
 */
export async function createLoginLink(
  db: D1Database,
  memberId: string,
  purpose: LinkPurpose,
): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const ttl = purpose === 'invite' ? INVITE_LINK_TTL : SIGNIN_LINK_TTL;

  await db.batch([
    db
      .prepare(
        `UPDATE login_links SET consumed_at = unixepoch()
          WHERE member_id = ?1 AND consumed_at IS NULL`,
      )
      .bind(memberId),
    db
      .prepare(
        `INSERT INTO login_links (id, member_id, token_hash, purpose, expires_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch() + ?5)`,
      )
      .bind(newId(), memberId, await sha256Hex(token), purpose, ttl),
  ]);

  return token;
}

export interface LinkTarget {
  member_id: string;
  full_name: string;
  preferred_name: string | null;
}

/**
 * Look a link up without spending it. Used to render the confirmation screen,
 * so that a mail scanner following the URL cannot burn somebody's only way in.
 */
export async function peekLoginLink(
  db: D1Database,
  token: string,
): Promise<LinkTarget | null> {
  const row = await db
    .prepare(
      `SELECT l.member_id, m.full_name, m.preferred_name
         FROM login_links l
         JOIN members m ON m.id = l.member_id
        WHERE l.token_hash = ?1
          AND l.consumed_at IS NULL
          AND l.expires_at > unixepoch()
          AND m.status != 'suspended'`,
    )
    .bind(await sha256Hex(token))
    .first<LinkTarget>();

  return row ?? null;
}

/**
 * Spend the link and return the member it belonged to, or null if it had
 * already been used or had expired. Single use is enforced inside the UPDATE
 * rather than by a read-then-write, so two clicks in quick succession cannot
 * both succeed.
 *
 * A member who was still 'invited' becomes 'active' here, and their invitation
 * code is burned: following the link IS the proof that the invitation reached
 * the right person.
 */
export async function consumeLoginLink(
  db: D1Database,
  token: string,
): Promise<{ memberId: string; firstSignIn: boolean } | null> {
  const spent = await db
    .prepare(
      `UPDATE login_links SET consumed_at = unixepoch()
        WHERE token_hash = ?1
          AND consumed_at IS NULL
          AND expires_at > unixepoch()
        RETURNING member_id`,
    )
    .bind(await sha256Hex(token))
    .first<{ member_id: string }>();

  if (!spent) return null;

  const member = await db
    .prepare(`SELECT status FROM members WHERE id = ?1`)
    .bind(spent.member_id)
    .first<{ status: string }>();

  if (!member || member.status === 'suspended') return null;

  const firstSignIn = member.status === 'invited';
  if (firstSignIn) {
    await db
      .prepare(
        `UPDATE members SET status = 'active', invite_code = NULL,
                            updated_at = unixepoch()
          WHERE id = ?1`,
      )
      .bind(spent.member_id)
      .run();
  }

  return { memberId: spent.member_id, firstSignIn };
}

/**
 * How many links this member has been sent recently. Anyone can type anyone
 * else's address into the sign-in form, so this is what stops that form being
 * used to flood a friend's inbox.
 */
export async function linksSentSince(
  db: D1Database,
  memberId: string,
  seconds: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_links
        WHERE member_id = ?1 AND created_at > unixepoch() - ?2`,
    )
    .bind(memberId, seconds)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

/** A 6-digit sign-in code. Short enough to read aloud over WhatsApp. */
export function generateLoginCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
    .padStart(6, '0');
}

export async function hashLoginCode(code: string): Promise<string> {
  return sha256Hex(code);
}
