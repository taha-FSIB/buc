import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { FlipPage, titleOf, type SouvenirPageRow } from '../views/souvenirPage';
import { PlusIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { storeUpload, kindOf, UploadError } from '../lib/media';
import { newId } from '../lib/ids';

export const souvenirRoutes = new Hono<AppBindings>();

const APPROVED_PAGES = `
  SELECT f.id, f.member_id, f.page_type, f.heading, f.blurb,
         f.then_media_id, f.now_media_id, f.status,
         COALESCE(m.preferred_name, m.full_name) AS member_name
    FROM flipbook_pages f
    LEFT JOIN members m ON m.id = f.member_id
   WHERE f.status = 'approved'
   ORDER BY f.sort_order, member_name
`;

/* -- The flipbook ---------------------------------------------------------- */
/*
 * Members only.
 *
 * A souvenir page is submitted to go in a book that gets handed round at a
 * reunion. That is not the same consent as putting somebody's face, their
 * town and an account of their life on the open internet, and the five public
 * pages in the brief do not include this one. An admin approving a page is
 * approving it for the batch and the printer.
 */
souvenirRoutes.get('/souvenir', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const { results } = await c.env.DB.prepare(APPROVED_PAGES).all<SouvenirPageRow>();

  return c.html(
    <Layout title="Souvenir" viewer={viewer} tab="book">
      <h1>Reunion souvenir</h1>

      {results.length === 0 ? (
        <div class="empty">
          <h2>The souvenir is still being made</h2>
          <p>
            Every member gets a page — a photo from back then, a photo from
            now, and a few words. Yours can be the first.
          </p>
          <a class="btn" href="/souvenir/mine">Make my page</a>
        </div>
      ) : (
        <>
          {/*
            Every page is in the HTML. The island hands these exact elements to
            the page-turn library rather than rebuilding them, so there is one
            copy of this markup and no way for the two to disagree. With
            JavaScript off the whole book simply reads as one long page, which
            is a perfectly good book — photos are lazy so nothing downloads
            until it is scrolled to.
          */}
          <div class="flipbook" data-island="flipbook" data-props="flipbook-props">
            {results.map((p) => (
              <div class="flip-sheet" data-density="soft">
                <FlipPage page={p} />
              </div>
            ))}
          </div>

          <script
            type="application/json"
            id="flipbook-props"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                start: Math.max(0, Number(c.req.query('page') ?? '0') || 0),
                titles: results.map(titleOf),
              }).replace(/</g, '\\u003c'),
            }}
          />
          <script src="/islands.js" defer></script>
        </>
      )}

      <p style="margin-top:2rem">
        <a class="back" href="/souvenir/mine">My souvenir page</a>
      </p>
      {viewer.role === 'admin' && (
        <p>
          <a class="back" href="/admin/souvenir/compile">Put the souvenir together and print it</a>
        </p>
      )}
    </Layout>,
  );
});

