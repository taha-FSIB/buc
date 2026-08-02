import { Hono } from 'hono';
import type { FC } from 'hono/jsx';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { StoryText } from '../views/story';
import { PlusIcon, PhotoIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { getPost, feedForChannel } from '../lib/visibility';
import { mediaForPost } from '../lib/media';
import { storeUpload, kindOf, UploadError, MAX_BYTES_BY_KIND } from '../lib/media';
import { newId } from '../lib/ids';

/**
 * The Communication Hub — the part of this site meant to replace the WhatsApp
 * group for anything worth keeping.
 *
 * A thread is an ordinary post with a channel on it, shared with the whole
 * batch. That is the entire trick: threads get the same read rule, the same
 * media handling and the same transcripts as everything else, and
 * `visibility.ts` did not have to learn what a channel is.
 *
 * A reply has no visibility of its own. It is readable exactly when its thread
 * is, so every reply route asks about the thread first and never about the
 * reply.
 *
 * No websockets and no polling loop. A reply reloads the page it was written
 * on, and there is a plain "look for new replies" link at the bottom of every
 * thread. For an audience that finds a moving screen unsettling, a page that
 * only changes when you ask it to is a feature.
 */

export const hubRoutes = new Hono<AppBindings>();

const MAX_BODY = 8000;

interface ChannelRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

const channelBySlug = (db: D1Database, slug: string) =>
  db.prepare('SELECT id, slug, name, description FROM channels WHERE slug = ?1')
    .bind(slug)
    .first<ChannelRow>();

/** "3 days ago" beats a date nobody has to decode. */
function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(unix * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/* -- The four channels ----------------------------------------------------- */
hubRoutes.get('/talk', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  const { results } = await c.env.DB
    .prepare(
      `SELECT ch.id, ch.slug, ch.name, ch.description,
              (SELECT COUNT(*) FROM posts p
                WHERE p.channel_id = ch.id AND p.state = 'posted') AS threads,
              (SELECT MAX(x) FROM (
                 SELECT MAX(p.created_at) AS x FROM posts p
                  WHERE p.channel_id = ch.id AND p.state = 'posted'
                 UNION ALL
                 SELECT MAX(r.created_at) FROM channel_replies r
                   JOIN posts p2 ON p2.id = r.post_id
                  WHERE p2.channel_id = ch.id
               )) AS last_at
         FROM channels ch
        ORDER BY ch.sort_order`,
    )
    .all<{ id: string; slug: string; name: string; description: string | null; threads: number; last_at: number | null }>();

  return c.html(
    <Layout title="Talk" viewer={viewer} tab="talk">
      <h1>Talk</h1>
      <p class="page-intro">
        Four places to talk to the batch. Everyone who has joined can read and
        reply — and unlike WhatsApp, none of it disappears.
      </p>

      {results.map((ch) => (
        <a class="card" href={`/talk/${ch.slug}`}>
          <h2>{ch.name}</h2>
          <p class="card-meta">
            {ch.threads === 0
              ? 'Nothing here yet — you could start it'
              : `${ch.threads} ${ch.threads === 1 ? 'conversation' : 'conversations'}`}
            {ch.last_at ? ` · last spoken in ${ago(ch.last_at)}` : ''}
          </p>
          {ch.description && <p class="card-body">{ch.description}</p>}
        </a>
      ))}
    </Layout>,
  );
});

/* -- One channel ----------------------------------------------------------- */
hubRoutes.get('/talk/:slug', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const channel = await channelBySlug(c.env.DB, c.req.param('slug'));
  if (!channel) return c.notFound();

  const { results: threads } = await feedForChannel(c.env.DB, viewer.id, channel.id);

  return c.html(
    <Layout title={channel.name} viewer={viewer} tab="talk"
            back={{ href: '/talk', label: 'Talk' }}>
      <h1>{channel.name}</h1>
      {channel.description && <p class="page-intro">{channel.description}</p>}

      <a class="btn btn-block" href={`/talk/${channel.slug}/new`}>
        <PlusIcon />
        Start something new
      </a>

      {threads.length === 0 ? (
        <div class="empty" style="margin-top:2rem">
          <h2>Nobody has said anything yet</h2>
          <p>Be the first. Anything you start here, the whole batch can read.</p>
        </div>
      ) : (
        <div style="margin-top:2rem">
          {threads.map((t) => (
            <div class="card">
              <h2><a href={`/talk/thread/${t.id}`}>{t.title || 'Untitled'}</a></h2>
              <p class="card-meta">
                {t.author_id === viewer.id ? 'You' : t.author_name}
                {' · '}
                {t.reply_count === 0
                  ? 'no replies yet'
                  : `${t.reply_count} ${t.reply_count === 1 ? 'reply' : 'replies'}`}
                {t.reply_count > 0 && t.last_by && `, last from ${t.last_by}`}
                {' · '}{ago(t.last_at)}
              </p>
              {t.body && <p class="card-body">{t.body.slice(0, 160)}</p>}
            </div>
          ))}
        </div>
      )}

      <p style="margin-top:2rem">
        <a class="back" href={`/talk/${channel.slug}`}>Look for anything new</a>
      </p>
    </Layout>,
  );
});

