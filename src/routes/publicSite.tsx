import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout } from '../views/layout';
import { publicFeed } from '../lib/visibility';

export const publicRoutes = new Hono<AppBindings>();

/**
 * The batch's public face. No session required, and every query here runs
 * through publicFeed / PUBLIC_POST_IDS, which demands both an explicit
 * 'public' share from the author and an admin approval. There is no code
 * path on this router that can reach unapproved content.
 */
publicRoutes.get('/public', async (c) => {
  const viewer = c.get('viewer');
  const { results } = await publicFeed(c.env.DB, 30);

  return c.html(
    <Layout title="Our story" viewer={viewer ?? null}
            back={viewer ? { href: '/', label: 'Home' } : undefined}>
      <h1>The pioneer batch</h1>
      <p class="page-intro">
        We were the first students of Batticaloa University College, now
        Eastern University. These are some of the memories we have chosen to
        share with everyone.
      </p>

      {results.length === 0 ? (
        <div class="empty">
          <h2>Nothing here yet</h2>
          <p>
            The batch is still gathering its stories. Please look again soon.
          </p>
        </div>
      ) : (
        results.map((p) => (
          <a class="card" href={`/public/${p.id}`}>
            <h2>{p.title || 'Untitled'}</h2>
            <p class="card-meta">{p.author_name}</p>
            {p.body && <p class="card-body">{p.body.slice(0, 200)}</p>}
          </a>
        ))
      )}

      {!viewer && (
        <p style="margin-top:2rem">
          <a class="back" href="/welcome">Are you one of the batch? Sign in</a>
        </p>
      )}
    </Layout>,
  );
});

/** One public memory. Reuses the same approved-only gate. */
publicRoutes.get('/public/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = c.req.param('id');

  // getPost with a null viewer resolves against PUBLIC_POST_IDS only.
  const { getPost } = await import('../lib/visibility');
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

  const LANG: Record<string, string> = { en: 'English', ta: 'Tamil', si: 'Sinhala' };

  return c.html(
    <Layout title={post.title ?? 'A memory'} viewer={viewer ?? null}
            back={{ href: '/public', label: 'All our stories' }}>
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

      {post.body && (
        <div style="max-width:34rem">
          {post.body.split(/\n{2,}/).map((para) => <p>{para}</p>)}
        </div>
      )}

      {transcripts.length > 0 && (
        <section class="transcripts">
          <h3>Also available in</h3>
          <div class="transcript-tabs" role="tablist">
            {transcripts.map((t, i) => (
              <button type="button" role="tab" aria-selected={i === 0 ? 'true' : 'false'}
                      aria-controls={`transcript-${t.language}`}
                      data-transcript-tab={t.language}>
                {LANG[t.language] ?? t.language}
              </button>
            ))}
          </div>
          {transcripts.map((t, i) => (
            <div id={`transcript-${t.language}`} role="tabpanel"
                 data-transcript-panel={t.language} hidden={i !== 0} lang={t.language}>
              {t.body.split(/\n{2,}/).map((para) => <p>{para}</p>)}
            </div>
          ))}
          <script src="/transcripts.js" defer></script>
        </section>
      )}
    </Layout>,
  );
});
