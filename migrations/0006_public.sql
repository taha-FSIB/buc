-- Phase 4 — the public face.
--
-- A Contact page that only prints an email address is a dead end for the
-- person using it: they cannot tell whether anyone received anything. This is
-- where messages from outside the batch land instead, so the committee sees
-- them on the admin dashboard and nothing depends on a mail server being
-- configured.
--
-- Expect a relative of a classmate, or somebody from the university. Expect
-- spam too, which is what the honeypot and the per-sender rate limit are for.

PRAGMA foreign_keys = ON;

CREATE TABLE public_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Optional: somebody may want to leave a memory without leaving an address.
  email       TEXT,
  body        TEXT NOT NULL,
  -- SHA-256 of the sender's IP, never the address itself. Enough to rate-limit
  -- a flood; useless for identifying anybody afterwards.
  sender_hash TEXT,
  handled_at  INTEGER,
  handled_by  TEXT REFERENCES members (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_public_messages_open ON public_messages (handled_at, created_at DESC);
CREATE INDEX idx_public_messages_sender ON public_messages (sender_hash, created_at);