/* -- Start a thread -------------------------------------------------------- */
const NewThread: FC<{
  viewer: ReturnType<typeof viewerOf>;
  channel: ChannelRow;
  error?: string;
  values?: { title?: string; body?: string };
}> = ({ viewer, channel, error, values }) => (
  <Layout title="Start something" viewer={viewer} tab="talk"
          back={{ href: `/talk/${channel.slug}`, label: channel.name }}>
    <h1>Start something in {channel.name}</h1>
    <p class="page-intro">
      Everyone who has joined can read this and reply to it. It will not go on
      the public pages.
    </p>

    {error && <ErrorNotice title="That did not send."><p>{error}</p></ErrorNotice>}

    <form method="post" action={`/talk/${channel.slug}/new`} enctype="multipart/form-data">
      <div class="field">
        <label for="title">What is it about?</label>
        <span class="hint">A few words, so people know whether to open it.</span>
        <input id="title" name="title" type="text" maxlength={140}
               value={values?.title ?? ''} required />
      </div>

      <div class="field">
        <label for="body">What would you like to say?</label>
        <textarea id="body" name="body" maxlength={MAX_BODY}
                  required={channel.slug !== 'photos'}>{values?.body ?? ''}</textarea>
      </div>

      <div class="field">
        <label for="photo">
          <PhotoIcon /> A photograph
        </label>
        <span class="hint">
          {channel.slug === 'photos'
            ? 'This is the place for them. Up to '
            : 'Optional. Up to '}
          {Math.round(MAX_BYTES_BY_KIND.photo / 1024 / 1024)} MB.
        </span>
        {/* Not marked required even in Photos: "does anybody have a picture of
            the old library?" belongs there too, and the server only insists on
            words OR a photograph, so the form must not insist on more. */}
        <input id="photo" name="photo" type="file" accept="image/*" />
      </div>

      <button class="btn btn-block" type="submit">Send this to the batch</button>
    </form>
  </Layout>
);

hubRoutes.get('/talk/:slug/new', requireAuth, async (c) => {
  const channel = await channelBySlug(c.env.DB, c.req.param('slug'));
  if (!channel) return c.notFound();
  return c.html(<NewThread viewer={viewerOf(c)} channel={channel} />);
});

