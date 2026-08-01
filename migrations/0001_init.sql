-- BUC Alumni Portal — initial schema
--
-- PRIVACY MODEL (the core invariant of this project):
--   A post is visible ONLY to its author, unless a matching row exists in
--   `post_shares`. There is no "visibility" column that can be flipped to
--   make something world-readable. Reach is additive and explicit:
--     * share with a person  -> post_shares(audience_kind='member', audience_id=<member>)
--     * share with a group   -> post_shares(audience_kind='group',  audience_id=<group>)
--     * share publicly       -> post_shares(audience_kind='public', audience_id=NULL)
--                               AND public_submissions.status = 'approved'
--   Public reach therefore requires TWO independent facts: the member asked
--   for it, and an admin approved it. Neither alone is sufficient.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  -- What we actually call them on screen. "Raj" beats "Rajendran M."
  preferred_name  TEXT,
  email           TEXT NOT NULL UNIQUE,
  -- NULL until the member sets a passphrase on first sign-in.
  passphrase_hash TEXT,
  -- WhatsApp number, since that is where the batch already lives.
  phone           TEXT,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'admin')),
  status          TEXT NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'active', 'suspended')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_members_email ON members (email);

-- ---------------------------------------------------------------------------
-- Sessions & sign-in codes
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  -- SHA-256 of the cookie token; the raw token is never stored.
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  user_agent    TEXT
);

CREATE INDEX idx_sessions_member ON sessions (member_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- One-time codes emailed for first sign-in and passphrase reset. Members in
-- their 70s forget passphrases; this is the "no dead ends" escape hatch.
CREATE TABLE login_codes (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('first_login', 'reset')),
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_login_codes_member ON login_codes (member_id, purpose);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'interest'
                 CHECK (kind IN ('interest', 'project', 'family', 'other')),
  -- 'open'    : any member may join themselves
  -- 'request' : member asks, an owner approves
  -- 'invite'  : owners add people directly
  join_policy  TEXT NOT NULL DEFAULT 'request'
                 CHECK (join_policy IN ('open', 'request', 'invite')),
  -- Whether the group's existence is discoverable in the group directory.
  -- Never implies its posts are readable — that is post_shares' job.
  listed       INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
  created_by   TEXT NOT NULL REFERENCES members (id),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('member', 'owner')),
  state      TEXT NOT NULL DEFAULT 'active'
               CHECK (state IN ('active', 'pending', 'invited')),
  joined_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX idx_group_members_member ON group_members (member_id, state);

-- ---------------------------------------------------------------------------
-- Posts (vault items, stories, memories)
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  title         TEXT,
  body          TEXT,
  -- Primary medium; a post may still carry mixed media rows.
  medium        TEXT NOT NULL DEFAULT 'text'
                  CHECK (medium IN ('text', 'photo', 'audio', 'video')),
  -- Language of the member's own words, for transcript routing.
  language      TEXT NOT NULL DEFAULT 'en'
                  CHECK (language IN ('en', 'ta', 'si')),
  -- Drafts are invisible even to people the post is shared with.
  state         TEXT NOT NULL DEFAULT 'draft'
                  CHECK (state IN ('draft', 'posted', 'archived')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_posts_author ON posts (author_id, state, created_at DESC);

-- ---------------------------------------------------------------------------
-- Share grants — the ONLY thing that widens visibility past the author
-- ---------------------------------------------------------------------------
CREATE TABLE post_shares (
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  audience_kind TEXT NOT NULL
                  CHECK (audience_kind IN ('member', 'group', 'public')),
  -- member id or group id; NULL only when audience_kind = 'public'.
  audience_id   TEXT,
  granted_by    TEXT NOT NULL REFERENCES members (id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (audience_kind = 'public' AND audience_id IS NULL) OR
    (audience_kind IN ('member', 'group') AND audience_id IS NOT NULL)
  )
);

-- A given post reaches a given audience at most once.
CREATE UNIQUE INDEX idx_post_shares_unique
  ON post_shares (post_id, audience_kind, IFNULL(audience_id, ''));
CREATE INDEX idx_post_shares_audience
  ON post_shares (audience_kind, audience_id);

-- ---------------------------------------------------------------------------
-- Admin moderation of public content
-- ---------------------------------------------------------------------------
-- One row per post that has been put forward for the public site. A post is
-- public ONLY when it has both a 'public' share row and status='approved'.
CREATE TABLE public_submissions (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL UNIQUE REFERENCES posts (id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL REFERENCES members (id),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by  TEXT REFERENCES members (id),
  reviewed_at  INTEGER,
  -- Shown back to the member so a rejection is never a dead end.
  review_note  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_public_submissions_status
  ON public_submissions (status, created_at);

-- ---------------------------------------------------------------------------
-- Media (R2 objects)
-- ---------------------------------------------------------------------------
CREATE TABLE media (
  id                TEXT PRIMARY KEY,
  post_id           TEXT REFERENCES posts (id) ON DELETE CASCADE,
  owner_id          TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  r2_key            TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL
                      CHECK (kind IN ('photo', 'audio', 'video', 'pdf')),
  mime_type         TEXT NOT NULL,
  byte_size         INTEGER NOT NULL,
  original_filename TEXT,
  width             INTEGER,
  height            INTEGER,
  duration_seconds  INTEGER,
  -- Free-text description of the image, for screen readers and for members
  -- who cannot make out a small photo on a phone.
  alt_text          TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_media_post ON media (post_id);
CREATE INDEX idx_media_owner ON media (owner_id);

-- ---------------------------------------------------------------------------
-- Transcripts / translations
-- ---------------------------------------------------------------------------
-- English post -> Tamil + Sinhala. Tamil or Sinhala post -> English.
-- Supplementary only; never navigation.
CREATE TABLE transcripts (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  language   TEXT NOT NULL CHECK (language IN ('en', 'ta', 'si')),
  body       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'machine'
               CHECK (source IN ('machine', 'human')),
  -- Machine output stays hidden until a person has read it, so we never put
  -- a mangled translation of someone's memory in front of the batch.
  approved   INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (post_id, language)
);

-- ---------------------------------------------------------------------------
-- Reunion souvenir flipbook
-- ---------------------------------------------------------------------------
CREATE TABLE flipbook_pages (
  id            TEXT PRIMARY KEY,
  -- NULL for non-member pages (foreword, group photos, articles).
  member_id     TEXT REFERENCES members (id) ON DELETE SET NULL,
  page_type     TEXT NOT NULL DEFAULT 'member'
                  CHECK (page_type IN ('member', 'article', 'photo', 'divider')),
  heading       TEXT,
  blurb         TEXT,
  then_media_id TEXT REFERENCES media (id) ON DELETE SET NULL,
  now_media_id  TEXT REFERENCES media (id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'approved')),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_flipbook_order ON flipbook_pages (status, sort_order);

-- ---------------------------------------------------------------------------
-- Audit log for admin actions
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES members (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_kind TEXT,
  target_id   TEXT,
  detail      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
