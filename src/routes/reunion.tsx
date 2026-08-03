import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, Panel, ErrorNotice } from '../views/layout';
import { requireAuth, requireAdmin, viewerOf } from '../lib/guard';
import { inviteMember, LinkHandout } from './admin';
import { emailConfigured } from '../lib/mailer';
import { newId } from '../lib/ids';

export const reunionRoutes = new Hono<AppBindings>();

interface EventRow {
  id: string; name: string; starts_on: string; ends_on: string | null;
  venue: string | null; address: string | null; map_url: string | null;
  intro: string | null; rsvp_by: string | null;
  venue_notes: string | null; contact_note: string | null;
}

const EVENT_COLUMNS =
  'id, name, starts_on, ends_on, venue, address, map_url, intro, rsvp_by, ' +
  'venue_notes, contact_note';

function currentEvent(db: D1Database) {
  return db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE is_current = 1 LIMIT 1`)
    .first<EventRow>();
}

const ANSWERS = [
  { code: 'yes',   label: 'Yes, I will be there' },
  { code: 'maybe', label: 'I hope so, but I cannot say yet' },
  { code: 'no',    label: 'Sadly I cannot come' },
] as const;

/** "28-29 August 2026" — written out, because 28/08 and 08/28 mean different
 *  things to a batch now spread across Sri Lanka, the UK, Canada and Australia. */
function humanDates(startsOn: string, endsOn: string | null): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  if (!endsOn || endsOn === startsOn) return fmt(startsOn);

  const a = new Date(`${startsOn}T00:00:00Z`);
  const b = new Date(`${endsOn}T00:00:00Z`);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}-${fmt(endsOn)}`;
  }
  return `${fmt(startsOn)} to ${fmt(endsOn)}`;
}

/** Whole days until the event, in UTC. Negative once it has passed. */
function daysUntil(startsOn: string): number {
  const then = Date.parse(`${startsOn}T00:00:00Z`);
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((then - now) / 86_400_000);
}

