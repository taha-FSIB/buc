-- Invite codes.
--
-- No email provider is wired up, and for this batch that is a feature rather
-- than a gap: everyone already talks daily on WhatsApp. An admin creates the
-- member, then sends or reads out a code like "BUC-4KPQ-8MTX". Same path for
-- a forgotten passphrase — the member asks on WhatsApp and an admin issues a
-- reset code. Nobody waits on a mail server, and nothing lands in a spam
-- folder that a 72-year-old will never find.

ALTER TABLE members ADD COLUMN invite_code TEXT;

CREATE UNIQUE INDEX idx_members_invite_code
  ON members (invite_code) WHERE invite_code IS NOT NULL;
