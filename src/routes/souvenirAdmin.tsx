import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout } from '../views/layout';
import { requireAdmin, viewerOf } from '../lib/guard';
import { buildSouvenirPdf, type SouvenirPage } from '../lib/souvenirPdf';

export const souvenirAdminRoutes = new Hono<AppBindings>();

/* -- Compilation view ------------------------------------------------------ */
souvenirAdminRoutes.get('/admin/souvenir/compile', requireAdmin, async (c) => {
  const viewer = viewerOf(c);

  const progress = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM members WHERE status = 'active') AS members,
         (SELECT COUNT(DISTINCT member_id) FROM flipbook_pages
           WHERE page_type = 'member' AND status IN ('submitted','approved')) AS submitted,
         (SELECT COUNT(*) FROM flipbook_pages WHERE status = 'approved')  AS approved,
         (SELECT COUNT(*) FROM flipbook_pages WHERE status = 'submitted') AS waiting`,
    )
    .first<{ members: number; submitted: number; approved: number; waiting: number }>();

  const { results: pages } = await c.env.DB
    .prepare(
      `SELECT f.id, f.heading, f.sort_order, f.status,
              COALESCE(m.preferred_name, m.full_name) AS member_name,
              (f.then_media_id IS NOT NULL) AS has_then,
              (f.now_media_id IS NOT NULL)  AS has_now
         FROM flipbook_pages f
         LEFT JOIN members m ON m.id = f.member_id
        WHERE f.status = 'approved'
        ORDER BY f.sort_order, member_name`,
    )
    .all<{
      id: string; heading: string | null; sort_order: number; status: string;
      member_name: string | null; has_then: number; has_now: number;
    }>();

  const { results: missing } = await c.env.DB
    .prepare(
      `SELECT COALESCE(preferred_name, full_name) AS name FROM members
        WHERE status = 'active'
          AND id NOT IN (SELECT member_id FROM flipbook_pages
                          WHERE page_type = 'member' AND member_id IS NOT NULL)
        ORDER BY name`,
    )
    .all<{ name: string }>();

  const members = progress?.members ?? 0;
  const submitted = progress?.submitted ?? 0;
  const pct = members > 0 ? Math.round((submitted / members) * 100) : 0;

  return c.html(
    <Layout title="Put the souvenir together" viewer={viewer} tab="more"
            back={{ href: '/admin', label: 'Admin' }}>
      <h1>Put the souvenir together</h1>

      <div class="card">
        <h2>{submitted} of {members} members have sent their page</h2>
        <div class="progress" role="img"
             aria-label={`${pct} percent of members have submitted a page`}>
          <span style={`width:${pct}%`}></span>
        </div>
        <p class="card-meta" style="margin-top:0.6rem">
          {progress?.approved ?? 0} approved · {progress?.waiting ?? 0} waiting for you
          {(progress?.waiting ?? 0) > 0 && (
            <> · <a href="/admin/souvenir">review them</a></>
          )}
        </p>
      </div>

      <h2 class="section-title">The book, in order</h2>
      {pages.length === 0 ? (
        <div class="empty">
          <h3>No approved pages yet</h3>
          <p>Approved pages appear here, ready to be ordered and printed.</p>
          <a class="btn" href="/admin/souvenir">Review what has been sent in</a>
        </div>
      ) : (
        <>
          <p class="page-intro">
            Lower numbers print first. Leave them all at 0 to print alphabetically.
          </p>
          <form method="post" action="/admin/souvenir/order">
            {pages.map((p, i) => (
              <div class="card">
                <h3>{i + 1}. {p.heading || p.member_name || 'Untitled'}</h3>
                <p class="card-meta">
                  {p.has_then ? 'then ✓' : 'no “then” photo'} ·{' '}
                  {p.has_now ? 'now ✓' : 'no “now” photo'}
                </p>
                <div class="field" style="margin:0">
                  <label for={`o-${p.id}`}>Print position</label>
                  <input id={`o-${p.id}`} name={`order_${p.id}`} type="number"
                         inputmode="numeric" value={String(p.sort_order)} />
                </div>
              </div>
            ))}
            <button class="btn btn-block" type="submit">Save this order</button>
          </form>

          <h2 class="section-title">Print it</h2>
          <p class="page-intro">
            Makes one PDF of every approved page, cover included. Give this file
            to the printer, or read it on a phone.
          </p>
          <a class="btn btn-block" href="/admin/souvenir/pdf">Download the souvenir PDF</a>
        </>
      )}

      {missing.length > 0 && (
        <>
          <h2 class="section-title">Still to send a page</h2>
          <p class="page-intro">
            {missing.length} {missing.length === 1 ? 'person' : 'people'}. Worth a
            WhatsApp nudge — they need time to find an old photograph.
          </p>
          <ul class="directory">
            {/* Names, not links — see the same list on /admin/reunion. */}
            {missing.map((m) => <li><span class="directory-row">{m.name}</span></li>)}
          </ul>
        </>
      )}
    </Layout>,
  );
});

souvenirAdminRoutes.post('/admin/souvenir/order', requireAdmin, async (c) => {
  const form = await c.req.formData();

  // Driven by the ids in the database rather than by iterating the form, so a
  // hand-crafted field name cannot reorder a page that is not approved yet.
  const { results: pages } = await c.env.DB
    .prepare(`SELECT id FROM flipbook_pages WHERE status = 'approved'`)
    .all<{ id: string }>();

  const updates = pages
    .map(({ id }) => ({ id, raw: form.get(`order_${id}`) }))
    .filter((row) => row.raw !== null)
    .map(({ id, raw }) =>
      c.env.DB
        .prepare('UPDATE flipbook_pages SET sort_order = ?1 WHERE id = ?2')
        .bind(Number(raw) || 0, id),
    );

  if (updates.length) await c.env.DB.batch(updates);
  return c.redirect('/admin/souvenir/compile', 303);
});

/* -- The PDF --------------------------------------------------------------- */
souvenirAdminRoutes.get('/admin/souvenir/pdf', requireAdmin, async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT f.id, f.page_type, f.heading, f.blurb,
              COALESCE(m.preferred_name, m.full_name) AS member_name,
              t.r2_key AS then_key,
              n.r2_key AS now_key
         FROM flipbook_pages f
         LEFT JOIN members m ON m.id = f.member_id
         LEFT JOIN media t   ON t.id = f.then_media_id
         LEFT JOIN media n   ON n.id = f.now_media_id
        WHERE f.status = 'approved'
        ORDER BY f.sort_order, member_name`,
    )
    .all<SouvenirPage>();

  if (results.length === 0) return c.redirect('/admin/souvenir/compile', 303);

  // ASSETS carries the Noto fonts, without which Tamil and Sinhala pages fall
  // back to Latin and print nothing of what their member actually wrote.
  const bytes = await buildSouvenirPdf(
    results, c.env.MEDIA, undefined, c.env.ASSETS,
  );
  // Copy out to a standalone ArrayBuffer: the Response body type will not take
  // a view whose backing buffer is wider than the view itself.
  const body = bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="buc-reunion-souvenir.pdf"',
      'cache-control': 'no-store',
    },
  });
});
