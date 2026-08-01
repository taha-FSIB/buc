import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { requireAuth, viewerOf } from '../lib/guard';
import { storeUpload, UploadError } from '../lib/media';
import { newId } from '../lib/ids';

export const souvenirRoutes = new Hono<AppBindings>();

interface PageRow {
  id: string;
  member_id: string | null;
  page_type: string;
  heading: string | null;
  blurb: string | null;
  then_media_id: string | null;
  now_media_id: string | null;
  status: string;
  member_name: string | null;
}

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
souvenirRoutes.get('/souvenir', async (c) => {
  const viewer = c.get('viewer');
  const { results } = await c.env.DB.prepare(APPROVED_PAGES).all<PageRow>();

  // One page at a time, with real URLs — a paginated book rather than an
  // infinite scroll. ?page=N is bookmarkable and the Back button works.
  const index = Math.max(0, Math.min(results.length - 1, Number(c.req.query('page') ?? '0') || 0));
  const page = results[index];

  return c.html(
    <Layout title="Souvenir" viewer={viewer ?? null} tab="book">
      <h1>Reunion souvenir</h1>

      {results.length === 0 ? (
        <div class="empty">
          <h2>The souvenir is still being made</h2>
          <p>
            Every member gets a page — a photo from back then, a photo from
            now, and a few words. Yours can be the first.
          </p>
          {viewer && <a class="btn" href="/souvenir/mine">Make my page</a>}
        </div>
      ) : (
        // The island replaces everything inside this div once it loads. What
        // is rendered below is the no-JavaScript fallback: a real page with
        // real links that works on its own.
        <div data-island="flipbook" data-props="flipbook-props">
          <p class="page-intro">
            Page {index + 1} of {results.length}
          </p>

          <article class="flip-page">
            <h2>{page.heading || page.member_name || 'Our batch'}</h2>
            {(page.then_media_id || page.now_media_id) && (
              <div class="then-now">
                <figure>
                  {page.then_media_id && (
                    <img src={`/media/${page.then_media_id}`}
                         alt={`${page.member_name ?? 'A member'}, back then`} loading="lazy" />
                  )}
                  <figcaption>Then</figcaption>
                </figure>
                <figure>
                  {page.now_media_id && (
                    <img src={`/media/${page.now_media_id}`}
                         alt={`${page.member_name ?? 'A member'}, now`} loading="lazy" />
                  )}
                  <figcaption>Now</figcaption>
                </figure>
              </div>
            )}
            {page.blurb && page.blurb.split(/\n{2,}/).map((p) => <p>{p}</p>)}
          </article>

          <nav class="flip-nav" aria-label="Souvenir pages">
            {index > 0
              ? <a class="btn btn-secondary" href={`/souvenir?page=${index - 1}`}>Previous page</a>
              : <span />}
            {index < results.length - 1
              ? <a class="btn" href={`/souvenir?page=${index + 1}`}>Next page</a>
              : <span />}
          </nav>
        </div>
      )}

      {results.length > 0 && (
        <>
          <script
            type="application/json"
            id="flipbook-props"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                start: index,
                pages: results.map((p) => ({
                  id: p.id,
                  heading: p.heading,
                  blurb: p.blurb,
                  memberName: p.member_name,
                  thenId: p.then_media_id,
                  nowId: p.now_media_id,
                })),
              }).replace(/</g, '\\u003c'),
            }}
          />
          <script src="/islands.js" defer></script>
        </>
      )}

      {viewer && (
        <p style="margin-top:2rem">
          <a class="back" href="/souvenir/mine">My souvenir page</a>
        </p>
      )}
    </Layout>,
  );
});

/* -- My page --------------------------------------------------------------- */
souvenirRoutes.get('/souvenir/mine', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  const page = await c.env.DB
    .prepare(
      `SELECT id, heading, blurb, then_media_id, now_media_id, status
         FROM flipbook_pages
        WHERE member_id = ?1 AND page_type = 'member'`,
    )
    .bind(viewer.id)
    .first<PageRow>();

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
          <p>An admin will look at it before it goes into the souvenir.</p>
        </div>
      )}
      {page?.status === 'approved' && (
        <div class="notice">
          <strong>Your page is in the souvenir.</strong>
          <p>You can still change it — it will be looked at again.</p>
        </div>
      )}

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
            {page?.then_media_id ? 'You have one already. Choose a file only if you want to change it.' : 'From our BUC days.'}
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
            {page?.now_media_id ? 'You have one already. Choose a file only if you want to change it.' : 'However you look today.'}
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
      thenId = (await storeUpload(c.env, thenFile, viewer.id, null, 'Back then')).id;
    }
    const nowFile = form.get('now');
    if (nowFile instanceof File && nowFile.size > 0) {
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