hubRoutes.post('/talk/:slug/new', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const channel = await channelBySlug(c.env.DB, c.req.param('slug'));
  if (!channel) return c.notFound();

  const form = await c.req.formData();
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const file = form.get('photo');
  const hasPhoto = file instanceof File && file.size > 0;

  const values = { title, body };
  const fail = (error: string) =>
    c.html(<NewThread viewer={viewer} channel={channel} values={values} error={error} />, 400);

  if (!title) return fail('Please give it a name, so people know what it is about.');
  if (!body && !hasPhoto) return fail('Add a few words or a photograph — there is nothing to send yet.');
  if (body.length > MAX_BODY) return fail('That is longer than this box can take. Try shortening it.');
  // Checked before anything reaches R2, so a refused upload leaves nothing behind.
  if (hasPhoto && kindOf(file.type) !== 'photo') return fail('That file is not a photograph.');

  const postId = newId();

  await c.env.DB
    .prepare(
      `INSERT INTO posts (id, author_id, title, body, medium, language, state, channel_id)
       VALUES (?1, ?2, ?3, ?4, ?5, 'en', 'posted', ?6)`,
    )
    .bind(postId, viewer.id, title, body || null, hasPhoto ? 'photo' : 'text', channel.id)
    .run();

  if (hasPhoto) {
    try {
      await storeUpload(c.env, file, viewer.id, postId, title);
    } catch (err) {
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(postId).run();
      return fail(err instanceof UploadError ? err.message
        : 'Something went wrong with that photograph. Please try again.');
    }
  }

  // The share grant is what actually makes it readable. Without this row the
  // thread would exist and nobody but its author could open it.
  await c.env.DB
    .prepare(
      `INSERT INTO post_shares (id, post_id, audience_kind, audience_id, granted_by)
       VALUES (?1, ?2, 'batch', NULL, ?3)`,
    )
    .bind(newId(), postId, viewer.id)
    .run();

  return c.redirect(`/talk/thread/${postId}`, 303);
});

