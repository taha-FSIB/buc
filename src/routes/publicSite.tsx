import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { publicFeed, getPost } from '../lib/visibility';
import { StoryText } from '../views/story';
import { newId } from '../lib/ids';

export const publicRoutes = new Hono<AppBindings>();

/**
 * The batch's public face. Five pages, no session required.
 *
 * Every story shown here comes from publicFeed / getPost with a null viewer,
 * which resolve against PUBLIC_POST_IDS: an explicit 'public' share from the
 * author AND an admin approval. There is no query on this router that can
 * reach unapproved content, and the enforcement is in the SQL rather than in
 * what this file chooses to render — a mistake in the markup below cannot
 * publish anything.
 *
 * The copy on Our Story and Contact is written here rather than in the
 * database. The committee should say what it wants and have it changed; a
 * page editor is not worth building for two pages that will settle down after
 * the first week.
 */

const TAGLINE =
  'The pioneer batch of Batticaloa University College, now Eastern University, Sri Lanka.';

/* -- Home ------------------------------------------------------------------ */
/** Exported so `/` can serve this to anybody who is not signed in. */
export async function publicHome(c: Context<AppBindings>) {
  const [{ results: stories }, event] = await Promise.all([
    publicFeed(c.env.DB, 3),
    c.env.DB
      .prepare(
        `SELECT name, starts_on, ends_on, venue FROM events WHERE is_current = 1 LIMIT 1`,
      )
      .first<{ name: string; starts_on: string; ends_on: string | null; venue: string | null }>(),
  ]);

  return c.html(
    <Layout title="Home" viewer={null} publicTab="home" description={TAGLINE}>
      <h1>We were the first.</h1>
      <p class="page-intro" style="font-size:1.15rem;color:var(--ink)">
        {TAGLINE} Forty-five years on, we are still a batch.
      </p>

      <p class="page-intro">
        This is where we keep what we remember — photographs, stories, and the
        names of people who mattered to each other a long time ago and still
        do. Some of it is here for anybody to read. Most of it is private, and
        that is how the batch wants it.
      </p>

      {event && (
        <a class="card" href="/reunion" style="border-color:var(--accent);border-width:3px">
          <h2>{event.name}</h2>
          <p class="card-meta">
            {event.venue ?? 'Eastern University'} — details and how to reach us
          </p>
        </a>
      )}

      <h2 class="section-title">Some of our memories</h2>
      {stories.length === 0 ? (
        <p class="page-intro">
          The batch is still gathering its stories. Please look again soon.
        </p>
      ) : (
        <>
          {stories.map((p) => (
            <a class="card" href={`/stories/${p.id}`}>
              <h2>{p.title || 'Untitled'}</h2>
              <p class="card-meta">{p.author_name}</p>
              {p.body && <p class="card-body">{p.body.slice(0, 160)}</p>}
            </a>
          ))}
          <a class="btn btn-secondary btn-block" href="/stories">Read them all</a>
        </>
      )}

      <h2 class="section-title">Were you one of us?</h2>
      <p class="page-intro">
        If you were in the pioneer batch, there is a private side to this site
        with the rest of it. Sign in, or ask any of us on WhatsApp and we will
        send you a link.
      </p>
      <a class="btn btn-block" href="/signin">Sign in</a>
    </Layout>,
  );
}

