-- Phase 8 — the reunion page for people who are not members yet.
--
-- /reunion has always been readable without a session, but answering it was
-- not: an invitee with no account was told to sign in, which for somebody the
-- committee has only just tracked down is a dead end at the exact moment they
-- were willing to say yes.
--
-- Their answer lands here rather than in `rsvps`. The two are genuinely
-- different things and flattening them would be dishonest: a member's RSVP is
-- attached to an identity the site trusts, while this is a claim typed by
-- anyone on the internet. It needs a name and an address it does not have, it
-- can be a duplicate, and it usually wants to become an invitation.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Venue information, editable by the committee rather than by a developer
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN venue_notes TEXT;
ALTER TABLE events ADD COLUMN contact_note TEXT;

UPDATE events SET
  venue_notes =
    'The campus is at Vantharumoolai, about 15 km north of Batticaloa town on '
    || 'the Trincomalee road.' || char(10) || char(10)
    || 'Getting there: buses run from Batticaloa bus stand towards Chenkalady '
    || 'and Valaichchenai; ask for the university gate. A three-wheeler from '
    || 'Batticaloa takes about half an hour. If you are flying in, Colombo to '
    || 'Batticaloa is roughly seven hours by road.' || char(10) || char(10)
    || 'Parking: there is room inside the main gate. Tell us if you would like '
    || 'to be dropped closer to the hall.' || char(10) || char(10)
    || 'Staying: there are guest houses in Batticaloa town and a few rooms on '
    || 'campus. Say the word and we will help you arrange something.',
  contact_note =
    'Anything at all — travel, a room, getting about on the day — send us a '
    || 'message and one of the committee will come back to you.'
WHERE id = 'reunion2026';

-- ---------------------------------------------------------------------------
-- A starting schedule
-- ---------------------------------------------------------------------------
-- An outline, not a decision. Every line is editable from Admin -> The reunion,
-- which is the point: times and rooms will change several times before August
-- and none of that should need a deploy.
INSERT INTO event_schedule (id, event_id, day_label, time_label, title, detail, sort_order) VALUES
  ('sch1', 'reunion2026', 'Friday 28 August', '9:30 am', 'Registration and tea',
   'Come when you can. Somebody will be at the gate all morning.', 1),
  ('sch2', 'reunion2026', 'Friday 28 August', '11:00 am', 'Opening and welcome', NULL, 2),
  ('sch3', 'reunion2026', 'Friday 28 August', '12:30 pm', 'Lunch together', NULL, 3),
  ('sch4', 'reunion2026', 'Friday 28 August', '2:30 pm', 'Walking the campus',
   'The old lecture rooms, and whatever is left of them.', 4),
  ('sch5', 'reunion2026', 'Friday 28 August', '4:00 pm', 'The batch photograph',
   'All of us, in one place, for the first time in forty-five years.', 5),
  ('sch6', 'reunion2026', 'Friday 28 August', '7:00 pm', 'Dinner', NULL, 6),
  ('sch7', 'reunion2026', 'Saturday 29 August', '9:00 am', 'Morning tea', NULL, 7),
  ('sch8', 'reunion2026', 'Saturday 29 August', '10:00 am', 'Remembering those we have lost',
   'A quiet half hour.', 8),
  ('sch9', 'reunion2026', 'Saturday 29 August', '11:00 am', 'The souvenir, and what comes next',
   'Handing out the book, and talking about what we do from here.', 9),
  ('sch10', 'reunion2026', 'Saturday 29 August', '12:30 pm', 'Lunch and goodbyes', NULL, 10);

-- ---------------------------------------------------------------------------
-- Answers from people who do not have an account
-- ---------------------------------------------------------------------------
CREATE TABLE guest_rsvps (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  answer        TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'maybe')),
  guests        INTEGER NOT NULL DEFAULT 0 CHECK (guests >= 0),
  dietary       TEXT,
  accessibility TEXT,
  note          TEXT,
  -- SHA-256 of the sender's IP, never the address itself. Enough to rate-limit
  -- a flood; useless for identifying anybody afterwards.
  sender_hash   TEXT,
  -- Set once the committee has dealt with it: usually by inviting them, which
  -- also records which member account they became.
  handled_at    INTEGER,
  handled_by    TEXT REFERENCES members (id) ON DELETE SET NULL,
  member_id     TEXT REFERENCES members (id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_guest_rsvps_event ON guest_rsvps (event_id, handled_at, created_at);
CREATE INDEX idx_guest_rsvps_sender ON guest_rsvps (sender_hash, created_at);