/* -- The reunion page ------------------------------------------------------ */
reunionRoutes.get('/reunion', async (c) => {
  const viewer = c.get('viewer');
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const [{ results: schedule }, rsvp] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT day_label, time_label, title, detail
           FROM event_schedule WHERE event_id = ?1 ORDER BY sort_order, time_label`,
      )
      .bind(event.id)
      .all<{ day_label: string; time_label: string | null; title: string; detail: string | null }>(),
    viewer
      ? c.env.DB
          .prepare('SELECT answer, guests FROM rsvps WHERE event_id = ?1 AND member_id = ?2')
          .bind(event.id, viewer.id)
          .first<{ answer: string; guests: number }>()
      : Promise.resolve(null),
  ]);

  const days = daysUntil(event.starts_on);
  const byDay = new Map<string, typeof schedule>();
  for (const line of schedule) {
    if (!byDay.has(line.day_label)) byDay.set(line.day_label, []);
    byDay.get(line.day_label)!.push(line);
  }

  /*
   * The sections are built from what this event actually has, so the keywords
   * in the navbar can never advertise a screen that is not there — an event
   * with no address must not offer "Where". Order matters: it is the order the
   * panels are written below, and the bead position is derived from the index.
   */
  const sections = [{ id: 'when', key: 'When' }];
  if (byDay.size > 0) sections.push({ id: 'programme', key: 'Programme' });
  if (event.address) sections.push({ id: 'where', key: 'Where' });
  if (event.contact_note) sections.push({ id: 'questions', key: 'Questions' });

  return c.html(
    <Layout title="The Reunion" viewer={viewer ?? null} tab="home" publicTab="reunion"
            description={`${event.name} — ${humanDates(event.starts_on, event.ends_on)}${event.venue ? `, ${event.venue}` : ''}.`}
            sections={sections} timeline>
      <Panel id="when">
      <p class="eyebrow">{humanDates(event.starts_on, event.ends_on)}</p>
      <h1 class="display-line">{event.name}</h1>
      <p class="page-intro" style="color:var(--ink)">
        {event.venue}
      </p>

      {days > 0 && (
        <div class="notice">
          {/* The number is its own element so motion.js can count up to it.
              With no JavaScript it is simply the number, already correct. */}
          <strong>
            {days === 1 ? 'Tomorrow' : (
              <>
                <span class="tally" data-count-to={String(days)}>{days}</span>
                {' days to go'}
              </>
            )}
          </strong>
          {event.rsvp_by && <p>Please let us know by {humanDates(event.rsvp_by, null)}.</p>}
        </div>
      )}
      {days === 0 && (
        <div class="notice"><strong>Today. We will see you there.</strong></div>
      )}

      {event.intro && <p class="page-intro">{event.intro}</p>}

      {viewer ? (
        <>
          {rsvp ? (
            <div class="card">
              <h2>
                {rsvp.answer === 'yes' ? 'You are coming'
                  : rsvp.answer === 'maybe' ? 'You said maybe'
                  : 'You are not able to come'}
              </h2>
              {rsvp.guests > 0 && (
                <p class="card-meta">
                  Bringing {rsvp.guests} {rsvp.guests === 1 ? 'other person' : 'others'}
                </p>
              )}
              <a class="btn btn-secondary btn-block" href="/reunion/rsvp">
                Change my answer
              </a>
            </div>
          ) : (
            <a class="btn btn-block" href="/reunion/rsvp">Tell us if you are coming</a>
          )}
        </>
      ) : (
        <>
          {/* Not a dead end for somebody the committee has only just tracked
              down. They can answer here and now; an account can follow. */}
          <a class="btn btn-block" href="/reunion/rsvp">Tell us if you are coming</a>
          <p class="page-intro" style="margin-top:1rem">
            One of the batch already? <a href="/signin">Sign in</a> and your
            answer will be saved against your name.
          </p>
        </>
      )}

      </Panel>

      {byDay.size > 0 && (
        <Panel id="programme" list>
          <p class="eyebrow">What is happening</p>
          <h2>The programme</h2>
          {[...byDay.entries()].map(([day, lines]) => (
            <>
              <h3 style="margin-top:var(--space-md)">{day}</h3>
              <ul class="ruled">
                {lines.map((l) => (
                  <li>
                    <span class="k">{l.time_label ?? '—'}</span>
                    <p class="v">
                      <strong>{l.title}</strong>
                      {l.detail ?? ''}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ))}
        </Panel>
      )}

      {event.address && (
        <Panel id="where">
          <p class="eyebrow">Where</p>
          <h2>{event.venue}</h2>
          <p class="page-intro">{event.address}</p>
          {event.venue_notes?.split(/\n{2,}/).map((para) => <p>{para}</p>)}
          {event.map_url && (
            <p style="margin-top:var(--space-md)">
              <a class="btn btn-secondary" href={event.map_url}
                 target="_blank" rel="noopener noreferrer">Open the map</a>
            </p>
          )}
        </Panel>
      )}

      {event.contact_note && (
        <Panel id="questions">
          <p class="eyebrow">Any questions</p>
          <h2>Ask us</h2>
          <p class="page-intro">{event.contact_note}</p>
          <a class="btn" href="/contact">Send us a message</a>
        </Panel>
      )}
    </Layout>,
  );
});

/* -- RSVP for somebody without an account ---------------------------------- */
/**
 * The committee is still tracking people down. Somebody found last week has no
 * account, and telling them to sign in at the moment they were willing to say
 * yes is the worst possible answer.
 *
 * Their reply lands in `guest_rsvps` rather than in `rsvps`. The two are
 * genuinely different: one is an answer from a known member, the other is a
 * claim typed by anyone on the internet. The admin screen keeps them apart,
 * and offers to turn the second into the first.
 */
const MAX_PER_HOUR = 10;

const GuestRsvpForm = (props: {
  sent?: boolean;
  error?: string;
  values?: Record<string, string>;
}) => (
  <Layout title="Are you coming?" viewer={null} publicTab="reunion"
          back={{ href: '/reunion', label: 'The Reunion' }}>
    {props.sent ? (
      <>
        <h1>Thank you — we have it</h1>
        <div class="notice" role="status">
          <strong>Your answer is with the committee.</strong>
          <p>
            If you left an address, one of us will be in touch — and we will
            send you a way in to the members side of this site, where the rest
            of the batch is.
          </p>
        </div>
        <a class="btn btn-block" href="/reunion">Back to the reunion</a>
      </>
    ) : (
      <>
        <h1>Are you coming?</h1>
        <p class="page-intro">
          You do not need an account. Tell us who you are and we will do the
          rest — this only helps us plan the food and the seating.
        </p>

        {props.error && (
          <ErrorNotice title="That did not send."><p>{props.error}</p></ErrorNotice>
        )}

        <form method="post" action="/reunion/rsvp">
          <div class="field">
            <label for="full_name">Your name</label>
            <input id="full_name" name="full_name" type="text" maxlength={120}
                   value={props.values?.full_name ?? ''} required />
          </div>
          <div class="field">
            <label for="email">Your email</label>
            <span class="hint">So we can send you the details, and a way in.</span>
            <input id="email" name="email" type="email" maxlength={200}
                   value={props.values?.email ?? ''} />
          </div>
          <div class="field">
            <label for="phone">Your telephone or WhatsApp number</label>
            <span class="hint">Optional, and often quicker than email.</span>
            <input id="phone" name="phone" type="tel" maxlength={40}
                   value={props.values?.phone ?? ''} />
          </div>

          <fieldset class="choices">
            <legend>Your answer</legend>
            {ANSWERS.map((a) => (
              <label class="check">
                <input type="radio" name="answer" value={a.code}
                       checked={(props.values?.answer ?? 'yes') === a.code} />
                <span>{a.label}</span>
              </label>
            ))}
          </fieldset>

          <div class="field">
            <label for="guests">Is anyone coming with you?</label>
            <span class="hint">Put 0 if you are coming alone.</span>
            <input id="guests" name="guests" type="number" min="0" max="20"
                   inputmode="numeric" value={props.values?.guests ?? '0'} />
          </div>
          <div class="field">
            <label for="dietary">Anything you cannot eat?</label>
            <input id="dietary" name="dietary" type="text" maxlength={200}
                   value={props.values?.dietary ?? ''} />
          </div>
          <div class="field">
            <label for="accessibility">Anything that would make the days easier?</label>
            <span class="hint">
              Trouble with stairs, a seat near the front, help from the car park.
            </span>
            <input id="accessibility" name="accessibility" type="text" maxlength={200}
                   value={props.values?.accessibility ?? ''} />
          </div>
          <div class="field">
            <label for="note">Anything else you would like us to know?</label>
            <textarea id="note" name="note" style="min-height:6rem">{props.values?.note ?? ''}</textarea>
          </div>

          {/* Left empty by people, filled in by bots. */}
          <div class="visually-hidden" aria-hidden="true">
            <label for="website">Leave this box empty</label>
            <input id="website" name="website" type="text" tabindex={-1} autocomplete="off" />
          </div>

          <button class="btn btn-block" type="submit">Send my answer</button>
        </form>
      </>
    )}
  </Layout>
);

// Registered before the member routes below: a signed-in visitor falls
// straight through to the form that knows who they are.
reunionRoutes.get('/reunion/rsvp', async (c, next) => {
  if (c.get('viewer')) return next();
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();
  return c.html(<GuestRsvpForm />);
});

reunionRoutes.post('/reunion/rsvp', async (c, next) => {
  if (c.get('viewer')) return next();

  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const form = await c.req.formData();
  const values = {
    full_name: String(form.get('full_name') ?? '').trim(),
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    phone: String(form.get('phone') ?? '').trim(),
    answer: String(form.get('answer') ?? ''),
    guests: String(form.get('guests') ?? '0'),
    dietary: String(form.get('dietary') ?? '').trim(),
    accessibility: String(form.get('accessibility') ?? '').trim(),
    note: String(form.get('note') ?? '').trim(),
  };

  // A bot filled the hidden field. Answer exactly as if it had worked.
  if (String(form.get('website') ?? '').trim()) return c.html(<GuestRsvpForm sent />);

  if (!values.full_name) {
    return c.html(
      <GuestRsvpForm values={values}
                     error="Please tell us your name, so we know who is coming." />,
      400,
    );
  }
  if (!ANSWERS.some((a) => a.code === values.answer)) {
    return c.html(
      <GuestRsvpForm values={values} error="Please choose one of the three answers." />,
      400,
    );
  }

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const senderHash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  const recent = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM guest_rsvps
        WHERE sender_hash = ?1 AND created_at > unixepoch() - 3600`,
    )
    .bind(senderHash)
    .first<{ n: number }>();

  // Over the limit: still say thank you. Telling a flooder they have been
  // spotted only tells them to change address.
  if ((recent?.n ?? 0) >= MAX_PER_HOUR) return c.html(<GuestRsvpForm sent />);

  await c.env.DB
    .prepare(
      `INSERT INTO guest_rsvps
         (id, event_id, full_name, email, phone, answer, guests,
          dietary, accessibility, note, sender_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      newId(), event.id, values.full_name, values.email || null, values.phone || null,
      values.answer, Math.max(0, Math.min(20, Number(values.guests) || 0)),
      values.dietary || null, values.accessibility || null, values.note || null,
      senderHash,
    )
    .run();

  return c.html(<GuestRsvpForm sent />);
});

/* -- RSVP, for a member ---------------------------------------------------- */
reunionRoutes.get('/reunion/rsvp', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const rsvp = await c.env.DB
    .prepare(
      `SELECT answer, guests, dietary, accessibility, note
         FROM rsvps WHERE event_id = ?1 AND member_id = ?2`,
    )
    .bind(event.id, viewer.id)
    .first<{ answer: string; guests: number; dietary: string | null; accessibility: string | null; note: string | null }>();

  return c.html(
    <Layout title="Are you coming?" viewer={viewer} tab="home"
            back={{ href: '/reunion', label: 'The Reunion' }}>
      <h1>Are you coming?</h1>
      <p class="page-intro">
        You can change this any time. It only helps us plan the food and the seating.
      </p>

      <form method="post" action="/reunion/rsvp">
        {/* The shared choice classes, not a hand-rolled copy: this form was
            written before .choices existed and kept 26px radios while every
            other choice on the site moved to 30. */}
        <fieldset class="choices">
          <legend>Your answer</legend>
          {ANSWERS.map((a) => (
            <label class="check">
              <input type="radio" name="answer" value={a.code}
                     checked={(rsvp?.answer ?? 'yes') === a.code} />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>

        <div class="field">
          <label for="guests">Is anyone coming with you?</label>
          <span class="hint">
            How many others — husband, wife, son, daughter, a helper. Put 0 if you are coming alone.
          </span>
          <input id="guests" name="guests" type="number" min="0" max="20"
                 inputmode="numeric" value={String(rsvp?.guests ?? 0)} />
        </div>

        <div class="field">
          <label for="dietary">Anything you cannot eat?</label>
          <span class="hint">Vegetarian, no sugar, allergies — anything at all.</span>
          <input id="dietary" name="dietary" type="text" maxlength={200}
                 value={rsvp?.dietary ?? ''} />
        </div>

        <div class="field">
          <label for="accessibility">Anything that would make the days easier?</label>
          <span class="hint">
            Trouble with stairs, a seat near the front, help getting from the car park.
            Just say so and we will arrange it.
          </span>
          <input id="accessibility" name="accessibility" type="text" maxlength={200}
                 value={rsvp?.accessibility ?? ''} />
        </div>

        <div class="field">
          <label for="note">Anything else you would like us to know?</label>
          <textarea id="note" name="note" style="min-height:6rem">{rsvp?.note ?? ''}</textarea>
        </div>

        <button class="btn btn-block" type="submit">Send my answer</button>
      </form>
    </Layout>,
  );
});

reunionRoutes.post('/reunion/rsvp', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const form = await c.req.formData();
  const answer = String(form.get('answer') ?? '');
  if (!['yes', 'no', 'maybe'].includes(answer)) return c.redirect('/reunion/rsvp', 303);

  const guests = Math.max(0, Math.min(20, Number(form.get('guests') ?? 0) || 0));
  const dietary = String(form.get('dietary') ?? '').trim() || null;
  const accessibility = String(form.get('accessibility') ?? '').trim() || null;
  const note = String(form.get('note') ?? '').trim() || null;

  await c.env.DB
    .prepare(
      `INSERT INTO rsvps (id, event_id, member_id, answer, guests, dietary, accessibility, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (event_id, member_id) DO UPDATE SET
         answer = excluded.answer, guests = excluded.guests,
         dietary = excluded.dietary, accessibility = excluded.accessibility,
         note = excluded.note, updated_at = unixepoch()`,
    )
    .bind(newId(), event.id, viewer.id, answer, guests, dietary, accessibility, note)
    .run();

  return c.redirect('/reunion', 303);
});

/* -- Headcount for the organisers ------------------------------------------ */
reunionRoutes.get('/admin/reunion', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const totals = await c.env.DB
    .prepare(
      `SELECT
         SUM(CASE WHEN answer = 'yes'   THEN 1 ELSE 0 END) AS yes,
         SUM(CASE WHEN answer = 'maybe' THEN 1 ELSE 0 END) AS maybe,
         SUM(CASE WHEN answer = 'no'    THEN 1 ELSE 0 END) AS no,
         SUM(CASE WHEN answer = 'yes'   THEN guests ELSE 0 END) AS guests,
         (SELECT COUNT(*) FROM members WHERE status = 'active') AS members
       FROM rsvps WHERE event_id = ?1`,
    )
    .bind(event.id)
    .first<{ yes: number; maybe: number; no: number; guests: number; members: number }>();

  const { results: answered } = await c.env.DB
    .prepare(
      `SELECT COALESCE(m.preferred_name, m.full_name) AS name,
              r.answer, r.guests, r.dietary, r.accessibility, r.note
         FROM rsvps r
         JOIN members m ON m.id = r.member_id
        WHERE r.event_id = ?1
        ORDER BY r.answer, name`,
    )
    .bind(event.id)
    .all<{ name: string; answer: string; guests: number; dietary: string | null; accessibility: string | null; note: string | null }>();

  const { results: silent } = await c.env.DB
    .prepare(
      `SELECT COALESCE(preferred_name, full_name) AS name FROM members
        WHERE status = 'active'
          AND id NOT IN (SELECT member_id FROM rsvps WHERE event_id = ?1)
        ORDER BY name`,
    )
    .bind(event.id)
    .all<{ name: string }>();

  const { results: fromOutside } = await c.env.DB
    .prepare(
      `SELECT g.id, g.full_name, g.email, g.phone, g.answer, g.guests,
              g.dietary, g.accessibility, g.note, g.created_at, g.handled_at,
              COALESCE(m.preferred_name, m.full_name) AS became
         FROM guest_rsvps g
         LEFT JOIN members m ON m.id = g.member_id
        WHERE g.event_id = ?1
        ORDER BY g.handled_at IS NOT NULL, g.created_at DESC`,
    )
    .bind(event.id)
    .all<{
      id: string; full_name: string; email: string | null; phone: string | null;
      answer: string; guests: number; dietary: string | null;
      accessibility: string | null; note: string | null; created_at: number;
      handled_at: number | null; became: string | null;
    }>();

  const yes = totals?.yes ?? 0;
  const guests = totals?.guests ?? 0;

  // Counted separately and said out loud. Somebody who answered the public
  // form is coming to lunch just as surely as a member is, but they are not a
  // member yet and the committee needs to see that difference to act on it.
  const outsideYes = fromOutside.filter((g) => g.answer === 'yes');
  const outsideHeads = outsideYes.reduce((n, g) => n + 1 + g.guests, 0);
  const unhandled = fromOutside.filter((g) => g.handled_at === null).length;

  return c.html(
    <Layout title="Headcount" viewer={viewer} tab="more" back={{ href: '/admin', label: 'Admin' }}>
      <h1>Who is coming</h1>

      <div class="card card-primary">
        <h2>{yes + guests + outsideHeads} people expected</h2>
        <p class="card-meta">
          {yes} of the batch, plus {guests} {guests === 1 ? 'guest' : 'guests'}
          {outsideHeads > 0 && `, plus ${outsideHeads} who answered without an account`}
        </p>
        <p style="margin:0">
          {totals?.maybe ?? 0} said maybe · {totals?.no ?? 0} cannot come ·{' '}
          {silent.length} have not answered yet
        </p>
      </div>

      <p style="margin:0 0 var(--space-md)">
        <a class="back" href="/admin/reunion/event">Change the details or the schedule</a>
      </p>

      {fromOutside.length > 0 && (
        <>
          <h2 class="section-title">
            Answers from people without an account
            {unhandled > 0 && ` · ${unhandled} to deal with`}
          </h2>
          <p class="page-intro">
            Sent through the public reunion page. Inviting somebody here makes
            them a member and produces their sign-in link.
          </p>
          {fromOutside.map((g) => (
            <div class="card">
              <h3>{g.full_name}</h3>
              <p class="card-meta">
                {g.answer === 'yes' ? 'Coming' : g.answer === 'maybe' ? 'Maybe' : 'Cannot come'}
                {g.guests > 0 && ` (+${g.guests})`}
                {g.email && <> · <a href={`mailto:${g.email}`}>{g.email}</a></>}
                {g.phone && ` · ${g.phone}`}
                {g.handled_at && (g.became ? ` · now a member: ${g.became}` : ' · dealt with')}
              </p>
              {g.dietary && <p style="margin:0 0 0.4rem"><strong>Food:</strong> {g.dietary}</p>}
              {g.accessibility && <p style="margin:0 0 0.4rem"><strong>Access:</strong> {g.accessibility}</p>}
              {g.note && <p class="card-body">{g.note}</p>}

              {!g.handled_at && (
                <div style="margin-top:0.75rem">
                  {g.email ? (
                    <form method="post" action={`/admin/reunion/guest/${g.id}/invite`}>
                      <button class="btn btn-compact" type="submit">
                        Invite them to join
                      </button>
                    </form>
                  ) : (
                    <p class="card-meta">
                      No address, so there is nobody to send a link to — add them
                      by hand from Members if you can reach them another way.
                    </p>
                  )}
                  <form method="post" action={`/admin/reunion/guest/${g.id}/handled`}
                        style="margin-top:0.6rem">
                    <button class="linklike" type="submit">Just mark this dealt with</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Dietary and accessibility notes pulled out, because these are the two
          the committee has to act on rather than just read. */}
      <h2 class="section-title">Food and access</h2>
      {answered.filter((r) => r.answer !== 'no' && (r.dietary || r.accessibility)).length === 0 ? (
        <p class="page-intro">Nothing to arrange so far.</p>
      ) : (
        answered
          .filter((r) => r.answer !== 'no' && (r.dietary || r.accessibility))
          .map((r) => (
            <div class="card">
              <h3>{r.name}</h3>
              {r.dietary && <p style="margin:0 0 0.4rem"><strong>Food:</strong> {r.dietary}</p>}
              {r.accessibility && <p style="margin:0"><strong>Access:</strong> {r.accessibility}</p>}
            </div>
          ))
      )}

      {/* These are names, not links. They were anchors with href="#" purely to
          borrow the .directory row styling, which put a focus stop and a
          screen-reader "link" announcement on every one of sixty-one people
          and led nowhere. A span reads them as what they are. */}
      <h2 class="section-title">Everyone who answered</h2>
      <ul class="directory">
        {answered.map((r) => (
          <li>
            <span class="directory-row">
              {r.name} — {r.answer === 'yes' ? 'coming' : r.answer === 'maybe' ? 'maybe' : 'cannot come'}
              {r.guests > 0 && ` (+${r.guests})`}
            </span>
          </li>
        ))}
      </ul>

      {silent.length > 0 && (
        <>
          <h2 class="section-title">Still to answer</h2>
          <p class="page-intro">Worth a WhatsApp message or a phone call.</p>
          <ul class="directory">
            {silent.map((m) => <li><span class="directory-row">{m.name}</span></li>)}
          </ul>
        </>
      )}
    </Layout>,
  );
});

/* -- Turning an outside answer into a member ------------------------------- */
reunionRoutes.post('/admin/reunion/guest/:id/invite', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const guest = await c.env.DB
    .prepare('SELECT id, full_name, email FROM guest_rsvps WHERE id = ?1 AND handled_at IS NULL')
    .bind(id)
    .first<{ id: string; full_name: string; email: string | null }>();
  if (!guest?.email) return c.redirect('/admin/reunion', 303);

  const invited = await inviteMember(c, viewer.id, guest.full_name, guest.email, null);

  if (!invited) {
    // The address already belongs to somebody who has signed in before, so this
    // is a duplicate rather than a new person. Close it and move on.
    await c.env.DB
      .prepare('UPDATE guest_rsvps SET handled_at = unixepoch(), handled_by = ?1 WHERE id = ?2')
      .bind(viewer.id, id)
      .run();
    return c.redirect('/admin/reunion', 303);
  }

  await c.env.DB
    .prepare(
      `UPDATE guest_rsvps
          SET handled_at = unixepoch(), handled_by = ?1, member_id = ?2
        WHERE id = ?3`,
    )
    .bind(viewer.id, invited.memberId, id)
    .run();

  return c.html(
    <LinkHandout viewer={viewer} name={guest.full_name} url={invited.url}
                 code={invited.code} result={invited.result}
                 configured={emailConfigured(c.env)} />,
  );
});

reunionRoutes.post('/admin/reunion/guest/:id/handled', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  await c.env.DB
    .prepare(
      `UPDATE guest_rsvps SET handled_at = unixepoch(), handled_by = ?1
        WHERE id = ?2 AND handled_at IS NULL`,
    )
    .bind(viewer.id, c.req.param('id'))
    .run();

  return c.redirect('/admin/reunion', 303);
});

/* -- Editing the event ----------------------------------------------------- */
/*
 * Times, rooms and travel notes will change several times before August, and
 * none of that should need a developer or a deploy. This is the least
 * glamorous screen on the site and probably the most used one between now and
 * the reunion.
 */
reunionRoutes.get('/admin/reunion/event', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const { results: schedule } = await c.env.DB
    .prepare(
      `SELECT id, day_label, time_label, title, detail, sort_order
         FROM event_schedule WHERE event_id = ?1 ORDER BY sort_order, time_label`,
    )
    .bind(event.id)
    .all<{
      id: string; day_label: string; time_label: string | null;
      title: string; detail: string | null; sort_order: number;
    }>();

  return c.html(
    <Layout title="The reunion" viewer={viewer} tab="more"
            back={{ href: '/admin/reunion', label: 'Who is coming' }}>
      <h1>The reunion details</h1>
      <p class="page-intro">
        Everything here is what visitors and members see on the reunion page.
      </p>

      <form method="post" action="/admin/reunion/event">
        <div class="field">
          <label for="name">What we are calling it</label>
          <input id="name" name="name" type="text" maxlength={120}
                 value={event.name} required />
        </div>
        <div class="field">
          <label for="starts_on">First day</label>
          <span class="hint">Year, month, day — for example 2026-08-28.</span>
          <input id="starts_on" name="starts_on" type="date" value={event.starts_on} required />
        </div>
        <div class="field">
          <label for="ends_on">Last day</label>
          <input id="ends_on" name="ends_on" type="date" value={event.ends_on ?? ''} />
        </div>
        <div class="field">
          <label for="rsvp_by">Answers wanted by</label>
          <input id="rsvp_by" name="rsvp_by" type="date" value={event.rsvp_by ?? ''} />
        </div>
        <div class="field">
          <label for="venue">Where</label>
          <input id="venue" name="venue" type="text" maxlength={160}
                 value={event.venue ?? ''} />
        </div>
        <div class="field">
          <label for="address">The address</label>
          <input id="address" name="address" type="text" maxlength={240}
                 value={event.address ?? ''} />
        </div>
        <div class="field">
          <label for="map_url">A link to the map</label>
          <span class="hint">Optional. Paste the address of a map page.</span>
          <input id="map_url" name="map_url" type="url" maxlength={500}
                 value={event.map_url ?? ''} />
        </div>
        <div class="field">
          <label for="intro">The paragraph at the top</label>
          <textarea id="intro" name="intro" style="min-height:6rem">{event.intro ?? ''}</textarea>
        </div>
        <div class="field">
          <label for="venue_notes">Getting there, parking, and somewhere to stay</label>
          <span class="hint">Leave a blank line between paragraphs.</span>
          <textarea id="venue_notes" name="venue_notes"
                    style="min-height:12rem">{event.venue_notes ?? ''}</textarea>
        </div>
        <div class="field">
          <label for="contact_note">What to say about getting in touch</label>
          <textarea id="contact_note" name="contact_note"
                    style="min-height:5rem">{event.contact_note ?? ''}</textarea>
        </div>
        <button class="btn btn-block" type="submit">Save the details</button>
      </form>

      <h2 class="section-title">The schedule</h2>
      {schedule.map((line) => (
        <div class="card">
          <form method="post" action={`/admin/reunion/schedule/${line.id}`}>
            <div class="field">
              <label for={`d-${line.id}`}>Which day</label>
              <input id={`d-${line.id}`} name="day_label" type="text"
                     value={line.day_label} required />
            </div>
            <div class="field">
              <label for={`t-${line.id}`}>What time</label>
              <input id={`t-${line.id}`} name="time_label" type="text"
                     value={line.time_label ?? ''} />
            </div>
            <div class="field">
              <label for={`h-${line.id}`}>What is happening</label>
              <input id={`h-${line.id}`} name="title" type="text"
                     value={line.title} required />
            </div>
            <div class="field">
              <label for={`x-${line.id}`}>Anything to add</label>
              <input id={`x-${line.id}`} name="detail" type="text"
                     value={line.detail ?? ''} />
            </div>
            <div class="field">
              <label for={`o-${line.id}`}>Where it comes in the list</label>
              <input id={`o-${line.id}`} name="sort_order" type="number"
                     inputmode="numeric" value={String(line.sort_order)} />
            </div>
            <button class="btn btn-secondary btn-compact" type="submit">Save this line</button>
          </form>
          <form method="post" action={`/admin/reunion/schedule/${line.id}/delete`}
                style="margin-top:0.6rem">
            <button class="linklike" type="submit">Take this line out</button>
          </form>
        </div>
      ))}

      <h2 class="section-title">Add a line</h2>
      <form method="post" action="/admin/reunion/schedule">
        <div class="field">
          <label for="new_day">Which day</label>
          <span class="hint">Write it exactly as the other lines for that day.</span>
          <input id="new_day" name="day_label" type="text" required />
        </div>
        <div class="field">
          <label for="new_time">What time</label>
          <input id="new_time" name="time_label" type="text" />
        </div>
        <div class="field">
          <label for="new_title">What is happening</label>
          <input id="new_title" name="title" type="text" required />
        </div>
        <div class="field">
          <label for="new_detail">Anything to add</label>
          <input id="new_detail" name="detail" type="text" />
        </div>
        <div class="field">
          <label for="new_order">Where it comes in the list</label>
          <input id="new_order" name="sort_order" type="number" inputmode="numeric" value="0" />
        </div>
        <button class="btn btn-block" type="submit">Add this line</button>
      </form>
    </Layout>,
  );
});

reunionRoutes.post('/admin/reunion/event', requireAdmin, async (c) => {
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const form = await c.req.formData();
  const text = (k: string) => String(form.get(k) ?? '').trim() || null;
  const name = String(form.get('name') ?? '').trim();
  const startsOn = String(form.get('starts_on') ?? '').trim();

  // A blank name or a mangled date would break the page for everybody, so
  // neither is accepted quietly.
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return c.redirect('/admin/reunion/event', 303);
  }

  await c.env.DB
    .prepare(
      `UPDATE events
          SET name = ?1, starts_on = ?2, ends_on = ?3, rsvp_by = ?4, venue = ?5,
              address = ?6, map_url = ?7, intro = ?8, venue_notes = ?9,
              contact_note = ?10
        WHERE id = ?11`,
    )
    .bind(name, startsOn, text('ends_on'), text('rsvp_by'), text('venue'),
          text('address'), text('map_url'), text('intro'), text('venue_notes'),
          text('contact_note'), event.id)
    .run();

  return c.redirect('/admin/reunion/event', 303);
});

reunionRoutes.post('/admin/reunion/schedule', requireAdmin, async (c) => {
  const event = await currentEvent(c.env.DB);
  if (!event) return c.notFound();

  const form = await c.req.formData();
  const day = String(form.get('day_label') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  if (!day || !title) return c.redirect('/admin/reunion/event', 303);

  await c.env.DB
    .prepare(
      `INSERT INTO event_schedule
         (id, event_id, day_label, time_label, title, detail, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(newId(), event.id, day,
          String(form.get('time_label') ?? '').trim() || null, title,
          String(form.get('detail') ?? '').trim() || null,
          Number(form.get('sort_order')) || 0)
    .run();

  return c.redirect('/admin/reunion/event', 303);
});

reunionRoutes.post('/admin/reunion/schedule/:id', requireAdmin, async (c) => {
  const form = await c.req.formData();
  const day = String(form.get('day_label') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  if (!day || !title) return c.redirect('/admin/reunion/event', 303);

  await c.env.DB
    .prepare(
      `UPDATE event_schedule
          SET day_label = ?1, time_label = ?2, title = ?3, detail = ?4, sort_order = ?5
        WHERE id = ?6`,
    )
    .bind(day, String(form.get('time_label') ?? '').trim() || null, title,
          String(form.get('detail') ?? '').trim() || null,
          Number(form.get('sort_order')) || 0, c.req.param('id'))
    .run();

  return c.redirect('/admin/reunion/event', 303);
});

reunionRoutes.post('/admin/reunion/schedule/:id/delete', requireAdmin, async (c) => {
  await c.env.DB
    .prepare('DELETE FROM event_schedule WHERE id = ?1')
    .bind(c.req.param('id'))
    .run();

  return c.redirect('/admin/reunion/event', 303);
});
