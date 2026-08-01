-- Phase 1 — member accounts, profiles, and passwordless sign-in.
--
-- Two things happen here.
--
-- 1. Members gain the profile fields the Directory needs, plus two explicit
--    switches for showing an email address or a phone number. Both default to
--    0. Privacy by default applies to a member's contact details exactly as it
--    applies to their memories: nothing is shown to the batch until the member
--    says so.
--
-- 2. `login_links` carries single-use sign-in links, so nobody has to remember
--    a passphrase. Passphrases remain as a fallback for anyone whose email is
--    unreliable — which, for this batch, is most of them.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Profile fields
-- ---------------------------------------------------------------------------
-- Year this member finished at BUC. Most of the pioneer batch share one year,
-- but repeats and deferrals mean it cannot be assumed.
ALTER TABLE members ADD COLUMN batch_year INTEGER;

-- Free text, e.g. "Scarborough, Canada". Not a country code: half the batch
-- would have to think about which entry is theirs, and nothing here needs to
-- sort or group by it.
ALTER TABLE members ADD COLUMN location TEXT;

ALTER TABLE members ADD COLUMN bio TEXT;

-- The default must be NULL for SQLite to accept a REFERENCES clause on an
-- ADD COLUMN with foreign keys enabled.
ALTER TABLE members ADD COLUMN photo_media_id TEXT
  REFERENCES media (id) ON DELETE SET NULL;

ALTER TABLE members ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0
  CHECK (show_email IN (0, 1));
ALTER TABLE members ADD COLUMN show_phone INTEGER NOT NULL DEFAULT 0
  CHECK (show_phone IN (0, 1));

-- ---------------------------------------------------------------------------
-- Single-use sign-in links
-- ---------------------------------------------------------------------------
CREATE TABLE login_links (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- SHA-256 of the token that appears in the URL. The raw token is never
  -- stored, so a leaked database cannot be replayed into anybody's account.
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL DEFAULT 'signin'
                CHECK (purpose IN ('signin', 'invite')),
  expires_at  INTEGER NOT NULL,
  -- Set the moment the link is used. Single use is enforced by an UPDATE that
  -- requires this to be NULL, so two simultaneous clicks cannot both win.
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_login_links_member ON login_links (member_id, created_at);
