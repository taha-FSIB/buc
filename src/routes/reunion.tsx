import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout } from '../views/layout';
import { requireAuth, requireAdmin, viewerOf } from '../lib/guard';
import { newId } from '../lib/ids';

export const reunionRoutes = new Hono<AppBindings>();

interface EventRow {
  id: string; name: string; starts_on: string; ends_on: string | null;
  venue: string | null; address: string | null; map_url: string | null;
  intro: string | null; rsvp_by: string | null;
}

function currentEvent(db: D1Database) {
  return db
    .prepare(
      `SELECT id, name, starts_on, ends_on, venue, address, map_url, intro, rsvp_by
         FROM events WHERE is_current = 1 LIMIT 1`,
    )
    .first<EventRow>();
}

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

  return c.html(
    <Layout title="The Reunion" viewer={viewer ?? null} tab="home">
      <h1>{event.name}</h1>
      <p class="page-intro" style="font-size:1.15rem;color:var(--ink)">
        <strong>{humanDates(event.starts_on, event.ends_on)}</strong>
        {event.venue && <><br />{event.venue}</>}
      </p>

      {days > 0 && (
        <div class="notice">
          <strong>{days === 1 ? 'Tomorrow' : `${days} days to go`}</strong>
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
        <a class="btn btn-block" href="/signin">Sign in to let us know you are coming</a>
      )}

      {event.address && (
        <>
          <h2 class="section-title">Where</h2>
          <p>{event.venue}<br />{event.address}</p>
          {event.map_url && (
            <p><a class="btn btn-secondary" href={event.map_url}
                  target="_blank" rel="noopener noreferrer">Open the map</a></p>
          )}
        </>
      )}

      {byDay.size > 0 && (
        <>
          <h2 class="section-title">What is happening</h2>
          {[...byDay.entries()].map(([day, lines]) => (
            <div class="card">
              <h3>{day}</h3>
              {lines.map((l) => (
                <p style="margin:0 0 0.6rem">
                  {l.time_label && <strong>{l.time_label} — </strong>}
                  {l.title}
                  {l.detail && <><br /><span class="card-meta">{l.detail}</span></>}
                </p>
              ))}
            </div>
          ))}
        </>
      )}
    </Layout>,
  );
});

/* -- RSVP ------------------------------------------------------------------ */
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

  const ANSWERS = [
    { code: 'yes',   label: 'Yes, I will be there' },
    { code: 'maybe', label: 'I hope so, but I cannot say yet' },
    { code: 'no',    label: 'Sadly I cannot come' },
  ];

  return c.html(
    <Layout title="Are you coming?" viewer={viewer} tab="home"
            back={{ href: '/reunion', label: 'The Reunion' }}>
      <h1>Are you coming?</h1>
      <p class="page-intro">
        You can change this any time. It only helps us plan the food and the seating.
      </p>

      <form method="post" action="/reunion/rsvp">
        <fieldset style="border:0;padding:0;margin:0 0 1.5rem">
          <legend style="font-weight:700;margin-bottom:0.5rem">Your answer</legend>
          {ANSWERS.map((a) => (
            <label style="display:flex;align-items:center;gap:0.7rem;min-height:52px;font-weight:400">
              <input type="radio" name="answer" value={a.code}
                     checked={(rsvp?.answer ?? 'yes') === a.code}
                     style="width:26px;height:26px;min-height:26px;flex:none" />
              {a.label}
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

  const yes = totals?.yes ?? 0;
  const guests = totals?.guests ?? 0;

  return c.html(
    <Layout title="Headcount" viewer={viewer} tab="more" back={{ href: '/admin', label: 'Admin' }}>
      <h1>Who is coming</h1>

      <div class="card">
        <h2>{yes + guests} people expected</h2>
        <p class="card-meta">
          {yes} of the batch, plus {guests} {guests === 1 ? 'guest' : 'guests'}
        </p>
        <p style="margin:0">
          {totals?.maybe ?? 0} said maybe · {totals?.no ?? 0} cannot come ·{' '}
          {silent.length} have not answered yet
        </p>
      </div>

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

      <h2 class="section-title">Everyone who answered</h2>
      <ul class="directory">
        {answered.map((r) => (
          <li>
            <a href="#" style="cursor:default">
              {r.name} — {r.answer === 'yes' ? 'coming' : r.answer === 'maybe' ? 'maybe' : 'cannot come'}
              {r.guests > 0 && ` (+${r.guests})`}
            </a>
          </li>
        ))}
      </ul>

      {silent.length > 0 && (
        <>
          <h2 class="section-title">Still to answer</h2>
          <p class="page-intro">Worth a WhatsApp message or a phone call.</p>
          <ul class="directory">
            {silent.map((m) => <li><a href="#" style="cursor:default">{m.name}</a></li>)}
          </ul>
        </>
      )}
    </Layout>,
  );
});
