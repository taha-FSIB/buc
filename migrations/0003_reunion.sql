-- The reunion itself: 28-29 August 2026 at Eastern University.
--
-- Modelled as a table rather than hardcoded so the committee can fix a time
-- or a venue without a deploy, and so the same structure carries the next
-- reunion without a migration.

CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  starts_on    TEXT NOT NULL,          -- ISO date, e.g. 2026-08-28
  ends_on      TEXT,
  venue        TEXT,
  address      TEXT,
  map_url      TEXT,
  intro        TEXT,                   -- warm paragraph at the top
  -- Only one event is "current" at a time; that is the one /reunion shows.
  is_current   INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  rsvp_by      TEXT,                   -- ISO date the committee wants answers by
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Schedule lines, e.g. "9:30 am — Registration and tea".
CREATE TABLE event_schedule (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  day_label  TEXT NOT NULL,            -- "Friday 28 August"
  time_label TEXT,                     -- "9:30 am"
  title      TEXT NOT NULL,
  detail     TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_schedule_event ON event_schedule (event_id, sort_order);

-- One answer per member per event. Changing your mind updates the row rather
-- than adding another, so the headcount is always a straight COUNT.
CREATE TABLE rsvps (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  answer        TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'maybe')),
  -- Members in their 70s travelling from abroad, often with family.
  guests        INTEGER NOT NULL DEFAULT 0 CHECK (guests >= 0),
  dietary       TEXT,
  accessibility TEXT,
  note          TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (event_id, member_id)
);

CREATE INDEX idx_rsvps_event ON rsvps (event_id, answer);

-- The reunion, ready for the committee to edit in place.
INSERT INTO events (id, name, starts_on, ends_on, venue, address, is_current, intro)
VALUES (
  'reunion2026',
  'Our Reunion',
  '2026-08-28',
  '2026-08-29',
  'Eastern University, Sri Lanka',
  'Vantharumoolai, Chenkalady, Batticaloa',
  1,
  'Forty-five years after we first walked in, we are going back. Two days together at the place where it all started.'
);
