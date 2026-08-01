import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout } from '../views/layout';
import { requireAuth, viewerOf } from '../lib/guard';

export const moreRoutes = new Hono<AppBindings>();


/* -- More ------------------------------------------------------------------ */
moreRoutes.get('/more', requireAuth, (c) => {
  const viewer = viewerOf(c);
  return c.html(
    <Layout title="More" viewer={viewer} tab="more">
      <h1>More</h1>

      <a class="card" href="/reunion">
        <h2>The reunion</h2>
        <p class="card-meta">28-29 August · details and your answer</p>
      </a>
      <a class="card" href="/members">
        <h2>The batch</h2>
        <p class="card-meta">Everyone who has joined so far</p>
      </a>
      <a class="card" href="/profile">
        <h2>My details</h2>
        <p class="card-meta">Your name, email and phone number</p>
      </a>
      <a class="card" href="/souvenir/mine">
        <h2>My souvenir page</h2>
        <p class="card-meta">Your page in the reunion souvenir</p>
      </a>
      <a class="card" href="/public">
        <h2>Our public pages</h2>
        <p class="card-meta">What the wider world can see</p>
      </a>

      {viewer.role === 'admin' && (
        <a class="card" href="/admin">
          <h2>Admin</h2>
          <p class="card-meta">Approvals, invitations and members</p>
        </a>
      )}

      <form method="post" action="/signout" style="margin-top:2rem">
        <button class="btn btn-secondary btn-block" type="submit">Sign out</button>
      </form>
    </Layout>,
  );
});

/* -- The batch directory --------------------------------------------------- */
moreRoutes.get('/members', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, COALESCE(preferred_name, full_name) AS name
         FROM members WHERE status = 'active' ORDER BY name`,
    )
    .all<{ id: string; name: string }>();

  return c.html(
    <Layout title="The batch" viewer={viewer} tab="more" back={{ href: '/more', label: 'More' }}>
      <h1>The batch</h1>
      <p class="page-intro">
        {results.length} of us have joined so far.
      </p>
      <ul class="directory">
        {results.map((m) => (
          <li><a href={`/members/${m.id}`}>{m.name}</a></li>
        ))}
      </ul>
    </Layout>,
  );
});

/* -- One member ------------------------------------------------------------ */
moreRoutes.get('/members/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const member = await c.env.DB
    .prepare(
      `SELECT id, full_name, preferred_name FROM members
        WHERE id = ?1 AND status = 'active'`,
    )
    .bind(id)
    .first<{ id: string; full_name: string; preferred_name: string | null }>();
  if (!member) return c.notFound();

  // Their souvenir page, if it has been approved.
  const page = await c.env.DB
    .prepare(
      `SELECT heading, blurb, then_media_id, now_media_id
         FROM flipbook_pages
        WHERE member_id = ?1 AND page_type = 'member' AND status = 'approved'`,
    )
    .bind(id)
    .first<{ heading: string | null; blurb: string | null; then_media_id: string | null; now_media_id: string | null }>();

  // Only what this member has actually shared with the viewer.
  const { results: posts } = await c.env.DB
    .prepare(
      `SELECT p.id, p.title
         FROM posts p
         JOIN post_shares s ON s.post_id = p.id
    LEFT JOIN group_members g
           ON g.group_id = s.audience_id AND g.member_id = ?1 AND g.state = 'active'
    LEFT JOIN public_submissions sub ON sub.post_id = p.id
        WHERE p.author_id = ?2
          AND p.state = 'posted'
          AND (
            (s.audience_kind = 'member' AND s.audience_id = ?1)
            OR (s.audience_kind = 'group'  AND g.member_id IS NOT NULL)
            OR (s.audience_kind = 'public' AND sub.status = 'approved')
          )
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT 20`,
    )
    .bind(viewer.id, id)
    .all<{ id: string; title: string | null }>();

  const name = member.preferred_name ?? member.full_name;

  return c.html(
    <Layout title={name} viewer={viewer} tab="more" back={{ href: '/members', label: 'The batch' }}>
      <h1>{name}</h1>
      {member.preferred_name && member.preferred_name !== member.full_name && (
        <p class="card-meta">{member.full_name}</p>
      )}

      {page && (
        <article class="flip-page">
          <div class="then-now">
            <figure>
              {page.then_media_id && (
                <img src={`/media/${page.then_media_id}`} alt={`${name}, back then`} loading="lazy" />
              )}
              <figcaption>Then</figcaption>
            </figure>
            <figure>
              {page.now_media_id && (
                <img src={`/media/${page.now_media_id}`} alt={`${name}, now`} loading="lazy" />
              )}
              <figcaption>Now</figcaption>
            </figure>
          </div>
          {page.blurb && page.blurb.split(/\n{2,}/).map((p) => <p>{p}</p>)}
        </article>
      )}

      <h2 class="section-title">Shared with you</h2>
      {posts.length === 0 ? (
        <p class="page-intro">
          {name} has not shared anything with you yet.
        </p>
      ) : (
        posts.map((p) => (
          <a class="card" href={`/post/${p.id}`}>
            <h2>{p.title || 'Untitled'}</h2>
          </a>
        ))
      )}
    </Layout>,
  );
});

/* -- My details ------------------------------------------------------------ */
moreRoutes.get('/profile', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const me = await c.env.DB
    .prepare('SELECT full_name, preferred_name, email, phone FROM members WHERE id = ?1')
    .bind(viewer.id)
    .first<{ full_name: string; preferred_name: string | null; email: string; phone: string | null }>();

  return c.html(
    <Layout title="My details" viewer={viewer} tab="more" back={{ href: '/more', label: 'More' }}>
      <h1>My details</h1>
      <form method="post" action="/profile">
        <div class="field">
          <label for="full_name">Your full name</label>
          <input id="full_name" name="full_name" type="text" value={me?.full_name ?? ''} required />
        </div>
        <div class="field">
          <label for="preferred_name">What friends call you</label>
          <span class="hint">This is the name others will see.</span>
          <input id="preferred_name" name="preferred_name" type="text"
                 value={me?.preferred_name ?? ''} />
        </div>
        <div class="field">
          <label for="email">Your email</label>
          <span class="hint">You sign in with this.</span>
          <input id="email" name="email" type="email" value={me?.email ?? ''} required />
        </div>
        <div class="field">
          <label for="phone">Your WhatsApp number</label>
          <span class="hint">Optional. Only other members can see it.</span>
          <input id="phone" name="phone" type="tel" value={me?.phone ?? ''} />
        </div>
        <button class="btn btn-block" type="submit">Save my details</button>
      </form>
    </Layout>,
  );
});

moreRoutes.post('/profile', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const preferred = String(form.get('preferred_name') ?? '').trim() || null;
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phone = String(form.get('phone') ?? '').trim() || null;

  if (!fullName || !email) return c.redirect('/profile', 303);

  await c.env.DB
    .prepare(
      `UPDATE members
          SET full_name = ?1, preferred_name = ?2, email = ?3, phone = ?4,
              updated_at = unixepoch()
        WHERE id = ?5`,
    )
    .bind(fullName, preferred, email, phone, viewer.id)
    .run();

  return c.redirect('/more', 303);
});