/* -- Our Story ------------------------------------------------------------- */
publicRoutes.get('/our-story', async (c) => {
  const counts = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE status = 'active'`)
    .first<{ n: number }>();

  return c.html(
    <Layout title="Our Story" viewer={c.get('viewer') ?? null} publicTab="story"
            description={`How the pioneer batch of Batticaloa University College began, and where we are now.`}>
      <h1>Our story</h1>

      <p class="page-intro">
        Batticaloa University College opened its doors and we walked through
        them first. There was no batch ahead of us to ask how anything worked,
        no traditions to inherit, and nobody who had done it before. We worked
        it out between us.
      </p>

      <p>
        The college became Eastern University. The lecture rooms we sat in are
        still there, and so, remarkably, are most of us — in Batticaloa and
        Colombo, and in London, Toronto, Sydney, and a dozen places in between.
        Careers happened. Children happened. Grandchildren happened.
      </p>

      <p>
        What did not happen is that we lost each other. Forty-five years is
        long enough for a friendship to become something you assume rather than
        something you keep up, and then one day somebody starts a WhatsApp
        group and it turns out everybody was still there.
      </p>

      <p>
        This site is the next part of that. WhatsApp is where we talk, but it
        forgets — a photograph posted on a Tuesday is gone by Friday. Here,
        things stay. {counts?.n ? `${counts.n} of us have joined so far.` : ''}
      </p>

      <h2 class="section-title">What is here</h2>
      <p>
        Every member has a private space for their own photographs and
        memories, and shares only what they choose to share, with the people
        they choose. A few of those memories have been offered to this public
        side, and you can read them.
      </p>
      <p>
        Nothing appears on these public pages unless the member who owns it
        asked for that <strong>and</strong> one of us read it first. That is
        deliberate, and it is not going to change.
      </p>

      <a class="btn btn-block" href="/stories">Read our memories</a>
      <p style="margin-top:1.5rem">
        <a class="back" href="/contact">Get in touch with us</a>
      </p>
    </Layout>,
  );
});

/* -- Stories & Memories ---------------------------------------------------- */
publicRoutes.get('/stories', async (c) => {
  const viewer = c.get('viewer');
  const { results } = await publicFeed(c.env.DB, 30);

  return c.html(
    <Layout title="Stories & Memories" viewer={viewer ?? null} publicTab="stories"
            description="Memories the pioneer batch of Batticaloa University College has chosen to share.">
      <h1>Stories and memories</h1>
      <p class="page-intro">
        These are the ones we have chosen to share with everyone. There are a
        great many more that belong to the batch alone.
      </p>

      {results.length === 0 ? (
        <div class="empty">
          <h2>Nothing here yet</h2>
          <p>The batch is still gathering its stories. Please look again soon.</p>
          <a class="btn" href="/our-story">Read about us instead</a>
        </div>
      ) : (
        results.map((p) => (
          <a class="card" href={`/stories/${p.id}`}>
            <h2>{p.title || 'Untitled'}</h2>
            <p class="card-meta">{p.author_name}</p>
            {p.body && <p class="card-body">{p.body.slice(0, 200)}</p>}
          </a>
        ))
      )}

      {!viewer && (
        <p style="margin-top:2rem">
          <a class="back" href="/signin">Are you one of the batch? Sign in</a>
        </p>
      )}
    </Layout>,
  );
});

/** One public memory. Same approved-only gate, resolved with a null viewer. */
publicRoutes.get('/stories/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = c.req.param('id');

  const post = await getPost(c.env.DB, null, id);
  if (!post) return c.notFound();

  const [{ results: media }, { results: transcripts }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT id, kind, mime_type, alt_text FROM media
          WHERE post_id = ?1 ORDER BY created_at`,
      )
      .bind(id)
      .all<{ id: string; kind: string; mime_type: string; alt_text: string | null }>(),
    c.env.DB
      .prepare(
        `SELECT language, body FROM transcripts WHERE post_id = ?1 AND approved = 1`,
      )
      .bind(id)
      .all<{ language: string; body: string }>(),
  ]);

  return c.html(
    <Layout title={post.title ?? 'A memory'} viewer={viewer ?? null} publicTab="stories"
            description={post.body?.slice(0, 180) ?? TAGLINE}
            back={{ href: '/stories', label: 'All our stories' }}>
      <h1>{post.title || 'Untitled'}</h1>
      <p class="card-meta">{post.author_name}</p>

      {media.map((m) =>
        m.kind === 'photo' ? (
          <img src={`/media/${m.id}`} alt={m.alt_text ?? ''} loading="lazy"
               style="border-radius:14px;margin:1rem 0;display:block" />
        ) : m.kind === 'audio' ? (
          <audio controls preload="metadata" style="width:100%;margin:1rem 0">
            <source src={`/media/${m.id}`} type={m.mime_type} />
          </audio>
        ) : m.kind === 'video' ? (
          <video controls preload="metadata" playsinline
                 style="width:100%;border-radius:14px;margin:1rem 0">
            <source src={`/media/${m.id}`} type={m.mime_type} />
          </video>
        ) : null,
      )}

      {/* Exactly the same component the members' page uses, so the two cannot
          drift apart in how somebody's words are presented. */}
      <StoryText language={post.language} body={post.body} transcripts={transcripts} />
    </Layout>,
  );
});

/* -- Old links ------------------------------------------------------------- */
// /public was the only public URL before the site had five pages. Anything
// already pasted into a WhatsApp group keeps working.
publicRoutes.get('/public', (c) => c.redirect('/stories', 301));
publicRoutes.get('/public/:id', (c) => c.redirect(`/stories/${c.req.param('id')}`, 301));

