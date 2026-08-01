import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { requireAuth, viewerOf } from '../lib/guard';
import { hashPassphrase } from '../lib/auth';
import { storeUpload, deleteMedia, UploadError } from '../lib/media';

export const moreRoutes = new Hono<AppBindings>();

const MIN_PASSPHRASE = 8;

/** The batch finished around 1980; the range is wide enough to be forgiving. */
const EARLIEST_YEAR = 1960;
const LATEST_YEAR = 2030;

interface ProfileRow {
  id: string;
  full_name: string;
  preferred_name: string | null;
  email: string;
  phone: string | null;
  batch_year: number | null;
  location: string | null;
  bio: string | null;
  photo_media_id: string | null;
  show_email: number;
  show_phone: number;
  has_passphrase: number;
}

const PROFILE_COLUMNS = `
  id, full_name, preferred_name, email, phone, batch_year, location, bio,
  photo_media_id, show_email, show_phone,
  (passphrase_hash IS NOT NULL) AS has_passphrase
`;

/** "Kandy · finished 1980" — whichever parts the member has filled in. */
function subtitle(m: { batch_year: number | null; location: string | null }): string {
  const bits: string[] = [];
  if (m.location) bits.push(m.location);
  if (m.batch_year) bits.push(`finished ${m.batch_year}`);
  return bits.join(' · ');
}

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
        <p class="card-meta">Your photo, where you are, and how to reach you</p>
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
      `SELECT id, COALESCE(preferred_name, full_name) AS name,
              batch_year, location, photo_media_id
         FROM members WHERE status = 'active' ORDER BY name`,
    )
    .all<{
      id: string; name: string; batch_year: number | null;
      location: string | null; photo_media_id: string | null;
    }>();

  return c.html(
    <Layout title="The batch" viewer={viewer} tab="more" back={{ href: '/more', label: 'More' }}>
      <h1>The batch</h1>
      <p class="page-intro">{results.length} of us have joined so far.</p>
      <ul class="member-list">
        {results.map((m) => (
          <li>
            <a href={`/members/${m.id}`}>
              {m.photo_media_id ? (
                <img class="avatar" src={`/media/${m.photo_media_id}`} alt=""
                     width="56" height="56" loading="lazy" />
              ) : (
                <span class="avatar avatar-blank" aria-hidden="true">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span class="member-name">
                {m.name}
                {subtitle(m) && <span class="card-meta">{subtitle(m)}</span>}
              </span>
            </a>
          </li>
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
      `SELECT id, full_name, preferred_name, email, phone, batch_year, location,
              bio, photo_media_id, show_email, show_phone
         FROM members WHERE id = ?1 AND status = 'active'`,
    )
    .bind(id)
    .first<Omit<ProfileRow, 'has_passphrase'>>();
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
  // A member's own details are always their own to see, whatever the switches say.
  const isSelf = member.id === viewer.id;
  const showEmail = isSelf || member.show_email === 1;
  const showPhone = isSelf || member.show_phone === 1;

  return c.html(
    <Layout title={name} viewer={viewer} tab="more" back={{ href: '/members', label: 'The batch' }}>
      <div class="member-head">
        {member.photo_media_id && (
          <img class="avatar avatar-large" src={`/media/${member.photo_media_id}`}
               alt={`${name} today`} width="120" height="120" />
        )}
        <div>
          <h1>{name}</h1>
          {member.preferred_name && member.preferred_name !== member.full_name && (
            <p class="card-meta">{member.full_name}</p>
          )}
          {subtitle(member) && <p class="card-meta">{subtitle(member)}</p>}
        </div>
      </div>

      {member.bio && member.bio.split(/\n{2,}/).map((p) => <p>{p}</p>)}

      {(showEmail || showPhone) && (
        <div class="card">
          <h2>Getting in touch</h2>
          {showEmail && (
            <p style="margin:0.35rem 0">
              <a href={`mailto:${member.email}`}>{member.email}</a>
            </p>
          )}
          {showPhone && member.phone && (
            <p style="margin:0.35rem 0">
              <a href={`tel:${member.phone.replace(/[^+\d]/g, '')}`}>{member.phone}</a>
            </p>
          )}
          {isSelf && (
            <p class="card-meta">
              Only you can see anything you have chosen to keep private.
            </p>
          )}
        </div>
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
function ProfilePage(props: {
  viewer: ReturnType<typeof viewerOf>;
  me: ProfileRow;
  welcome?: boolean;
  error?: string;
  saved?: boolean;
}) {
  const { me } = props;
  return (
    <Layout title="My details" viewer={props.viewer} tab="more"
            back={{ href: '/more', label: 'More' }}>
      {props.welcome ? (
        <>
          <h1>You are in, {me.preferred_name ?? me.full_name}</h1>
          <p class="page-intro">
            Before you go any further — a photograph and a line about where you
            are will help the batch place you after all these years. You can
            skip this and come back whenever you like.
          </p>
        </>
      ) : (
        <h1>My details</h1>
      )}

      {props.error && (
        <ErrorNotice title="That did not save.">
          <p>{props.error}</p>
        </ErrorNotice>
      )}
      {props.saved && (
        <div class="notice" role="status">
          <strong>Saved.</strong>
          <p>Your details are up to date.</p>
        </div>
      )}

      <form method="post" action="/profile" enctype="multipart/form-data">
        <div class="field">
          <label for="full_name">Your full name</label>
          <input id="full_name" name="full_name" type="text"
                 value={me.full_name} required />
        </div>

        <div class="field">
          <label for="preferred_name">What friends call you</label>
          <span class="hint">This is the name others will see.</span>
          <input id="preferred_name" name="preferred_name" type="text"
                 value={me.preferred_name ?? ''} />
        </div>

        <div class="field">
          <label for="batch_year">The year you finished at BUC</label>
          <span class="hint">Four digits, for example 1980.</span>
          <input id="batch_year" name="batch_year" type="number" inputmode="numeric"
                 min={EARLIEST_YEAR} max={LATEST_YEAR}
                 value={me.batch_year ? String(me.batch_year) : ''} />
        </div>

        <div class="field">
          <label for="location">Where you are now</label>
          <span class="hint">Town and country, for example Scarborough, Canada.</span>
          <input id="location" name="location" type="text"
                 value={me.location ?? ''} />
        </div>

        <div class="field">
          <label for="bio">A few words about yourself</label>
          <span class="hint">
            Optional. What you did, where life took you, who is at home with you now.
          </span>
          <textarea id="bio" name="bio" rows={6}>{me.bio ?? ''}</textarea>
        </div>

        <div class="field">
          <label for="photo">Your photograph</label>
          <span class="hint">
            Optional. A recent one, so people recognise you at the reunion.
          </span>
          {me.photo_media_id && (
            <p>
              <img class="avatar avatar-large" src={`/media/${me.photo_media_id}`}
                   alt="Your current photograph" width="120" height="120" />
            </p>
          )}
          <input id="photo" name="photo" type="file" accept="image/*" />
          {me.photo_media_id && (
            <label class="check" style="margin-top:0.75rem">
              <input type="checkbox" name="remove_photo" value="1" />
              <span>Remove the photograph I have now</span>
            </label>
          )}
        </div>

        <h2 class="section-title">How the batch can reach you</h2>
        <p class="page-intro">
          Nothing here is shown to anyone until you switch it on.
        </p>

        <div class="field">
          <label for="email">Your email</label>
          <span class="hint">You sign in with this.</span>
          <input id="email" name="email" type="email" value={me.email} required />
        </div>
        <label class="check">
          <input type="checkbox" name="show_email" value="1"
                 checked={me.show_email === 1} />
          <span>Show my email to other members</span>
        </label>

        <div class="field" style="margin-top:var(--space-md)">
          <label for="phone">Your WhatsApp number</label>
          <input id="phone" name="phone" type="tel" value={me.phone ?? ''} />
        </div>
        <label class="check">
          <input type="checkbox" name="show_phone" value="1"
                 checked={me.show_phone === 1} />
          <span>Show my number to other members</span>
        </label>

        <button class="btn btn-block" type="submit" style="margin-top:var(--space-lg)">
          Save my details
        </button>
      </form>

      <h2 class="section-title">A passphrase, if you want one</h2>
      <p class="page-intro">
        You do not need one. Signing in by emailed link works forever. Set a
        passphrase only if your email is unreliable and you would rather type
        something you remember.
      </p>
      <form method="post" action="/profile/passphrase">
        <div class="field">
          <label for="passphrase">
            {me.has_passphrase ? 'Choose a new passphrase' : 'Choose a passphrase'}
          </label>
          <span class="hint">
            At least {MIN_PASSPHRASE} characters. A short phrase you will not
            forget — for example: green mango tree
          </span>
          <input id="passphrase" name="passphrase" type="password"
                 autocomplete="new-password" minlength={MIN_PASSPHRASE} required />
        </div>
        <button class="btn btn-secondary btn-block" type="submit">
          {me.has_passphrase ? 'Change my passphrase' : 'Set my passphrase'}
        </button>
      </form>
    </Layout>
  );
}

async function loadProfile(db: D1Database, id: string) {
  return db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM members WHERE id = ?1`)
    .bind(id)
    .first<ProfileRow>();
}

moreRoutes.get('/profile', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const me = await loadProfile(c.env.DB, viewer.id);
  if (!me) return c.notFound();

  return c.html(
    <ProfilePage viewer={viewer} me={me}
                 welcome={c.req.query('welcome') === '1'}
                 saved={c.req.query('saved') === '1'} />,
  );
});

moreRoutes.post('/profile', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();

  const me = await loadProfile(c.env.DB, viewer.id);
  if (!me) return c.notFound();

  const fullName = String(form.get('full_name') ?? '').trim();
  const preferred = String(form.get('preferred_name') ?? '').trim() || null;
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const phone = String(form.get('phone') ?? '').trim() || null;
  const location = String(form.get('location') ?? '').trim() || null;
  const bio = String(form.get('bio') ?? '').trim() || null;
  const showEmail = form.get('show_email') === '1' ? 1 : 0;
  const showPhone = form.get('show_phone') === '1' ? 1 : 0;

  const fail = (error: string) =>
    c.html(<ProfilePage viewer={viewer} me={me} error={error} />, 400);

  if (!fullName) return fail('Please give us your full name.');
  if (!email) return fail('Please give us an email address — it is how you sign in.');

  const yearRaw = String(form.get('batch_year') ?? '').trim();
  let batchYear: number | null = null;
  if (yearRaw) {
    const n = Number(yearRaw);
    if (!Number.isInteger(n) || n < EARLIEST_YEAR || n > LATEST_YEAR) {
      return fail(`The year should be four digits between ${EARLIEST_YEAR} and ${LATEST_YEAR}.`);
    }
    batchYear = n;
  }

  // Photo first: if it fails, nothing else has been written yet.
  let photoId = me.photo_media_id;
  const upload = form.get('photo');
  const removing = form.get('remove_photo') === '1';

  if (upload instanceof File && upload.size > 0) {
    try {
      const stored = await storeUpload(
        c.env, upload, viewer.id, null, `${preferred ?? fullName}, today`,
      );
      if (stored.kind !== 'photo') {
        return fail('That file is not a photograph. A JPEG or PNG works best.');
      }
      photoId = stored.id;
    } catch (err) {
      return fail(err instanceof UploadError ? err.message
        : 'We could not save that photograph. Please try a different one.');
    }
  } else if (removing) {
    photoId = null;
  }

  await c.env.DB
    .prepare(
      `UPDATE members
          SET full_name = ?1, preferred_name = ?2, email = ?3, phone = ?4,
              batch_year = ?5, location = ?6, bio = ?7, photo_media_id = ?8,
              show_email = ?9, show_phone = ?10, updated_at = unixepoch()
        WHERE id = ?11`,
    )
    .bind(fullName, preferred, email, phone, batchYear, location, bio,
          photoId, showEmail, showPhone, viewer.id)
    .run();

  // Only once the row no longer points at it, so a failed save never leaves a
  // member looking at a broken image.
  if (me.photo_media_id && me.photo_media_id !== photoId) {
    await deleteMedia(c.env, me.photo_media_id, viewer.id);
  }

  return c.redirect('/profile?saved=1', 303);
});

moreRoutes.post('/profile/passphrase', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const passphrase = String((await c.req.formData()).get('passphrase') ?? '');

  const me = await loadProfile(c.env.DB, viewer.id);
  if (!me) return c.notFound();

  if (passphrase.length < MIN_PASSPHRASE) {
    return c.html(
      <ProfilePage viewer={viewer} me={me}
                   error={`A passphrase needs at least ${MIN_PASSPHRASE} characters.`} />,
      400,
    );
  }

  await c.env.DB
    .prepare(
      `UPDATE members SET passphrase_hash = ?1, updated_at = unixepoch()
        WHERE id = ?2`,
    )
    .bind(await hashPassphrase(passphrase), viewer.id)
    .run();

  return c.redirect('/profile?saved=1', 303);
});