/* -- One thread ------------------------------------------------------------ */
hubRoutes.get('/talk/thread/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  // The same gate as every other post. A thread whose share was withdrawn
  // stops being readable here without this route knowing anything about it.
  const post = await getPost(c.env.DB, viewer.id, id);
  if (!post) return c.notFound();

  const [channel, { results: media }, { results: replies }, { results: transcripts }] =
    await Promise.all([
      c.env.DB
        .prepare(
          `SELECT ch.id, ch.slug, ch.name, ch.description FROM channels ch
             JOIN posts p ON p.channel_id = ch.id WHERE p.id = ?1`,
        )
        .bind(id)
        .first<ChannelRow>(),
      mediaForPost(c.env.DB, id),
      c.env.DB
        .prepare(
          `SELECT r.id, r.body, r.created_at, r.author_id,
                  COALESCE(m.preferred_name, m.full_name) AS author_name,
                  m.photo_media_id
             FROM channel_replies r
             JOIN members m ON m.id = r.author_id
            WHERE r.post_id = ?1
            ORDER BY r.created_at`,
        )
        .bind(id)
        .all<{
          id: string; body: string; created_at: number; author_id: string;
          author_name: string; photo_media_id: string | null;
        }>(),
      c.env.DB
        .prepare(`SELECT language, body, source FROM transcripts
                   WHERE post_id = ?1 AND approved = 1`)
        .bind(id)
        .all<{ language: string; body: string; source: string }>(),
    ]);

  // Not a channel thread — somebody has followed a /talk link to an ordinary
  // post. Send them where it actually lives.
  if (!channel) return c.redirect(`/post/${id}`, 303);

  return c.html(
    <Layout title={post.title ?? 'A conversation'} viewer={viewer} tab="talk"
            back={{ href: `/talk/${channel.slug}`, label: channel.name }}>
      <h1>{post.title || 'Untitled'}</h1>
      <p class="card-meta">
        {post.author_id === viewer.id ? 'You' : post.author_name} · {ago(post.created_at)}
      </p>

      {media.map((m) => (
        m.kind === 'photo'
          ? <img src={`/media/${m.id}`} alt={m.alt_text ?? ''} loading="lazy"
                 style="border-radius:14px;margin:1rem 0;display:block" />
          : null
      ))}

      <StoryText language={post.language} body={post.body} transcripts={transcripts} />

      {post.author_id === viewer.id && (
        <p style="margin-top:1rem">
          <form method="post" action={`/talk/thread/${id}/delete`}>
            <button class="linklike" type="submit">Delete this conversation</button>
          </form>
        </p>
      )}

      <h2 class="section-title">
        {replies.length === 0 ? 'No replies yet'
          : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
      </h2>

      {replies.map((r, i) => (
        // The newest reply is the anchor a member lands on after writing one.
        <div class="reply" id={i === replies.length - 1 ? 'latest' : undefined}>
          <div class="reply-head">
            {r.photo_media_id ? (
              <img class="avatar avatar-small" src={`/media/${r.photo_media_id}`} alt=""
                   width="40" height="40" loading="lazy" />
            ) : (
              <span class="avatar avatar-small avatar-blank" aria-hidden="true">
                {r.author_name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>
              <strong>{r.author_id === viewer.id ? 'You' : r.author_name}</strong>
              <span class="card-meta">{ago(r.created_at)}</span>
            </span>
          </div>
          {r.body.split(/\n{2,}/).map((para) => <p>{para}</p>)}
          {r.author_id === viewer.id && (
            <form method="post" action={`/talk/reply/${r.id}/delete`}>
              <button class="linklike" type="submit">Delete this reply</button>
            </form>
          )}
        </div>
      ))}

      <h2 class="section-title">Say something</h2>
      <form method="post" action={`/talk/thread/${id}/reply`}>
        <div class="field">
          <label for="reply">Your reply</label>
          <textarea id="reply" name="body" maxlength={MAX_BODY}
                    style="min-height:7rem" required></textarea>
        </div>
        <button class="btn btn-block" type="submit">Add my reply</button>
      </form>

      {/* No polling loop. The page changes when somebody asks it to. */}
      <p style="margin-top:1.5rem">
        <a class="back" href={`/talk/thread/${id}`}>Look for new replies</a>
      </p>
    </Layout>,
  );
});

/* -- Replying -------------------------------------------------------------- */
hubRoutes.post('/talk/thread/:id/reply', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  // Ask about the THREAD, never about the reply: a reply has no visibility of
  // its own, and somebody who cannot read a thread must not be able to add to it.
  const post = await getPost(c.env.DB, viewer.id, id);
  if (!post) return c.notFound();

  const body = String((await c.req.formData()).get('body') ?? '').trim();
  if (!body || body.length > MAX_BODY) return c.redirect(`/talk/thread/${id}`, 303);

  await c.env.DB
    .prepare(
      `INSERT INTO channel_replies (id, post_id, author_id, body)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(newId(), id, viewer.id, body)
    .run();

  return c.redirect(`/talk/thread/${id}#latest`, 303);
});

hubRoutes.post('/talk/reply/:id/delete', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  // Scoped to the member's own replies, so an id from elsewhere does nothing.
  const row = await c.env.DB
    .prepare(
      `DELETE FROM channel_replies WHERE id = ?1 AND author_id = ?2
       RETURNING post_id`,
    )
    .bind(c.req.param('id'), viewer.id)
    .first<{ post_id: string }>();

  return c.redirect(row ? `/talk/thread/${row.post_id}` : '/talk', 303);
});

hubRoutes.post('/talk/thread/:id/delete', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const owned = await c.env.DB
    .prepare(`SELECT channel_id FROM posts WHERE id = ?1 AND author_id = ?2`)
    .bind(id, viewer.id)
    .first<{ channel_id: string | null }>();
  if (!owned?.channel_id) return c.notFound();

  const slug = await c.env.DB
    .prepare('SELECT slug FROM channels WHERE id = ?1')
    .bind(owned.channel_id)
    .first<{ slug: string }>();

  // Clear R2 first; the foreign keys take the media rows and the replies.
  const { results } = await c.env.DB
    .prepare('SELECT r2_key FROM media WHERE post_id = ?1')
    .bind(id)
    .all<{ r2_key: string }>();
  if (c.env.MEDIA) await Promise.all(results.map((m) => c.env.MEDIA!.delete(m.r2_key)));

  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();

  return c.redirect(slug ? `/talk/${slug.slug}` : '/talk', 303);
});
