import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { requireAdmin, viewerOf } from '../lib/guard';
import { newId, newInviteCode } from '../lib/ids';
import {
  generateLoginCode, hashLoginCode, createLoginLink, type LinkPurpose,
} from '../lib/auth';
import {
  emailConfigured, sendInviteLink, sendSignInLink, siteOrigin, type SendResult,
} from '../lib/mailer';

export const adminRoutes = new Hono<AppBindings>();


const RESET_CODE_TTL = 60 * 60 * 24; // 24 hours

async function log(
  db: D1Database, actorId: string, action: string,
  targetKind: string, targetId: string, detail?: string,
) {
  await db
    .prepare(
      `INSERT INTO audit_log (id, actor_id, action, target_kind, target_id, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(newId(), actorId, action, targetKind, targetId, detail ?? null)
    .run();
}

/* -- Admin home ------------------------------------------------------------ */
adminRoutes.get('/admin', requireAdmin, async (c) => {
  const viewer = viewerOf(c);

  const counts = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM public_submissions WHERE status = 'pending') AS posts,
         (SELECT COUNT(*) FROM flipbook_pages WHERE status = 'submitted')  AS pages,
         (SELECT COUNT(*) FROM members WHERE status = 'invited')           AS invited`,
    )
    .first<{ posts: number; pages: number; invited: number }>();

  return c.html(
    <Layout title="Admin" viewer={viewer} tab="more" back={{ href: '/more', label: 'More' }}>
      <h1>Admin</h1>
      <p class="page-intro">
        Nothing reaches the public pages without one of us reading it first.
      </p>

      <a class="card" href="/admin/queue">
        <h2>Memories waiting for approval</h2>
        <p class="card-meta">{counts?.posts ?? 0} waiting</p>
      </a>
      <a class="card" href="/admin/reunion">
        <h2>Who is coming to the reunion</h2>
        <p class="card-meta">Headcount, food and access notes</p>
      </a>
      <a class="card" href="/admin/souvenir">
        <h2>Souvenir pages waiting for approval</h2>
        <p class="card-meta">{counts?.pages ?? 0} waiting</p>
      </a>
      <a class="card" href="/admin/souvenir/compile">
        <h2>Compile the souvenir</h2>
        <p class="card-meta">Order the pages and download the PDF</p>
      </a>
      <a class="card" href="/admin/members">
        <h2>Members</h2>
        <p class="card-meta">
          Invite someone, or help a friend who is locked out
          {(counts?.invited ?? 0) > 0 && ` · ${counts?.invited} not signed in yet`}
        </p>
      </a>
    </Layout>,
  );
});

/* -- Moderation queue ------------------------------------------------------ */
adminRoutes.get('/admin/queue', requireAdmin, async (c) => {
  const viewer = viewerOf(c);

  const { results } = await c.env.DB
    .prepare(
      `SELECT p.id, p.title, p.body, p.medium,
              COALESCE(m.preferred_name, m.full_name) AS author_name,
              s.created_at
         FROM public_submissions s
         JOIN posts p   ON p.id = s.post_id
         JOIN members m ON m.id = p.author_id
        WHERE s.status = 'pending'
        ORDER BY s.created_at`,
    )
    .all<{ id: string; title: string; body: string | null; medium: string; author_name: string }>();

  return c.html(
    <Layout title="Waiting for approval" viewer={viewer} tab="more"
            back={{ href: '/admin', label: 'Admin' }}>
      <h1>Waiting for approval</h1>
      <p class="page-intro">
        These members have offered a memory to the public pages. Nothing here
        is visible to anyone outside the batch yet.
      </p>

      {results.length === 0 ? (
        <div class="empty">
          <h2>Nothing waiting</h2>
          <p>Everything offered to the public pages has been dealt with.</p>
          <a class="btn" href="/admin">Back to admin</a>
        </div>
      ) : (
        results.map((p) => (
          <div class="card">
            <h2>{p.title || 'Untitled'}</h2>
            <p class="card-meta">{p.author_name}</p>
            {p.body && <p class="card-body">{p.body.slice(0, 400)}</p>}
            <p style="margin:0.75rem 0">
              <a class="back" href={`/post/${p.id}`}>Read the whole thing</a>
            </p>

            <form method="post" action={`/admin/queue/${p.id}`}>
              <input type="hidden" name="decision" value="approved" />
              <button class="btn btn-block" type="submit">
                Approve — put this on the public pages
              </button>
            </form>

            <form method="post" action={`/admin/queue/${p.id}`} style="margin-top:0.75rem">
              <input type="hidden" name="decision" value="rejected" />
              <div class="field">
                <label for={`note-${p.id}`}>If you say no, tell them why</label>
                <span class="hint">
                  They will see this. A kind sentence saves a phone call.
                </span>
                <input id={`note-${p.id}`} name="note" type="text" maxlength={300} />
              </div>
              <button class="btn btn-secondary btn-block" type="submit">
                Not for the public pages
              </button>
            </form>
          </div>
        ))
      )}
    </Layout>,
  );
});