/* -- Contact --------------------------------------------------------------- */
const MAX_MESSAGE = 4000;
/**
 * Messages accepted from one sender per hour before we stop listening.
 *
 * Set high on purpose. Over the limit we still say thank you — telling a
 * flooder they have been spotted only tells them to change address — but that
 * means a genuine message over the line is silently lost. Ten an hour is a
 * number no real person reaches and no bot stops at.
 */
const MAX_PER_HOUR = 10;

const ContactPage = (props: {
  viewer: ReturnType<Context<AppBindings>['get']> | null;
  sent?: boolean;
  error?: string;
  values?: { name?: string; email?: string; body?: string };
}) => (
  <Layout title="Contact" viewer={props.viewer ?? null} publicTab="contact"
          description="Get in touch with the pioneer batch of Batticaloa University College.">
    <h1>Get in touch</h1>

    {props.sent ? (
      <>
        <div class="notice" role="status">
          <strong>Thank you — we have it.</strong>
          <p>
            One of us will read it. If you left an address we will write back,
            though it may take a few days.
          </p>
        </div>
        <a class="btn btn-block" href="/">Back to the start</a>
      </>
    ) : (
      <>
        <p class="page-intro">
          If you knew one of us, or you are family, or you are from the
          university and want to talk to the batch — this reaches us.
        </p>

        {props.error && (
          <ErrorNotice title="That did not send."><p>{props.error}</p></ErrorNotice>
        )}

        <form method="post" action="/contact">
          <div class="field">
            <label for="name">Your name</label>
            <input id="name" name="name" type="text" maxlength={120}
                   value={props.values?.name ?? ''} required />
          </div>
          <div class="field">
            <label for="email">Your email</label>
            <span class="hint">
              Optional — but we cannot write back without it.
            </span>
            <input id="email" name="email" type="email" maxlength={200}
                   value={props.values?.email ?? ''} />
          </div>
          <div class="field">
            <label for="body">What would you like to say?</label>
            <textarea id="body" name="body" maxlength={MAX_MESSAGE} required>
              {props.values?.body ?? ''}
            </textarea>
          </div>

          {/* Left empty by people, filled in by bots. Hidden from assistive
              technology as well as from sight, so nobody is asked to skip it. */}
          <div class="visually-hidden" aria-hidden="true">
            <label for="website">Leave this box empty</label>
            <input id="website" name="website" type="text" tabindex={-1} autocomplete="off" />
          </div>

          <button class="btn btn-block" type="submit">Send this to the batch</button>
        </form>
      </>
    )}
  </Layout>
);

publicRoutes.get('/contact', (c) =>
  c.html(<ContactPage viewer={c.get('viewer') ?? null} />));

publicRoutes.post('/contact', async (c) => {
  const form = await c.req.formData();
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase() || null;
  const body = String(form.get('body') ?? '').trim();
  const honeypot = String(form.get('website') ?? '').trim();
  const values = { name, email: email ?? '', body };
  const viewer = c.get('viewer') ?? null;

  // A bot filled the hidden field. Answer exactly as if it had worked, so it
  // has nothing to learn and nothing to retry.
  if (honeypot) return c.html(<ContactPage viewer={viewer} sent />);

  if (!name || !body) {
    return c.html(
      <ContactPage viewer={viewer} values={values}
                   error="Please give us your name and a message." />,
      400,
    );
  }
  if (body.length > MAX_MESSAGE) {
    return c.html(
      <ContactPage viewer={viewer} values={values}
                   error="That message is too long. Please shorten it a little." />,
      400,
    );
  }

  // Hashed, never stored raw: enough to stop a flood, useless for identifying
  // anybody afterwards.
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const senderHash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  const recent = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM public_messages
        WHERE sender_hash = ?1 AND created_at > unixepoch() - 3600`,
    )
    .bind(senderHash)
    .first<{ n: number }>();

  // Over the limit: still say thank you. Telling a flooder they have been
  // spotted only tells them to change address.
  if ((recent?.n ?? 0) >= MAX_PER_HOUR) {
    return c.html(<ContactPage viewer={viewer} sent />);
  }

  await c.env.DB
    .prepare(
      `INSERT INTO public_messages (id, name, email, body, sender_hash)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(newId(), name, email, body, senderHash)
    .run();

  return c.html(<ContactPage viewer={viewer} sent />);
});
