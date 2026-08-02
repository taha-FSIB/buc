import { Hono } from 'hono';
import type { FC } from 'hono/jsx';
import type { AppBindings } from '../types';
import { Layout, VisibilityChip, ErrorNotice } from '../views/layout';
import {
  PlusIcon, PenIcon, PhotoIcon, MicIcon, VideoIcon,
  LockIcon, PersonIcon, GroupsIcon, GlobeIcon,
} from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { vaultForMember, submitForPublic } from '../lib/visibility';
import { storeUpload, kindOf, UploadError, MAX_BYTES_BY_KIND } from '../lib/media';
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

/**
 * What a member can add, and what each choice changes.
 *
 * Asking first — rather than showing one form with a file box that accepts
 * anything — means the phone opens the right thing when they tap: the camera
 * roll for a photograph, the voice recorder for a recording. It also means the
 * medium is recorded because the member said so, not because we guessed from
 * a MIME type.
 */
const KINDS = {
  story: {
    medium: 'text' as const,
    noun: 'a written memory',
    Icon: PenIcon,
    title: 'Write a memory',
    blurb: 'Just words. As long or as short as you like.',
    heading: 'Write a memory',
    accept: null,
    bodyLabel: 'Your memory',
    bodyHint: 'Take your time. There is no length limit.',
    fileLabel: null,
  },
  photo: {
    medium: 'photo' as const,
    noun: 'a photograph',
    Icon: PhotoIcon,
    title: 'Add a photograph',
    blurb: 'An old picture, or one from last week.',
    heading: 'Add a photograph',
    accept: 'image/*',
    bodyLabel: 'Anything you want to say about it',
    bodyHint: 'Optional. Who is in it, where it was taken, what you remember.',
    fileLabel: 'Choose the photograph',
  },
  audio: {
    medium: 'audio' as const,
    noun: 'a recording',
    Icon: MicIcon,
    title: 'Add a recording',
    blurb: 'Your own voice telling the story.',
    heading: 'Add a recording',
    accept: 'audio/*',
    bodyLabel: 'Anything you want to add in writing',
    bodyHint: 'Optional.',
    fileLabel: 'Choose the recording',
  },
  video: {
    medium: 'video' as const,
    noun: 'a video',
    Icon: VideoIcon,
    title: 'Add a video',
    blurb: 'A clip from your phone.',
    heading: 'Add a video',
    accept: 'video/*',
    bodyLabel: 'Anything you want to add in writing',
    bodyHint: 'Optional.',
    fileLabel: 'Choose the video',
  },
} as const;

type KindKey = keyof typeof KINDS;

function isKind(v: string): v is KindKey {
  return Object.prototype.hasOwnProperty.call(KINDS, v);
}

const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** What we call a file we were not expecting, when telling the member so. */
const MEDIA_NOUN: Record<'photo' | 'audio' | 'video' | 'pdf', string> = {
  photo: 'a photograph',
  audio: 'a recording',
  video: 'a video',
  pdf: 'a document',
};

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
          {/* A card, not a link wrapping everything: changing who can see a
              post is a first-class action, so it needs its own target. */}
          {results.map((p) => (
            <div class="card">
              <h2><a href={`/post/${p.id}`}>{p.title || 'Untitled'}</a></h2>
              <p class="card-meta">
                <VisibilityChip kind={reach.get(p.id) ?? 'private'} />
                {p.state === 'draft' && ' · Not posted yet'}
              </p>
              <p style="margin:0.6rem 0 0">
                <a class="back" href={`/post/${p.id}/share`}>Change who can see this</a>
              </p>
            </div>
          ))}
        </div>
      )}
    </Layout>,
  );
});

/* -- Choose what you are adding -------------------------------------------- */
vaultRoutes.get('/vault/new', requireAuth, (c) => {
  const viewer = viewerOf(c);
  return c.html(
    <Layout title="Add something" viewer={viewer} tab="vault"
            back={{ href: '/vault', label: 'My Vault' }}>
      <h1>Add something</h1>
      <p class="page-intro">
        What would you like to put in your vault? Whatever you choose, nobody
        else sees it until you say so.
      </p>
      {(Object.keys(KINDS) as KindKey[]).map((key) => {
        const k = KINDS[key];
        return (
          <a class="card card-choice" href={`/vault/new/${key}`}>
            <k.Icon />
            <span>
              <h2>{k.title}</h2>
              <span class="card-meta">{k.blurb}</span>
            </span>
          </a>
        );
      })}
    </Layout>,
  );
});

