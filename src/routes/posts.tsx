import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, VisibilityChip, ErrorNotice } from '../views/layout';
import { LockIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import {
  getPost, getPostForModeration, sharesForPost, publicStatusFor, submitForPublic,
} from '../lib/visibility';
import { mediaForPost, type MediaRow } from '../lib/media';
import { StoryText, LANGUAGE_LABEL as LANG_LABEL } from '../views/story';
import { newId } from '../lib/ids';

export const postRoutes = new Hono<AppBindings>();

/** Which transcripts a post should carry, per the language rule in CLAUDE.md. */
export function wantedTranscripts(language: string): string[] {
  return language === 'en' ? ['ta', 'si'] : ['en'];
}

/** Render whatever media hangs off a post. */
const MediaBlock = ({ m }: { m: MediaRow }) => {
  if (m.kind === 'photo') {
    return (
      <img src={`/media/${m.id}`} alt={m.alt_text ?? ''} loading="lazy"
           style="border-radius:14px;margin:1rem 0;display:block" />
    );
  }
  if (m.kind === 'audio') {
    return (
      <audio controls preload="metadata" style="width:100%;margin:1rem 0">
        <source src={`/media/${m.id}`} type={m.mime_type} />
        Your browser cannot play this recording.
      </audio>
    );
  }
  if (m.kind === 'video') {
    return (
      <video controls preload="metadata" playsinline
             style="width:100%;border-radius:14px;margin:1rem 0">
        <source src={`/media/${m.id}`} type={m.mime_type} />
        Your browser cannot play this video.
      </video>
    );
  }
  return (
    <p style="margin:1rem 0">
      <a class="btn btn-secondary" href={`/media/${m.id}`}>Open the document</a>
    </p>
  );
};

/* -- View a post ----------------------------------------------------------- */
postRoutes.get('/post/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = c.req.param('id');

  let post = await getPost(c.env.DB, viewer?.id ?? null, id);

  // An admin reading something that has been put forward for the public pages.
  // The queue links straight here, and a moderator who cannot open the thing
  // they are approving is no moderator at all. This does not open private
  // vaults: the post must carry the member's own 'public' share row.
  const moderating = !post && viewer?.role === 'admin';
  if (moderating) post = await getPostForModeration(c.env.DB, id);

  if (!post) return c.notFound();

  const isAuthor = viewer?.id === post.author_id;
  const [{ results: media }, { results: transcripts }] = await Promise.all([
    mediaForPost(c.env.DB, id),
    c.env.DB
      .prepare(
        `SELECT language, body, source FROM transcripts
          WHERE post_id = ?1 AND approved = 1`,
      )
      .bind(id)
      .all<{ language: string; body: string; source: string }>(),
  ]);

  const shares = isAuthor ? (await sharesForPost(c.env.DB, id)).results : [];
  const pub = isAuthor ? await publicStatusFor(c.env.DB, id) : null;

  const reach: 'private' | 'shared' | 'pending' | 'public' =
    pub?.status === 'approved' ? 'public'
      : pub?.status === 'pending' ? 'pending'
      : shares.length > 0 ? 'shared'
      : 'private';

  return c.html(
    <Layout title={post.title ?? 'A memory'} viewer={viewer ?? null}
            tab={isAuthor ? 'vault' : 'home'}
            back={{ href: isAuthor ? '/vault' : '/', label: isAuthor ? 'My Vault' : 'Home' }}>
      <h1>{post.title || 'Untitled'}</h1>
      <p class="card-meta">
        {post.author_name}
        {isAuthor && <> · <VisibilityChip kind={reach} /></>}
      </p>

      {moderating && (
        <div class="notice" role="status">
          <strong>You are reading this to decide about the public pages.</strong>
          <p>
            {post.author_name} offered it. Nobody outside the batch can see it
            yet. <a href="/admin/queue">Go back to the queue to decide</a>.
          </p>
        </div>
      )}

      {media.map((m) => <MediaBlock m={m} />)}

      {/* The member's own words first, with any translation a tap away
          beneath them. Never in the site navigation — see views/story.tsx. */}
      <StoryText language={post.language} body={post.body} transcripts={transcripts} />

      {isAuthor && (
        <>
          <h2 class="section-title">Who can see this</h2>
          {shares.length === 0 ? (
            <p class="page-intro">
              <LockIcon /> Only you. Nobody else can see this until you share it below.
            </p>
          ) : (
            <ul style="padding-left:1.2rem;margin:0 0 1.25rem">
              {shares.map((s) => (
                <li style="margin-bottom:0.4rem">
                  {s.audience_kind === 'public'
                    ? (pub?.status === 'approved'
                        ? 'Everyone, on the public pages'
                        : 'Offered to the public pages — waiting for an admin to approve')
                    : s.audience_kind === 'group'
                      ? `Everyone in ${s.audience_name}`
                      : s.audience_name}
                  {' '}
                  <form method="post" action={`/post/${id}/unshare`} style="display:inline">
                    <input type="hidden" name="share_id" value={s.id} />
                    <button type="submit" class="linklike">Stop sharing</button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {pub?.status === 'rejected' && (
            <ErrorNotice title="An admin did not put this on the public pages.">
              <p>{pub.review_note || 'No reason was given. Ask on WhatsApp if you would like to know more.'}</p>
            </ErrorNotice>
          )}

          <a class="btn btn-block" href={`/post/${id}/share`}>Share this</a>
          <p style="margin-top:1rem">
            <a class="back" href={`/post/${id}/edit`}>Edit or delete this</a>
          </p>
          <p>
            <a class="back" href={`/post/${id}/transcripts`}>
              {post.medium === 'audio' || post.medium === 'video'
                ? 'Write out what is said'
                : 'Add another language'}
            </a>
          </p>
        </>
      )}
    </Layout>,
  );
});

/* -- Share ----------------------------------------------------------------- */
postRoutes.get('/post/:id/share', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const post = await c.env.DB
    .prepare('SELECT id, title FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(id, viewer.id)
    .first<{ id: string; title: string }>();
  if (!post) return c.notFound();

  const [{ results: members }, { results: groups }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT id, COALESCE(preferred_name, full_name) AS name
           FROM members
          WHERE id != ?1 AND status = 'active'
            AND id NOT IN (SELECT audience_id FROM post_shares
                            WHERE post_id = ?2 AND audience_kind = 'member')
          ORDER BY name`,
      )
      .bind(viewer.id, id)
      .all<{ id: string; name: string }>(),
    c.env.DB
      .prepare(
        `SELECT g.id, g.name FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE gm.member_id = ?1 AND gm.state = 'active'
            AND g.id NOT IN (SELECT audience_id FROM post_shares
                              WHERE post_id = ?2 AND audience_kind = 'group')
          ORDER BY g.name`,
      )
      .bind(viewer.id, id)
      .all<{ id: string; name: string }>(),
  ]);

  const alreadyPublic = await c.env.DB
    .prepare(`SELECT 1 FROM post_shares WHERE post_id = ?1 AND audience_kind = 'public'`)
    .bind(id)
    .first();

  const { results: already } = await sharesForPost(c.env.DB, id);

  // Resolved from the database, never taken from the query string as text.
  const addedId = c.req.query('added');
  const added = addedId
    ? (await c.env.DB
        .prepare(
          `SELECT COALESCE(m.preferred_name, m.full_name) AS name
             FROM post_shares s JOIN members m ON m.id = s.audience_id
            WHERE s.post_id = ?1 AND s.audience_kind = 'member' AND s.audience_id = ?2`,
        )
        .bind(id, addedId)
        .first<{ name: string }>())?.name ?? null
    : null;

  return c.html(
    <Layout title="Share" viewer={viewer} tab="vault"
            back={{ href: `/post/${id}`, label: 'Back to the post' }}>
      <h1>Share “{post.title}”</h1>
      <p class="page-intro">
        Choose who you would like to see this. You can undo any of it later.
      </p>

      {added && (
        <div class="notice" role="status">
          <strong>Shared with {added}.</strong>
          <p>Add somebody else below, or go back to the post when you are done.</p>
        </div>
      )}

      {already.length > 0 && (
        <>
          <h2 class="section-title">Already shared with</h2>
          <ul style="padding-left:1.2rem;margin:0 0 1.25rem">
            {already.map((s) => (
              <li style="margin-bottom:0.4rem">
                {s.audience_kind === 'public'
                  ? 'The public pages — waiting for an admin'
                  : s.audience_kind === 'group'
                    ? `Everyone in ${s.audience_name}`
                    : s.audience_name}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 class="section-title">With a friend</h2>
      {members.length === 0 ? (
        <p class="page-intro">You have already shared this with everyone.</p>
      ) : (
        <>
        <form method="post" action={`/post/${id}/share`}>
          <input type="hidden" name="kind" value="member" />
          {/* Server-rendered <select> works on its own; the island upgrades it
              to a type-to-filter list once the bundle arrives. */}
          <div data-island="member-picker" data-props="picker-props">
            <div class="field">
              <label for="member">Choose a friend</label>
              <select id="member" name="audience_id" required>
                <option value="">Please choose…</option>
                {members.map((m) => <option value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {/* One at a time, and the screen comes straight back with a
              confirmation. A multi-select on a phone gives no feedback until
              the very end, and this way each name is visibly accounted for. */}
          <button class="btn btn-block" type="submit">Share with this friend</button>
        </form>
        <script
          type="application/json"
          id="picker-props"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({ name: 'audience_id', people: members })
              .replace(/</g, '\\u003c'),
          }}
        />
        <script src="/islands.js" defer></script>
        </>
      )}

      <h2 class="section-title">With a group</h2>
      {groups.length === 0 ? (
        <p class="page-intro">
          You are not in any groups yet. <a href="/groups">Have a look at the groups</a>.
        </p>
      ) : (
        <form method="post" action={`/post/${id}/share`}>
          <input type="hidden" name="kind" value="group" />
          <div class="field">
            <label for="group">Choose a group</label>
            <select id="group" name="audience_id" required>
              <option value="">Please choose…</option>
              {groups.map((g) => <option value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <button class="btn btn-block" type="submit">Share with this group</button>
        </form>
      )}

      <h2 class="section-title">With everyone</h2>
      {alreadyPublic ? (
        <p class="page-intro">
          You have already offered this to the public pages.
        </p>
      ) : (
        <>
          <p class="page-intro">
            This puts your memory on our public pages, where anyone can read it.
            An admin reads everything first — nothing appears publicly until
            one of them approves it.
          </p>
          <form method="post" action={`/post/${id}/share`}>
            <input type="hidden" name="kind" value="public" />
            <button class="btn btn-secondary btn-block" type="submit">
              Offer this to the public pages
            </button>
          </form>
        </>
      )}

      <p style="margin-top:2rem">
        <a class="btn btn-secondary btn-block" href={`/post/${id}`}>
          Done — back to the post
        </a>
      </p>
    </Layout>,
  );
});

postRoutes.post('/post/:id/share', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const kind = String(form.get('kind') ?? '');
  const audienceId = String(form.get('audience_id') ?? '') || null;

  const owned = await c.env.DB
    .prepare('SELECT 1 FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(id, viewer.id)
    .first();
  if (!owned) return c.notFound();

  if (kind === 'public') {
    await submitForPublic(c.env.DB, id, viewer.id);
    return c.redirect(`/post/${id}`, 303);
  }

  if (kind !== 'member' && kind !== 'group') return c.redirect(`/post/${id}/share`, 303);
  if (!audienceId) return c.redirect(`/post/${id}/share`, 303);

  // Only share into a group the author actually belongs to.
  if (kind === 'group') {
    const inGroup = await c.env.DB
      .prepare(
        `SELECT 1 FROM group_members
          WHERE group_id = ?1 AND member_id = ?2 AND state = 'active'`,
      )
      .bind(audienceId, viewer.id)
      .first();
    if (!inGroup) return c.redirect(`/post/${id}/share`, 303);
  }

  await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO post_shares
         (id, post_id, audience_kind, audience_id, granted_by)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(newId(), id, kind, audienceId, viewer.id)
    .run();

  if (kind === 'group') return c.redirect(`/post/${id}`, 303);

  // Back to the picker, so sharing with several friends is one screen and a
  // visible confirmation each time rather than a multi-select in the dark.
  // The id travels, not the name: nothing from the URL is ever put on the page.
  return c.redirect(`/post/${id}/share?added=${audienceId}`, 303);
});

postRoutes.post('/post/:id/unshare', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const shareId = String(form.get('share_id') ?? '');

  const share = await c.env.DB
    .prepare(
      `SELECT s.id, s.audience_kind FROM post_shares s
         JOIN posts p ON p.id = s.post_id
        WHERE s.id = ?1 AND s.post_id = ?2 AND p.author_id = ?3`,
    )
    .bind(shareId, id, viewer.id)
    .first<{ id: string; audience_kind: string }>();
  if (!share) return c.notFound();

  const statements = [
    c.env.DB.prepare('DELETE FROM post_shares WHERE id = ?1').bind(shareId),
  ];
  // Withdrawing from public also withdraws the moderation request, so an
  // admin is never left approving something the author has taken back.
  if (share.audience_kind === 'public') {
    statements.push(
      c.env.DB
        .prepare(`UPDATE public_submissions SET status = 'withdrawn' WHERE post_id = ?1`)
        .bind(id),
    );
  }
  await c.env.DB.batch(statements);

  return c.redirect(`/post/${id}`, 303);
});

/* -- Transcripts ----------------------------------------------------------- */
postRoutes.get('/post/:id/transcripts', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const post = await c.env.DB
    .prepare('SELECT id, title, language, medium, body FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(id, viewer.id)
    .first<{ id: string; title: string; language: string; medium: string; body: string | null }>();
  if (!post) return c.notFound();

  const { results: existing } = await c.env.DB
    .prepare('SELECT language, body FROM transcripts WHERE post_id = ?1')
    .bind(id)
    .all<{ language: string; body: string }>();

  const byLang = new Map(existing.map((t) => [t.language, t.body]));
  const wanted = wantedTranscripts(post.language);
  const spoken = post.medium === 'audio' || post.medium === 'video';

  return c.html(
    <Layout title="Other languages" viewer={viewer} tab="vault"
            back={{ href: `/post/${id}`, label: 'Back to the post' }}>
      <h1>Other languages</h1>
      <p class="page-intro">
        {spoken
          ? `You recorded this in ${LANG_LABEL[post.language]}. Writing out what is
             said lets people follow it who cannot hear it well, or who read a
             different language.`
          : `You wrote this in ${LANG_LABEL[post.language]}. Adding a translation
             lets more of the batch read it.`}
      </p>
      <p class="page-intro">
        These appear underneath your story with a small switch, never as a
        separate page. What you wrote yourself is always what shows first.
      </p>

      {spoken && !post.body && (
        <div class="notice">
          <strong>There are no words on this one yet.</strong>
          <p>
            Whatever you put below will be the only text version, so it is
            worth doing even in the language you spoke.
          </p>
        </div>
      )}

      {wanted.map((lang) => {
        const current = byLang.get(lang);
        return (
          <form method="post" action={`/post/${id}/transcripts`}>
            <h2 class="section-title">
              In {LANG_LABEL[lang]}
              {current && <span class="chip chip-shared" style="margin-left:0.6rem">Added</span>}
            </h2>
            <input type="hidden" name="language" value={lang} />
            <div class="field">
              <label for={`t-${lang}`}>
                {spoken ? `What is said, in ${LANG_LABEL[lang]}` : `The ${LANG_LABEL[lang]} version`}
              </label>
              <span class="hint">
                {current
                  ? 'Clear the box and save to take this one away again.'
                  : 'Leave it empty if you would rather not — nothing is expected.'}
              </span>
              <textarea id={`t-${lang}`} name="body" lang={lang}>{current ?? ''}</textarea>
            </div>
            <button class="btn btn-block" type="submit">
              {current ? `Save the ${LANG_LABEL[lang]} version` : `Add the ${LANG_LABEL[lang]} version`}
            </button>
          </form>
        );
      })}
    </Layout>,
  );
});

postRoutes.post('/post/:id/transcripts', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const language = String(form.get('language') ?? '');
  const body = String(form.get('body') ?? '').trim();

  const post = await c.env.DB
    .prepare('SELECT language FROM posts WHERE id = ?1 AND author_id = ?2')
    .bind(id, viewer.id)
    .first<{ language: string }>();
  if (!post) return c.notFound();
  if (!wantedTranscripts(post.language).includes(language)) {
    return c.redirect(`/post/${id}/transcripts`, 303);
  }

  if (!body) {
    await c.env.DB
      .prepare('DELETE FROM transcripts WHERE post_id = ?1 AND language = ?2')
      .bind(id, language)
      .run();
  } else {
    // Written by the member, so it is human-sourced and needs no extra review.
    await c.env.DB
      .prepare(
        `INSERT INTO transcripts (id, post_id, language, body, source, approved)
         VALUES (?1, ?2, ?3, ?4, 'human', 1)
         ON CONFLICT (post_id, language)
           DO UPDATE SET body = excluded.body, source = 'human', approved = 1`,
      )
      .bind(newId(), id, language, body)
      .run();
  }

  return c.redirect(`/post/${id}/transcripts`, 303);
});