/* -- My page --------------------------------------------------------------- */
souvenirRoutes.get('/souvenir/mine', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  const [page, { results: extras }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT f.id, f.page_type, f.heading, f.blurb, f.then_media_id,
                f.now_media_id, f.status,
                COALESCE(m.preferred_name, m.full_name) AS member_name
           FROM flipbook_pages f
           JOIN members m ON m.id = f.member_id
          WHERE f.member_id = ?1 AND f.page_type = 'member'`,
      )
      .bind(viewer.id)
      .first<SouvenirPageRow & { status: string }>(),
    c.env.DB
      .prepare(
        `SELECT f.id, f.page_type, f.heading, f.blurb, f.then_media_id,
                f.now_media_id, f.status,
                COALESCE(m.preferred_name, m.full_name) AS member_name
           FROM flipbook_pages f
           JOIN members m ON m.id = f.member_id
          WHERE f.member_id = ?1 AND f.page_type IN ('article','photo')
          ORDER BY f.created_at`,
      )
      .bind(viewer.id)
      .all<SouvenirPageRow & { status: string }>(),
  ]);

  const STATUS_WORD: Record<string, string> = {
    draft: 'Sent back for changes',
    submitted: 'Waiting to be looked at',
    approved: 'In the souvenir',
  };

  return c.html(
    <Layout title="My souvenir page" viewer={viewer} tab="book"
            back={{ href: '/souvenir', label: 'The souvenir' }}>
      <h1>My souvenir page</h1>
      <p class="page-intro">
        One page in the reunion souvenir, just for you. A photo from our time
        at BUC, a photo from today, and whatever you would like to say.
      </p>

      {page?.status === 'submitted' && (
        <div class="notice">
          <strong>Your page has been sent in.</strong>
          <p>One of the committee will look at it before it goes into the book.</p>
        </div>
      )}
      {page?.status === 'approved' && (
        <div class="notice">
          <strong>Your page is in the souvenir.</strong>
          <p>You can still change it — it will be looked at again.</p>
        </div>
      )}
      {page?.status === 'draft' && (
        <div class="notice">
          <strong>This came back for changes.</strong>
          <p>Have another look below, then send it in again.</p>
        </div>
      )}

      {/* What it will actually look like — the same component the flipbook
          uses, so there are no surprises after it is sent in. */}
      {page && (
        <>
          <h2 class="section-title">How it will look</h2>
          <FlipPage page={page} />
        </>
      )}

      <h2 class="section-title">{page ? 'Change it' : 'Make your page'}</h2>
      <form method="post" action="/souvenir/mine" enctype="multipart/form-data">
        <div class="field">
          <label for="heading">The name to print</label>
          <span class="hint">Leave empty to use your own name.</span>
          <input id="heading" name="heading" type="text" maxlength={100}
                 value={page?.heading ?? ''} />
        </div>

        <div class="field">
          <label for="blurb">A few words</label>
          <span class="hint">
            Where life took you, your family, what you remember most. As much
            or as little as you like.
          </span>
          <textarea id="blurb" name="blurb">{page?.blurb ?? ''}</textarea>
        </div>

        <div class="field">
          <label for="then">A photo from back then</label>
          <span class="hint">
            {page?.then_media_id
              ? 'You have one already. Choose a file only if you want to change it.'
              : 'From our BUC days.'}
          </span>
          {page?.then_media_id && (
            <img src={`/media/${page.then_media_id}`} alt="Your photo from back then"
                 style="max-width:180px;border-radius:10px;margin-bottom:0.5rem;display:block" />
          )}
          <input id="then" name="then" type="file" accept="image/*" />
        </div>

        <div class="field">
          <label for="now">A photo from now</label>
          <span class="hint">
            {page?.now_media_id
              ? 'You have one already. Choose a file only if you want to change it.'
              : 'However you look today.'}
          </span>
          {page?.now_media_id && (
            <img src={`/media/${page.now_media_id}`} alt="Your photo from now"
                 style="max-width:180px;border-radius:10px;margin-bottom:0.5rem;display:block" />
          )}
          <input id="now" name="now" type="file" accept="image/*" />
        </div>

        <button class="btn btn-block" type="submit">
          {page ? 'Save and send for approval' : 'Make my page'}
        </button>
      </form>

      {/* -- Extra pages -- */}
      <h2 class="section-title">Anything else for the book</h2>
      <p class="page-intro">
        Optional. A longer piece of writing, or a photograph that deserves a
        page of its own. These go in alongside your own page.
      </p>

      {extras.map((x) => (
        <div class="card">
          <h3>{titleOf(x)}</h3>
          <p class="card-meta">
            {x.page_type === 'article' ? 'A written piece' : 'A photograph'}
            {' · '}{STATUS_WORD[x.status] ?? x.status}
          </p>
          <p style="margin:0.6rem 0 0">
            <a class="back" href={`/souvenir/mine/extra/${x.id}`}>Change this</a>
          </p>
        </div>
      ))}

      <a class="btn btn-secondary btn-block" href="/souvenir/mine/extra/new?kind=article">
        <PlusIcon />
        Add a longer piece of writing
      </a>
      <p style="margin-top:0.75rem">
        <a class="btn btn-secondary btn-block" href="/souvenir/mine/extra/new?kind=photo">
          <PlusIcon />
          Add another photograph
        </a>
      </p>
    </Layout>,
  );
});

souvenirRoutes.post('/souvenir/mine', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();
  const heading = String(form.get('heading') ?? '').trim() || null;
  const blurb = String(form.get('blurb') ?? '').trim() || null;

  const existing = await c.env.DB
    .prepare(
      `SELECT id, then_media_id, now_media_id FROM flipbook_pages
        WHERE member_id = ?1 AND page_type = 'member'`,
    )
    .bind(viewer.id)
    .first<{ id: string; then_media_id: string | null; now_media_id: string | null }>();

  let thenId = existing?.then_media_id ?? null;
  let nowId = existing?.now_media_id ?? null;

  try {
    const thenFile = form.get('then');
    if (thenFile instanceof File && thenFile.size > 0) {
      if (kindOf(thenFile.type) !== 'photo') {
        throw new UploadError('The "then" file needs to be a photograph.');
      }
      thenId = (await storeUpload(c.env, thenFile, viewer.id, null, 'Back then')).id;
    }
    const nowFile = form.get('now');
    if (nowFile instanceof File && nowFile.size > 0) {
      if (kindOf(nowFile.type) !== 'photo') {
        throw new UploadError('The "now" file needs to be a photograph.');
      }
      nowId = (await storeUpload(c.env, nowFile, viewer.id, null, 'Now')).id;
    }
  } catch (err) {
    const msg = err instanceof UploadError
      ? err.message
      : 'Something went wrong with that photo. Please try again.';
    return c.html(
      <Layout title="My souvenir page" viewer={viewer} tab="book"
              back={{ href: '/souvenir/mine', label: 'Back' }}>
        <ErrorNotice title="We could not save that photo."><p>{msg}</p></ErrorNotice>
        <a class="btn btn-block" href="/souvenir/mine">Try again</a>
      </Layout>,
      400,
    );
  }

  // Any edit re-enters moderation: the souvenir is a public artefact, so the
  // same "admin approves before it goes live" rule applies as everywhere else.
  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE flipbook_pages
            SET heading = ?1, blurb = ?2, then_media_id = ?3, now_media_id = ?4,
                status = 'submitted', updated_at = unixepoch()
          WHERE id = ?5`,
      )
      .bind(heading, blurb, thenId, nowId, existing.id)
      .run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO flipbook_pages
           (id, member_id, page_type, heading, blurb, then_media_id, now_media_id, status)
         VALUES (?1, ?2, 'member', ?3, ?4, ?5, ?6, 'submitted')`,
      )
      .bind(newId(), viewer.id, heading, blurb, thenId, nowId)
      .run();
  }

  return c.redirect('/souvenir/mine', 303);
});

/* -- Extra pages ----------------------------------------------------------- */
const isKind = (v: string): v is 'article' | 'photo' => v === 'article' || v === 'photo';

const ExtraForm = (props: {
  viewer: ReturnType<typeof viewerOf>;
  kind: 'article' | 'photo';
  page?: SouvenirPageRow;
  error?: string;
}) => {
  const { kind, page } = props;
  const editing = Boolean(page);

  return (
    <Layout title={kind === 'article' ? 'A written piece' : 'A photograph'}
            viewer={props.viewer} tab="book"
            back={{ href: '/souvenir/mine', label: 'My souvenir page' }}>
      <h1>{kind === 'article' ? 'A longer piece of writing' : 'A photograph of its own'}</h1>
      <p class="page-intro">
        {kind === 'article'
          ? 'This gets its own pages in the book. Write as much as you like — it will run on for as many pages as it needs.'
          : 'One photograph, printed large, with a line underneath saying what it is.'}
      </p>

      {props.error && (
        <ErrorNotice title="That did not save."><p>{props.error}</p></ErrorNotice>
      )}

      <form method="post"
            action={editing ? `/souvenir/mine/extra/${page!.id}` : '/souvenir/mine/extra/new'}
            enctype="multipart/form-data">
        <input type="hidden" name="kind" value={kind} />

        <div class="field">
          <label for="heading">{kind === 'article' ? 'A title for it' : 'What is this a photograph of?'}</label>
          <input id="heading" name="heading" type="text" maxlength={100}
                 value={page?.heading ?? ''} required />
        </div>

        {kind === 'photo' && (
          <div class="field">
            <label for="photo">The photograph</label>
            <span class="hint">
              {page?.then_media_id
                ? 'You have one already. Choose a file only if you want to change it.'
                : 'Landscape or portrait — either prints well.'}
            </span>
            {page?.then_media_id && (
              <img src={`/media/${page.then_media_id}`} alt="The photograph on this page"
                   style="max-width:220px;border-radius:10px;margin-bottom:0.5rem;display:block" />
            )}
            <input id="photo" name="photo" type="file" accept="image/*"
                   required={!page?.then_media_id} />
          </div>
        )}

        <div class="field">
          <label for="blurb">{kind === 'article' ? 'The writing' : 'A line underneath'}</label>
          <span class="hint">
            {kind === 'article'
              ? 'Leave a blank line between paragraphs.'
              : 'Who is in it, where it was taken, what year.'}
          </span>
          <textarea id="blurb" name="blurb"
                    style={kind === 'article' ? 'min-height:18rem' : 'min-height:5rem'}
                    required={kind === 'article'}>{page?.blurb ?? ''}</textarea>
        </div>

        <button class="btn btn-block" type="submit">
          {editing ? 'Save and send for approval' : 'Add this to the book'}
        </button>
      </form>

      {editing && (
        <>
          <h2 class="section-title">Remove this</h2>
          <p class="page-intro">It will be taken out of the book. Your own page stays.</p>
          <form method="post" action={`/souvenir/mine/extra/${page!.id}/delete`}>
            <button class="btn btn-secondary btn-block" type="submit">
              Take this page out
            </button>
          </form>
        </>
      )}
    </Layout>
  );
};

souvenirRoutes.get('/souvenir/mine/extra/new', requireAuth, (c) => {
  const kind = String(c.req.query('kind') ?? 'article');
  if (!isKind(kind)) return c.notFound();
  return c.html(<ExtraForm viewer={viewerOf(c)} kind={kind} />);
});

/** Read one of this member's own extra pages, or null. */
function extraFor(db: D1Database, id: string, memberId: string) {
  return db
    .prepare(
      `SELECT f.id, f.page_type, f.heading, f.blurb, f.then_media_id, f.now_media_id,
              COALESCE(m.preferred_name, m.full_name) AS member_name
         FROM flipbook_pages f
         JOIN members m ON m.id = f.member_id
        WHERE f.id = ?1 AND f.member_id = ?2 AND f.page_type IN ('article','photo')`,
    )
    .bind(id, memberId)
    .first<SouvenirPageRow>();
}

souvenirRoutes.get('/souvenir/mine/extra/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const page = await extraFor(c.env.DB, c.req.param('id'), viewer.id);
  if (!page || !isKind(page.page_type)) return c.notFound();
  return c.html(<ExtraForm viewer={viewer} kind={page.page_type} page={page} />);
});

/** Create or update — the two differ only in whether a row already exists. */
async function saveExtra(c: Context<AppBindings>, existing: SouvenirPageRow | null) {
  const viewer = viewerOf(c);
  const form = await c.req.formData();
  const kind = String(form.get('kind') ?? '');
  if (!isKind(kind)) return c.redirect('/souvenir/mine', 303);

  const heading = String(form.get('heading') ?? '').trim();
  const blurb = String(form.get('blurb') ?? '').trim() || null;

  const fail = (error: string) =>
    c.html(<ExtraForm viewer={viewer} kind={kind} page={existing ?? undefined} error={error} />, 400);

  if (!heading) return fail('Please give it a title so it can be found in the book.');
  if (kind === 'article' && !blurb) return fail('There is nothing to print yet — write a few words.');

  let photoId = existing?.then_media_id ?? null;
  const file = form.get('photo');
  if (file instanceof File && file.size > 0) {
    if (kindOf(file.type) !== 'photo') return fail('That file is not a photograph.');
    try {
      photoId = (await storeUpload(c.env, file, viewer.id, null, heading)).id;
    } catch (err) {
      return fail(err instanceof UploadError ? err.message
        : 'We could not save that photograph. Please try another one.');
    }
  }
  if (kind === 'photo' && !photoId) return fail('Please choose a photograph.');

  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE flipbook_pages
            SET heading = ?1, blurb = ?2, then_media_id = ?3,
                status = 'submitted', updated_at = unixepoch()
          WHERE id = ?4 AND member_id = ?5`,
      )
      .bind(heading, blurb, photoId, existing.id, viewer.id)
      .run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO flipbook_pages
           (id, member_id, page_type, heading, blurb, then_media_id, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'submitted')`,
      )
      .bind(newId(), viewer.id, kind, heading, blurb, photoId)
      .run();
  }

  return c.redirect('/souvenir/mine', 303);
}

souvenirRoutes.post('/souvenir/mine/extra/new', requireAuth, (c) => saveExtra(c, null));

souvenirRoutes.post('/souvenir/mine/extra/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const existing = await extraFor(c.env.DB, c.req.param('id'), viewer.id);
  if (!existing) return c.notFound();
  return saveExtra(c, existing);
});

souvenirRoutes.post('/souvenir/mine/extra/:id/delete', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  // Scoped to this member's own rows, so an id from somewhere else does nothing.
  await c.env.DB
    .prepare(
      `DELETE FROM flipbook_pages
        WHERE id = ?1 AND member_id = ?2 AND page_type IN ('article','photo')`,
    )
    .bind(c.req.param('id'), viewer.id)
    .run();

  return c.redirect('/souvenir/mine', 303);
});
