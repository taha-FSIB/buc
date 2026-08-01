-- Phase 7 — the Communication Hub, and the audience the model was missing.
--
-- Everything a member posts still reaches people only through `post_shares`.
-- Until now the widest audience short of the public site was one group, so a
-- conversation meant for the whole batch had no way to be addressed. This adds
-- a fourth kind: 'batch' — every signed-in member, and nobody else.
--
-- It is deliberately NOT the same as 'public'. A batch share never leaves the
-- members' side of the site; the public pages still demand their own share row
-- and an admin approval, exactly as before.
--
-- Changing the CHECK means rebuilding the table: SQLite cannot alter a
-- constraint in place. Nothing has a foreign key pointing at post_shares, so
-- the rebuild is safe.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Channels — fixed, four of them, created here rather than by members
-- ---------------------------------------------------------------------------
CREATE TABLE channels (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO channels (id, slug, name, description, sort_order) VALUES
  ('ch_general',  'general',  'General Discussion',
   'Anything and everything, the way the WhatsApp group works — only this one keeps what you say.', 1),
  ('ch_projects', 'projects', 'Projects & Give-Back',
   'The scholarship fund, the library, anything we are doing for the university or for each other.', 2),
  ('ch_casual',   'casual',   'Casual Chat',
   'Jokes, birthdays, cricket, and how the grandchildren are getting on.', 3),
  ('ch_photos',   'photos',   'Photos',
   'Old photographs, new photographs, and anything you have found in a drawer.', 4);

-- ---------------------------------------------------------------------------
-- A thread is an ordinary post that happens to sit in a channel
-- ---------------------------------------------------------------------------
-- Reusing `posts` means threads get media, transcripts, and the same read rule
-- as everything else for free. No ON DELETE clause: the four channels are
-- fixtures, and a stray DELETE should fail loudly rather than quietly take a
-- few hundred conversations with it.
ALTER TABLE posts ADD COLUMN channel_id TEXT REFERENCES channels (id);

CREATE INDEX idx_posts_channel ON posts (channel_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Replies
-- ---------------------------------------------------------------------------
-- A reply has no visibility of its own — it is readable exactly when its
-- thread is, which is checked by asking visibility.ts about the thread. Giving
-- each reply its own post_shares row would mean thousands of rows all saying
-- the same thing.
CREATE TABLE channel_replies (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_channel_replies_post ON channel_replies (post_id, created_at);

-- ---------------------------------------------------------------------------
-- post_shares, rebuilt to admit audience_kind = 'batch'
-- ---------------------------------------------------------------------------
CREATE TABLE post_shares_new (
  id            TEXT PRIMARY KEY,
  post_id       TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  audience_kind TEXT NOT NULL
                  CHECK (audience_kind IN ('member', 'group', 'public', 'batch')),
  -- member id or group id; NULL for 'public' and 'batch', which name no one.
  audience_id   TEXT,
  granted_by    TEXT NOT NULL REFERENCES members (id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (audience_kind IN ('public', 'batch') AND audience_id IS NULL) OR
    (audience_kind IN ('member', 'group') AND audience_id IS NOT NULL)
  )
);

INSERT INTO post_shares_new (id, post_id, audience_kind, audience_id, granted_by, created_at)
  SELECT id, post_id, audience_kind, audience_id, granted_by, created_at FROM post_shares;

DROP TABLE post_shares;

ALTER TABLE post_shares_new RENAME TO post_shares;

-- A given post reaches a given audience at most once.
CREATE UNIQUE INDEX idx_post_shares_unique
  ON post_shares (post_id, audience_kind, IFNULL(audience_id, ''));
CREATE INDEX idx_post_shares_audience
  ON post_shares (audience_kind, audience_id);
