/** Short, URL-safe, non-guessable ids. UUIDs are ugly in a URL an elder may read aloud. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/1/i/l/o — read-aloud safe

export function newId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Human-friendly invite code, e.g. "BUC-4KPQ-8MTX". Read over WhatsApp or a phone call. */
export function newInviteCode(): string {
  const block = () => newId(4).toUpperCase();
  return `BUC-${block()}-${block()}`;
}