/* -- Compose --------------------------------------------------------------- */
interface ComposeValues {
  title?: string;
  body?: string;
  language?: string;
  visibility?: string;
  group_id?: string;
}

const VISIBILITY_CHOICES = [
  {
    value: 'private',
    Icon: LockIcon,
    label: 'Only me',
    hint: 'It stays in your vault. You can share it later, any time.',
  },
  {
    value: 'members',
    Icon: PersonIcon,
    label: 'Friends I choose',
    hint: 'You pick them by name on the next screen.',
  },
  {
    value: 'group',
    Icon: GroupsIcon,
    label: 'One of my groups',
    hint: 'Everyone in that group will see it.',
  },
  {
    value: 'public',
    Icon: GlobeIcon,
    label: 'Offer it to the public pages',
    hint: 'One of the committee reads it first. Nothing goes public without that.',
  },
] as const;

const ComposeForm: FC<{
  viewer: ReturnType<typeof viewerOf>;
  kind: KindKey;
  groups: { id: string; name: string }[];
  error?: string;
  values?: ComposeValues;
}> = ({ viewer, kind, groups, error, values }) => {
  const k = KINDS[kind];
  const chosen = values?.visibility ?? 'private';
  const choices = VISIBILITY_CHOICES.filter((v) => v.value !== 'group' || groups.length > 0);

  return (
    <Layout title={k.heading} viewer={viewer} tab="vault"
            back={{ href: '/vault/new', label: 'Back' }}>
      <h1>{k.heading}</h1>

      {error && <ErrorNotice title="We could not save that."><p>{error}</p></ErrorNotice>}

      <form method="post" action={`/vault/new/${kind}`} enctype="multipart/form-data">
        <div class="field">
          <label for="title">Give it a name</label>
          <span class="hint">For example: Our first day at BUC</span>
          <input id="title" name="title" type="text" maxlength={140}
                 value={values?.title ?? ''} required />
        </div>

        {k.fileLabel && (
          <div class="field">
            <label for="file">{k.fileLabel}</label>
            <span class="hint">Up to {MB(MAX_BYTES_BY_KIND[k.medium])} MB.</span>
            <input id="file" name="file" type="file" accept={k.accept ?? undefined} required />
          </div>
        )}

        <div class="field">
          <label for="body">{k.bodyLabel}</label>
          <span class="hint">{k.bodyHint}</span>
          {/* On one line on purpose. A textarea keeps every space between its
              tags, so pretty-printing this would hand the member their own
              words back indented by twelve spaces after a validation error. */}
          <textarea id="body" name="body" required={kind === 'story'}>{values?.body ?? ''}</textarea>
        </div>

        {kind === 'photo' && (
          <div class="field">
            <label for="alt">Describe the photo in a few words</label>
            <span class="hint">
              Optional. This helps friends who cannot see the picture clearly.
            </span>
            <input id="alt" name="alt" type="text" maxlength={200} />
          </div>
        )}

        <div class="field">
          <label for="language">What language did you write in?</label>
          <span class="hint">
            We use this to offer translations underneath your story later.
          </span>
          <select id="language" name="language">
            {LANGUAGES.map((l) => (
              <option value={l.code} selected={(values?.language ?? 'en') === l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Chosen here, at the moment of writing, rather than left to a second
            screen someone might never reach. "Only me" is pre-selected: the
            safe answer should never be the one you have to remember to pick. */}
        <fieldset class="choices">
          <legend>Who should be able to see this?</legend>
          {choices.map((v) => (
            <label class="check">
              <input type="radio" name="visibility" value={v.value}
                     checked={chosen === v.value} />
              <span>
                <span class="check-label"><v.Icon /> {v.label}</span>
                <span class="card-meta">{v.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {groups.length > 0 && (
          <div class="field">
            <label for="group_id">Which group?</label>
            <span class="hint">Only used if you chose “One of my groups” above.</span>
            <select id="group_id" name="group_id">
              <option value="">Please choose…</option>
              {groups.map((g) => (
                <option value={g.id} selected={values?.group_id === g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        <button class="btn btn-block" type="submit">Save to my vault</button>
      </form>
    </Layout>
  );
};

/** The groups this member may actually share into. */
function groupsFor(db: D1Database, memberId: string) {
  return db
    .prepare(
      `SELECT g.id, g.name FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.member_id = ?1 AND gm.state = 'active'
        ORDER BY g.name`,
    )
    .bind(memberId)
    .all<{ id: string; name: string }>();
}

vaultRoutes.get('/vault/new/:kind', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const kind = c.req.param('kind');
  if (!isKind(kind)) return c.notFound();

  const { results: groups } = await groupsFor(c.env.DB, viewer.id);
  return c.html(<ComposeForm viewer={viewer} kind={kind} groups={groups} />);
});

vaultRoutes.post('/vault/new/:kind', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const kind = c.req.param('kind');
  if (!isKind(kind)) return c.notFound();

  const k = KINDS[kind];
  const form = await c.req.formData();

  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const alt = String(form.get('alt') ?? '').trim() || null;
  const language = String(form.get('language') ?? 'en');
  const visibility = String(form.get('visibility') ?? 'private');
  const groupId = String(form.get('group_id') ?? '') || null;
  const file = form.get('file');
  const hasFile = file instanceof File && file.size > 0;

  const { results: groups } = await groupsFor(c.env.DB, viewer.id);
  const values: ComposeValues = { title, body, language, visibility, group_id: groupId ?? undefined };
  const fail = (error: string) =>
    c.html(<ComposeForm viewer={viewer} kind={kind} groups={groups}
                        values={values} error={error} />, 400);

  if (!title) return fail('Please give it a name so you can find it later.');
  if (!['en', 'ta', 'si'].includes(language)) return fail('Please choose a language.');

  if (k.fileLabel && !hasFile) return fail(`Please choose ${k.noun} to add.`);

  // Before anything reaches R2. The member said what this was; hold them to it
  // rather than trusting a MIME type an old Android browser may have invented.
  if (hasFile) {
    const actual = kindOf(file.type);
    if (!actual) {
      return fail('That kind of file cannot be added yet. Photos, recordings and videos work.');
    }
    if (actual !== k.medium) {
      return fail(
        `That file is ${MEDIA_NOUN[actual]}, not ${k.noun}. Go back and pick` +
        ' another file, or start again and choose the right kind.',
      );
    }
  }
  if (!k.fileLabel && !body) {
    return fail('There is nothing to save yet — write a few words first.');
  }

  if (!['private', 'members', 'group', 'public'].includes(visibility)) {
    return fail('Please choose who can see this.');
  }

  // Checked before anything is written, so a member never ends up with a post
  // saved and a share silently dropped.
  if (visibility === 'group') {
    if (!groupId) return fail('Please choose which group.');
    if (!groups.some((g) => g.id === groupId)) {
      return fail('You are not in that group any more. Please choose another.');
    }
  }

  const postId = newId();

  // Posts land as 'posted' rather than 'draft': for this audience an extra
  // publish step is a trapdoor, not a safety net. Privacy comes from sharing
  // nothing by default, not from an unposted state.
  await c.env.DB
    .prepare(
      `INSERT INTO posts (id, author_id, title, body, medium, language, state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'posted')`,
    )
    .bind(postId, viewer.id, title, body || null, k.medium, language)
    .run();

  if (hasFile) {
    try {
      await storeUpload(c.env, file, viewer.id, postId, alt);
    } catch (err) {
      // Roll the post back so a failed upload never leaves a stub behind.
      await c.env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(postId).run();
      return fail(err instanceof UploadError ? err.message
        : 'Something went wrong while saving that file. Please try again.');
    }
  }

  if (visibility === 'group' && groupId) {
    await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO post_shares
           (id, post_id, audience_kind, audience_id, granted_by)
         VALUES (?1, ?2, 'group', ?3, ?4)`,
      )
      .bind(newId(), postId, groupId, viewer.id)
      .run();
  }

  if (visibility === 'public') {
    await submitForPublic(c.env.DB, postId, viewer.id);
  }

  // Naming people needs the full list, so that one goes to its own screen.
  if (visibility === 'members') return c.redirect(`/post/${postId}/share`, 303);

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

      <p style="margin-top:1.25rem">
        <a class="back" href={`/post/${post.id}/share`}>Change who can see this</a>
      </p>

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
