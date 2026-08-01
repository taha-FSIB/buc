import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, VisibilityChip, ErrorNotice } from '../views/layout';
import { PlusIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { vaultForMember } from '../lib/visibility';
import { storeUpload, UploadError, MAX_BYTES } from '../lib/media';
import { newId } from '../lib/ids';

// requireAuth is attached per route, never via use('*'): these routers are all
// mounted at '/', so a wildcard middleware here would guard the entire site
// including the public pages.
export const vaultRoutes = new Hono<AppBindings>();

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'Tamil' },
  { code: 'si', label: 'Sinhala' },
] as const;

/* -- Vault list ------------------------------------------------------------ */
vaultRoutes.get('/vault', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const { results } = await vaultForMember(c.env.DB, viewer.id);

  // How far each post currently reaches, for the chip on its card.
  const reach = new Map<string, 'private' | 'shared' | 'pending' | 'public'>();
  if (results.length) {
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT p.id AS post_id,
                MAX(CASE WHEN ps.audience_kind = 'public'
                          AND sub.status = 'approved' THEN 1 ELSE 0 END) AS is_public,
                MAX(CASE WHEN ps.audience_kind = 'public'
                          AND sub.status = 'pending'  THEN 1 ELSE 0 END) AS is_pending,
                COUNT(ps.id) AS share_count
           FROM posts p
           LEFT JOIN post_shares ps ON ps.post_id = p.id
           LEFT JOIN public_submissions sub ON sub.post_id = p.id
          WHERE p.author_id = ?1
          GROUP BY p.id`,
      )
      .bind(viewer.id)
      .all<{ post_id: string; is_public: number; is_pending: number; share_count: number }>();

    for (const r of rows) {
      reach.set(
        r.post_id,
        r.is_public ? 'public'
          : r.is_pending ? 'pending'
          : r.share_count > 0 ? 'shared'
          : 'private',
      );
    }
  }

  return c.html(
    <Layout title="My Vault" viewer={viewer} tab="vault">
      <h1>My Vault</h1>
      <p class="page-intro">
        Everything here is private to you until you choose to share it.
      </p>
      <a class="btn btn-block" href="/vault/new">
        <PlusIcon />
        Add something new
      </a>

      {results.length === 0 ? (
        <div class="empty" style="margin-top:2rem">
          <h2>Your vault is empty</h2>
          <p>
            Put your first photo or story in. Only you will see it until you
            decide otherwise.
          </p>
          <a class="btn" href="/vault/new">Add something</a>
        </div>
      ) : (
        <div style="margin-top:2rem">
          {results.map((p) => (
            <a class="card" href={`/post/${p.id}`}>
              <h2>{p.title || 'Untitled'}</h2>
              <p class="card-meta">
                <VisibilityChip kind={reach.get(p.id) ?? 'private'} />
                {p.state === 'draft' && ' · Not posted yet'}
              </p>
            </a>
          ))}
        </div>
      )}
    </Layout>,
  );
});

/* -- Compose --------------------------------------------------------------- */
const ComposeForm = (props: {
  viewer: ReturnType<typeof viewerOf>;
  error?: string;
  values?: { title?: string; body?: string; language?: string };
}) => (
  <Layout title="Add to your vault" viewer={props.viewer} tab="vault"
          back={{ href: '/vault', label: 'My Vault' }}>
    <h1>Add something</h1>
    <p class="page-intro">
      Write a memory, or add a photo, a recording, or a video. Nobody else can
      see this until you share it.
    </p>

    {props.error && <ErrorNotice title="We could not save that."><p>{props.error}</p></ErrorNotice>}

    <form method="post" action="/vault/new" enctype="multipart/form-data">
      <div class="field">
        <label for="title">Give it a name</label>
        <span class="hint">For example: Our first day at BUC</span>
        <input id="title" name="title" type="text" maxlength={140}
               value={props.values?.title ?? ''} required />
      </div>

      <div class="field">
        <label for="body">Tell the story</label>
        <span class="hint">As long or as short as you like. You can leave this empty if you are adding a photo.</span>
        <textarea id="body" name="body">{props.values?.body ?? ''}</textarea>
      </div>

      <div class="field">
        <label for="file">Add a photo, recording, or video</label>
        <span class="hint">Optional. Up to {Math.round(MAX_BYTES / 1024 / 1024)} MB.</span>
        <input id="file" name="file" type="file"
               accept="image/*,audio/*,video/*,application/pdf" />
      </div>

      <div class="field">
        <label for="alt">Describe the photo in a few words</label>
        <span class="hint">
          Optional. This helps friends who cannot see the picture clearly.
        </span>
        <input id="alt" name="alt" type="text" maxlength={200} />
      </div>

      <div class="field">
        <label for="language">What language did you write in?</label>
        <span class="hint">
          We use this to offer translations underneath your story later.
        </span>
        <select id="language" name="language">
          {LANGUAGES.map((l) => (
            <option value={l.code} selected={props.values?.language === l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <button class="btn btn-block" type="submit">Save to my vault</button>
    </form>
  </Layout>
);

vaultRoutes.get('/vault/new', requireAuth, (c) => c.html(<ComposeForm viewer={viewerOf(c)} />));

vaultRoutes.post('/vault/new', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();

  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const alt = String(form.get('alt') ?? '').trim() || null;
  const language = String(form.get('language') ?? 'en');
  const file = form.get('file');
  const hasFile = file instanceof File && file.size > 0;

  const values = { title, body, language };

  if (!title) {
    return c.html(<ComposeForm viewer={viewer} values={values}
                    error="Please give it a name so you can find it later." />, 400);
  }
  if (!body && !hasFile) {
    return c.html(<ComposeForm viewer={viewer} values={values}
                    error="Add a few words or attach a photo — otherwise there is nothing to save." />, 400);
  }
  if (!['en', 'ta', 'si'].includes(language)) {
    return c.html(<ComposeForm viewer={viewer} values={values}
                    error="Please choose a language." />, 400);
  }

  const postId = newId();
  let medium: 'text' | 'photo' | 'audio' | 'video' = 'text';

  // Posts land as 'posted' rather than 'draft': for this audience an extra
  // publish step is a trapdoor, not a safety net. Privacy comes from sharing
  // nothing by default, not from an unposted state.
  await c.env.DB
    .prepare(
      `INSERT INTO posts (id, author_id, title, body, medium, language, state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'posted')`,
    )
    .bind(postId, viewer.id, title, body || null, medium, language)
    .run();

  if (hasFile) {
    try {
      const stored = await storeUpload(c.env, file, viewer.id, postId, alt);
      medium = stored.kind === 'pdf' ? 'text' : stored.kind;
      await c.env.DB
        .prepare('UPDATE posts SET medium = ?1 WHERE id = ?2')
        .bind(medium, postId)
        .run();
    } catch (err) {
      // Roll the post back so a failed upload never leaves a stub behind.
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(postId).run();
      const msg = err instanceof UploadError
        ? err.message
        : 'Something went wrong while saving that file. Please try again.';
      return c.html(<ComposeForm viewer={viewer} values={values} error={msg} />, 400);
    }
  }

  return c.redirect(`/post/${postId}`, 303);
});

/* -- Edit ------------------------------------------------------------------ */
vaultRoutes.get('/post/:id/edit', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const post = await c.env.DB
    .prepare('SELECT id, title, body, language FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(c.req.param('id'), viewer.id)
    .first<{ id: string; title: string; body: string | null; language: string }>();

  if (!post) return c.notFound();

  return c.html(
    <Layout title="Edit" viewer={viewer} tab="vault"
            back={{ href: `/post/${post.id}`, label: 'Back to the post' }}>
      <h1>Edit</h1>
      <form method="post" action={`/post/${post.id}/edit`}>
        <div class="field">
          <label for="title">Name</label>
          <input id="title" name="title" type="text" maxlength={140}
                 value={post.title ?? ''} required />
        </div>
        <div class="field">
          <label for="body">The story</label>
          <textarea id="body" name="body">{post.body ?? ''}</textarea>
        </div>
        <div class="field">
          <label for="language">Language</label>
          <select id="language" name="language">
            {LANGUAGES.map((l) => (
              <option value={l.code} selected={post.language === l.code}>{l.label}</option>
            ))}
          </select>
        </div>
        <button class="btn btn-block" type="submit">Save changes</button>
      </form>

      <h2 class="section-title">Remove this</h2>
      <p class="page-intro">
        Deleting is permanent. The photo or recording goes too.
      </p>
      <form method="post" action={`/post/${post.id}/delete`}>
        <button class="btn btn-secondary btn-block" type="submit">
          Delete this permanently
        </button>
      </form>
    </Layout>,
  );
});

vaultRoutes.post('/post/:id/edit', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const language = String(form.get('language') ?? 'en');

  if (!title || !['en', 'ta', 'si'].includes(language)) {
    return c.redirect(`/post/${id}/edit`, 303);
  }

  await c.env.DB
    .prepare(
      `UPDATE posts SET title = ?1, body = ?2, language = ?3, updated_at = unixepoch()
        WHERE id = ?4 AND author_id = ?5`,
    )
    .bind(title, body || null, language, id, viewer.id)
    .run();

  return c.redirect(`/post/${id}`, 303);
});

vaultRoutes.post('/post/:id/delete', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const owned = await c.env.DB
    .prepare('SELECT 1 FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(id, viewer.id)
    .first();
  if (!owned) return c.notFound();

  // Clear R2 first; the FK cascade will take the media rows with the post.
  const { results } = await c.env.DB
    .prepare('SELECT r2_key FROM media WHERE post_id = ?1')
    .bind(id)
    .all<{ r2_key: string }>();
  await Promise.all(results.map((m) => c.env.MEDIA.delete(m.r2_key)));

  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
  return c.redirect('/vault', 303);
});