adminRoutes.post('/admin/queue/:postId', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const postId = c.req.param('postId');
  const form = await c.req.formData();
  const decision = String(form.get('decision') ?? '');
  const note = String(form.get('note') ?? '').trim() || null;

  if (decision !== 'approved' && decision !== 'rejected') {
    return c.redirect('/admin/queue', 303);
  }

  await c.env.DB
    .prepare(
      `UPDATE public_submissions
          SET status = ?1, reviewed_by = ?2, reviewed_at = unixepoch(), review_note = ?3
        WHERE post_id = ?4 AND status = 'pending'`,
    )
    .bind(decision, viewer.id, note, postId)
    .run();

  await log(c.env.DB, viewer.id, `public_${decision}`, 'post', postId, note ?? undefined);
  return c.redirect('/admin/queue', 303);
});

/* -- Souvenir page approval ------------------------------------------------ */
adminRoutes.get('/admin/souvenir', requireAdmin, async (c) => {
  const viewer = viewerOf(c);

  const { results } = await c.env.DB
    .prepare(
      `SELECT f.id, f.heading, f.blurb, f.then_media_id, f.now_media_id,
              COALESCE(m.preferred_name, m.full_name) AS member_name
         FROM flipbook_pages f
         LEFT JOIN members m ON m.id = f.member_id
        WHERE f.status = 'submitted'
        ORDER BY f.sort_order, f.created_at`,
    )
    .all<{
      id: string; heading: string | null; blurb: string | null;
      then_media_id: string | null; now_media_id: string | null; member_name: string | null;
    }>();

  return c.html(
    <Layout title="Souvenir pages" viewer={viewer} tab="more"
            back={{ href: '/admin', label: 'Admin' }}>
      <h1>Souvenir pages</h1>
      <p class="page-intro">These go into the reunion souvenir once approved.</p>

      {results.length === 0 ? (
        <div class="empty">
          <h2>Nothing waiting</h2>
          <p>Every submitted page has been dealt with.</p>
          <a class="btn" href="/admin">Back to admin</a>
        </div>
      ) : (
        results.map((p) => (
          <div class="flip-page">
            <h2>{p.heading || p.member_name || 'Untitled page'}</h2>
            <div class="then-now">
              <figure>
                {p.then_media_id
                  ? <img src={`/media/${p.then_media_id}`} alt="" loading="lazy" />
                  : <div class="then-now-empty" />}
                <figcaption>Then</figcaption>
              </figure>
              <figure>
                {p.now_media_id
                  ? <img src={`/media/${p.now_media_id}`} alt="" loading="lazy" />
                  : <div class="then-now-empty" />}
                <figcaption>Now</figcaption>
              </figure>
            </div>
            {p.blurb && <p>{p.blurb}</p>}

            <form method="post" action={`/admin/souvenir/${p.id}`}>
              <input type="hidden" name="decision" value="approved" />
              <button class="btn btn-block" type="submit">Approve this page</button>
            </form>
            <form method="post" action={`/admin/souvenir/${p.id}`} style="margin-top:0.75rem">
              <input type="hidden" name="decision" value="draft" />
              <button class="btn btn-secondary btn-block" type="submit">
                Send back for changes
              </button>
            </form>
          </div>
        ))
      )}
    </Layout>,
  );
});

adminRoutes.post('/admin/souvenir/:pageId', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const pageId = c.req.param('pageId');
  const decision = String((await c.req.formData()).get('decision') ?? '');

  if (decision !== 'approved' && decision !== 'draft') {
    return c.redirect('/admin/souvenir', 303);
  }

  await c.env.DB
    .prepare(
      `UPDATE flipbook_pages SET status = ?1, updated_at = unixepoch() WHERE id = ?2`,
    )
    .bind(decision, pageId)
    .run();

  await log(c.env.DB, viewer.id, `souvenir_${decision}`, 'flipbook_page', pageId);
  return c.redirect('/admin/souvenir', 303);
});

/* -- Members: invite and rescue -------------------------------------------- */

/**
 * What an admin sees after making a link. Whether or not the email went out,
 * the link itself is on screen to be copied into WhatsApp — which is how most
 * of these will actually reach people.
 */
