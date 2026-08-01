-- Phase 3 — groups get a face.
--
-- A cover photograph is the difference between a list of names and something
-- that looks like it belongs to people. It is stored like any other media, so
-- it inherits the same rule: served only through /media/:id, re-checked on
-- every request, never from a public bucket.
--
-- Who may see a cover: any signed-in member if the group is listed (it is in
-- the directory, so its existence is already public to the batch), and anyone
-- with a membership row otherwise. See canReadMedia in src/lib/visibility.ts.

PRAGMA foreign_keys = ON;

-- Default must be NULL for SQLite to accept a REFERENCES clause on ADD COLUMN.
ALTER TABLE groups ADD COLUMN cover_media_id TEXT
  REFERENCES media (id) ON DELETE SET NULL;
