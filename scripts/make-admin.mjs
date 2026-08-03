/**
 * Create the first admin, who then invites everyone else from inside the app.
 *
 *   node scripts/make-admin.mjs "Full Name" email@example.com "their passphrase"
 *   node scripts/make-admin.mjs "Full Name" email@example.com "pass" --remote
 *
 * Prints the SQL and runs it through wrangler. Uses the same PBKDF2
 * parameters as src/lib/auth.ts — if you change them there, change them here.
 *
 * That instruction was not enough on its own. This ran at 210,000 iterations
 * while workerd refuses anything above 100,000, and because Node has no such
 * limit the account was created without complaint and only failed later, at
 * every sign-in, as a 500. The assertion below now fails here instead.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PBKDF2_ITERATIONS = 100_000;
const WORKERS_MAX_ITERATIONS = 100_000;
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

if (PBKDF2_ITERATIONS > WORKERS_MAX_ITERATIONS) {
  console.error(
    `This would write a hash at ${PBKDF2_ITERATIONS} iterations, which Node can\n`
    + `produce but Cloudflare Workers cannot verify (its ceiling is\n`
    + `${WORKERS_MAX_ITERATIONS}). The account would be created and then be\n`
    + `impossible to sign in to. Lower PBKDF2_ITERATIONS here and in\n`
    + `src/lib/auth.ts to match.`,
  );
  process.exit(1);
}

const [, , fullName, email, passphrase, ...rest] = process.argv;
const remote = rest.includes('--remote');

if (!fullName || !email || !passphrase) {
  console.error('Usage: node scripts/make-admin.mjs "Full Name" email@example.com "passphrase" [--remote]');
  process.exit(1);
}
if (passphrase.length < 8) {
  console.error('Passphrase must be at least 8 characters.');
  process.exit(1);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const newId = (n = 12) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'],
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256,
);

const stored = `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt.buffer)}$${hex(bits)}`;
const esc = (s) => s.replace(/'/g, "''");

const sql = `INSERT INTO members (id, full_name, email, passphrase_hash, role, status)
VALUES ('${newId()}', '${esc(fullName)}', '${esc(email.toLowerCase())}', '${stored}', 'admin', 'active')
ON CONFLICT (email) DO UPDATE SET
  passphrase_hash = excluded.passphrase_hash, role = 'admin', status = 'active';`;

// Passed as a file rather than --command: on Windows the shell splits a
// multi-line SQL argument on whitespace and wrangler rejects the fragments.
const sqlPath = join(tmpdir(), `buc-admin-${Date.now()}.sql`);
writeFileSync(sqlPath, sql, 'utf8');

try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'buc_alumni', remote ? '--remote' : '--local', '--file', sqlPath],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
} finally {
  // The passphrase hash lives in here — never leave it lying around.
  unlinkSync(sqlPath);
}

console.log(`\nAdmin ready: ${email}`);
console.log(remote ? 'Created on the live database.' : 'Created on the local database.');