function LinkHandout(props: {
  viewer: ReturnType<typeof viewerOf>;
  name: string;
  url: string;
  code?: string;
  result: SendResult;
  configured: boolean;
}) {
  const { result, configured } = props;
  return (
    <Layout title="Their link" viewer={props.viewer} tab="more"
            back={{ href: '/admin/members', label: 'Members' }}>
      <h1>A link for {props.name}</h1>

      {result.sent ? (
        <div class="notice" role="status">
          <strong>Emailed to them.</strong>
          <p>Send the link below as well if you want to be sure.</p>
        </div>
      ) : configured ? (
        <ErrorNotice title="The email did not go out.">
          <p>Nothing is lost — send them the link below on WhatsApp instead.</p>
        </ErrorNotice>
      ) : (
        <div class="notice" role="status">
          <strong>Send this to them yourself.</strong>
          <p>This site does not send email. WhatsApp is usually quicker anyway.</p>
        </div>
      )}

      <div class="field">
        <label for="handout">Their link</label>
        <span class="hint">
          Tap and hold to copy. It works once, and only for them.
        </span>
        <input id="handout" type="text" value={props.url} readonly
               onfocus="this.select()" />
      </div>

      {props.code && (
        <p>
          If they would rather type something in, their invitation code is{' '}
          <strong>{props.code}</strong>.
        </p>
      )}

      <a class="btn btn-block" href="/admin/members">Back to members</a>
    </Layout>
  );
}

adminRoutes.get('/admin/members', requireAdmin, async (c) => {
  const viewer = viewerOf(c);

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, full_name, email, status, role, invite_code, batch_year, location
         FROM members ORDER BY status, full_name`,
    )
    .all<{
      id: string; full_name: string; email: string; status: string; role: string;
      invite_code: string | null; batch_year: number | null; location: string | null;
    }>();

  const canEmail = emailConfigured(c.env);

  return c.html(
    <Layout title="Members" viewer={viewer} tab="more" back={{ href: '/admin', label: 'Admin' }}>
      <h1>Members</h1>

      <h2 class="section-title">Add someone</h2>
      <p class="page-intro">
        {canEmail
          ? 'They get an email with a link to come straight in — nothing to set up, no password to invent.'
          : 'This makes a link and a code you can send them on WhatsApp. Either one lets them straight in.'}
      </p>
      <form method="post" action="/admin/members/invite">
        <div class="field">
          <label for="full_name">Their full name</label>
          <input id="full_name" name="full_name" type="text" required />
        </div>
        <div class="field">
          <label for="email">Their email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div class="field">
          <label for="batch_year">The year they finished at BUC</label>
          <span class="hint">Optional — they can fill it in themselves.</span>
          <input id="batch_year" name="batch_year" type="number" inputmode="numeric"
                 min="1960" max="2030" />
        </div>
        <button class="btn btn-block" type="submit">Add them and make a link</button>
      </form>

      <h2 class="section-title">Everyone</h2>
      {results.map((m) => (
        <div class="card">
          <h3>{m.full_name}{m.role === 'admin' && ' · admin'}</h3>
          <p class="card-meta">
            {m.email} · {m.status}
            {m.batch_year && ` · finished ${m.batch_year}`}
            {m.location && ` · ${m.location}`}
          </p>

          {m.invite_code && (
            <p>
              Invitation code: <strong>{m.invite_code}</strong>
              <br />
              <span class="card-meta">It stops working once used.</span>
            </p>
          )}

          {m.status !== 'suspended' && (
            <form method="post" action={`/admin/members/${m.id}/link`}>
              <button class="btn btn-secondary btn-compact" type="submit">
                {m.status === 'invited' ? 'Make a new invitation link' : 'Make a sign-in link'}
              </button>
            </form>
          )}

          {m.status === 'active' && (
            <form method="post" action={`/admin/members/${m.id}/reset`}
                  style="margin-top:0.6rem">
              <button class="btn btn-secondary btn-compact" type="submit">
                Make a passphrase reset code
              </button>
            </form>
          )}
        </div>
      ))}
    </Layout>,
  );
});

adminRoutes.post('/admin/members/invite', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const yearRaw = String(form.get('batch_year') ?? '').trim();
  const batchYear = yearRaw && Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : null;

  if (!fullName || !email) return c.redirect('/admin/members', 303);

  const code = newInviteCode();
  let memberId = newId();

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO members (id, full_name, email, status, invite_code, batch_year)
         VALUES (?1, ?2, ?3, 'invited', ?4, ?5)`,
      )
      .bind(memberId, fullName, email, code, batchYear)
      .run();
  } catch {
    // Almost always a duplicate email. Re-issue for the existing row rather
    // than telling an admin off for inviting the same friend twice.
    const existing = await c.env.DB
      .prepare(
        `UPDATE members SET invite_code = ?1, batch_year = COALESCE(?2, batch_year)
          WHERE email = ?3 AND status = 'invited'
        RETURNING id`,
      )
      .bind(code, batchYear, email)
      .first<{ id: string }>();

    if (!existing) {
      return c.html(
        <Layout title="Members" viewer={viewer} tab="more"
                back={{ href: '/admin/members', label: 'Members' }}>
          <ErrorNotice title="They are already a member.">
            <p>
              {email} has an account and has signed in before. If they are
              locked out, make them a sign-in link from the list instead.
            </p>
          </ErrorNotice>
          <a class="btn btn-block" href="/admin/members">Back to members</a>
        </Layout>,
        409,
      );
    }
    memberId = existing.id;
  }

  const token = await createLoginLink(c.env.DB, memberId, 'invite');
  const url = `${siteOrigin(c.env, c.req.url)}/signin/link/${token}`;
  const result = await sendInviteLink(c.env, email, fullName, url, code);

  await log(c.env.DB, viewer.id, 'member_invited', 'member', memberId, email);

  return c.html(
    <LinkHandout viewer={viewer} name={fullName} url={url} code={code}
                 result={result} configured={emailConfigured(c.env)} />,
  );
});

/**
 * A link for someone who is stuck — never got the email, cannot find it, or
 * has changed address. The admin reads it out or pastes it into WhatsApp.
 */
adminRoutes.post('/admin/members/:id/link', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const memberId = c.req.param('id');

  const member = await c.env.DB
    .prepare(
      `SELECT full_name, preferred_name, email, status, invite_code
         FROM members WHERE id = ?1`,
    )
    .bind(memberId)
    .first<{
      full_name: string; preferred_name: string | null;
      email: string; status: string; invite_code: string | null;
    }>();

  if (!member) return c.notFound();
  if (member.status === 'suspended') return c.redirect('/admin/members', 303);

  const purpose: LinkPurpose = member.status === 'invited' ? 'invite' : 'signin';
  const name = member.preferred_name ?? member.full_name;
  const token = await createLoginLink(c.env.DB, memberId, purpose);
  const url = `${siteOrigin(c.env, c.req.url)}/signin/link/${token}`;

  const result = purpose === 'invite'
    ? await sendInviteLink(c.env, member.email, name, url, member.invite_code ?? '—')
    : await sendSignInLink(c.env, member.email, name, url);

  await log(c.env.DB, viewer.id, `${purpose}_link_issued`, 'member', memberId);

  return c.html(
    <LinkHandout viewer={viewer} name={name} url={url}
                 code={purpose === 'invite' ? member.invite_code ?? undefined : undefined}
                 result={result} configured={emailConfigured(c.env)} />,
  );
});

/**
 * Issue a one-time reset code. Shown once on screen so the admin can read it
 * out over WhatsApp or the phone — which is how this batch actually
 * communicates, and needs no mail server.
 */
adminRoutes.post('/admin/members/:id/reset', requireAdmin, async (c) => {
  const viewer = viewerOf(c);
  const memberId = c.req.param('id');

  const member = await c.env.DB
    .prepare('SELECT full_name FROM members WHERE id = ?1')
    .bind(memberId)
    .first<{ full_name: string }>();
  if (!member) return c.notFound();

  const code = generateLoginCode();

  await c.env.DB.batch([
    // Retire any earlier unused code so only one is ever live.
    c.env.DB
      .prepare(
        `UPDATE login_codes SET consumed_at = unixepoch()
          WHERE member_id = ?1 AND purpose = 'reset' AND consumed_at IS NULL`,
      )
      .bind(memberId),
    c.env.DB
      .prepare(
        `INSERT INTO login_codes (id, member_id, code_hash, purpose, expires_at)
         VALUES (?1, ?2, ?3, 'reset', unixepoch() + ?4)`,
      )
      .bind(newId(), memberId, await hashLoginCode(code), RESET_CODE_TTL),
  ]);

  await log(c.env.DB, viewer.id, 'reset_code_issued', 'member', memberId);

  return c.html(
    <Layout title="Reset code" viewer={viewer} tab="more"
            back={{ href: '/admin/members', label: 'Members' }}>
      <h1>Reset code for {member.full_name}</h1>
      <div class="notice">
        <strong style="font-size:2rem;letter-spacing:0.15em">{code}</strong>
        <p>
          Read this out to them, or send it on WhatsApp. It works once, and
          stops working after a day.
        </p>
      </div>
      <p class="page-intro">
        Ask them to open the sign-in page, choose “I would rather use my
        passphrase”, then “I have forgotten my passphrase”.
      </p>
      <p class="page-intro">
        If they only want to get in, a sign-in link is quicker — go back and
        make them one instead.
      </p>
      <p class="page-intro">
        This is the only time this code is shown. If it gets lost, just make
        another one.
      </p>
      <a class="btn btn-block" href="/admin/members">Back to members</a>
    </Layout>,
  );
});
