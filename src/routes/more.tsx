import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import {
  TalkIcon, VaultIcon, GroupsIcon, LockIcon, GlobeIcon, PersonIcon,
} from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { hashPassphrase } from '../lib/auth';
import { postsByAuthorFor } from '../lib/visibility';
import { storeUpload, deleteMedia, UploadError, mediaEnabled } from '../lib/media';

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
      <a class="card" href="/souvenir">
        <h2>The reunion souvenir</h2>
        <p class="card-meta">Read the book, and make your own page</p>
      </a>
      <a class="card" href="/stories">
        <h2>Our public pages</h2>
        <p class="card-meta">What the wider world can see</p>
      </a>
      {/* Anybody who tapped past this on their first day can find it here. */}
      <a class="card" href="/hello">
        <h2>How this site works</h2>
        <p class="card-meta">The three places, and who can see what</p>
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

/* -- What this place is ---------------------------------------------------- */
/*
 * Two screens, shown once on the way in and reachable forever afterwards from
 * More. Members arriving here have been sent a link over WhatsApp by a
 * classmate and have no idea what a "vault" is meant to be; without this they
 * land on an empty feed and a bottom bar of five words.
 *
 * It is deliberately not a dismissible tour with a "don't show me again" box.
 * Somebody who taps past it on the bus needs to be able to find it again, and
 * a checkbox in the database is one more thing to be wrong.
 */
moreRoutes.get('/hello', requireAuth, (c) => {
  const viewer = viewerOf(c);
  return c.html(
    <Layout title="How this works" viewer={viewer}>
      <h1>Welcome in, {viewer.preferred_name ?? viewer.full_name}</h1>
      <p class="page-intro">
        There are three places here worth knowing about. That is the whole of
        it — the rest you will find on your own.
      </p>

      <div class="card card-choice">
        <TalkIcon />
        <span>
          <h2>Talk</h2>
          <span class="card-meta">
            Like the WhatsApp group, except nothing scrolls away. Four rooms —
            general talk, projects, odds and ends, and photographs. Everyone
            who has joined can read them.
          </span>
        </span>
      </div>

      <div class="card card-choice">
        <VaultIcon />
        <span>
          <h2>My Vault</h2>
          <span class="card-meta">
            Your own shelf. Photographs, stories, a recording of your voice if
            you like. <strong>Nobody sees anything in it until you say so</strong>
            {' '}— not other members, not the committee, nobody.
          </span>
        </span>
      </div>

      <div class="card card-choice">
        <GroupsIcon />
        <span>
          <h2>Groups</h2>
          <span class="card-meta">
            Smaller corners — the people you shared a hostel with, the ones
            still in Batticaloa, whoever is running the scholarship fund. Join
            one, or start your own.
          </span>
        </span>
      </div>

      <a class="btn btn-block" href="/hello/2" style="margin-top:var(--space-md)">
        Next
      </a>
      <p style="margin-top:1rem">
        <a class="back" href="/">Skip this — take me in</a>
      </p>
    </Layout>,
  );
});

moreRoutes.get('/hello/2', requireAuth, (c) => {
  const viewer = viewerOf(c);
  return c.html(
    <Layout title="How this works" viewer={viewer}
            back={{ href: '/hello', label: 'Back' }}>
      <h1>Who sees what</h1>
      <p class="page-intro">
        This is the part we would most like you to trust, so here it is plainly.
      </p>

      <div class="card card-choice">
        <LockIcon />
        <span>
          <h2>Nothing is shared by accident</h2>
          <span class="card-meta">
            Everything you add starts private. Each time, you choose: keep it
            to yourself, send it to friends by name, put it in one of your
            groups, or offer it to the public pages.
          </span>
        </span>
      </div>

      <div class="card card-choice">
        <GlobeIcon />
        <span>
          <h2>The public pages are read first</h2>
          <span class="card-meta">
            Only what you offer to them, and only after one of the committee
            has read it. Nothing else on this site can be seen from outside.
          </span>
        </span>
      </div>

      <div class="card card-choice">
        <PersonIcon />
        <span>
          <h2>You can change your mind</h2>
          <span class="card-meta">
            Shared something with the wrong person, or thought better of it?
            Open it and tap <strong>Stop sharing</strong>. It goes back to
            being yours alone.
          </span>
        </span>
      </div>

      <p class="page-intro" style="margin-top:var(--space-lg)">
        One last thing, and then you are done: a photograph and a line about
        where you ended up. Forty-five years is a long time, and it helps
        people place you.
      </p>
      <a class="btn btn-block" href="/profile?welcome=1">Add my details</a>
      <p style="margin-top:1rem">
        <a class="back" href="/">Not now — take me in</a>
      </p>
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

  // Only what this member has actually shared with the viewer. The rule lives
  // in visibility.ts and nowhere else — see postsByAuthorFor.
  const { results: posts } = await postsByAuthorFor(c.env.DB, viewer.id, id);

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
          {/* These two are the whole point of the card, so they get a real
              target rather than the 18px an inline link happens to occupy. */}
          {showEmail && (
            <p class="contact-line">
              <a href={`mailto:${member.email}`}>{member.email}</a>
            </p>
          )}
          {showPhone && member.phone && (
            <p class="contact-line">
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

      {/* Reading your own name back at you — "Kamala has not shared anything
          with you yet" — is the sort of thing that makes a site feel like it
          is not paying attention. */}
      <h2 class="section-title">{isSelf ? 'Your memories' : 'Shared with you'}</h2>
      {posts.length === 0 ? (
        isSelf ? (
          <div class="empty">
            <h3>Nothing in your vault yet</h3>
            <p>This is what the batch will see when they open your name.</p>
            <a class="btn" href="/vault/new">Add your first memory</a>
          </div>
        ) : (
          <p class="page-intro">{name} has not shared anything with you yet.</p>
        )
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
  photos?: boolean;
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
          <input id="full_name" name="full_name" type="text" autocomplete="name"
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
          <input id="location" name="location" type="text" autocomplete="address-level2"
                 value={me.location ?? ''} />
        </div>

        <div class="field">
          <label for="bio">A few words about yourself</label>
          <span class="hint">
            Optional. What you did, where life took you, who is at home with you now.
          </span>
          <textarea id="bio" name="bio" rows={6}>{me.bio ?? ''}</textarea>
        </div>

        {props.photos !== false && (
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
        )}

        <h2 class="section-title">How the batch can reach you</h2>
        <p class="page-intro">
          Nothing here is shown to anyone until you switch it on.
        </p>

        <div class="field">
          <label for="email">Your email</label>
          <span class="hint">You sign in with this.</span>
          <input id="email" name="email" type="email" autocomplete="email"
                 inputmode="email" autocapitalize="off" spellcheck={false}
                 value={me.email} required />
        </div>
        <label class="check">
          <input type="checkbox" name="show_email" value="1"
                 checked={me.show_email === 1} />
          <span>Show my email to other members</span>
        </label>

        <div class="field" style="margin-top:var(--space-md)">
          <label for="phone">Your WhatsApp number</label>
          <input id="phone" name="phone" type="tel" autocomplete="tel"
                 value={me.phone ?? ''} />
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
    <ProfilePage viewer={viewer} me={me} photos={mediaEnabled(c.env)}
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
    c.html(<ProfilePage viewer={viewer} me={me} error={error}
                        photos={mediaEnabled(c.env)} />, 400);

  if (!fullName) return fail('Please give us your full name.');
  if (!email) return fail('Please give us an email address — it is how you sign in.');

  // Addresses are unique in the database, so without this check a member who
  // types a spouse's or a friend's address by mistake gets "something went
  // wrong at our end" — which is both untrue and no help at all.
  if (email !== me.email) {
    const taken = await c.env.DB
      .prepare('SELECT 1 FROM members WHERE email = ?1 AND id != ?2')
      .bind(email, viewer.id)
      .first();
    if (taken) {
      return fail(
        'Somebody in the batch already uses that address. If it is yours as '
        + 'well, ask on WhatsApp and one of the committee will sort it out.',
      );
    }
  }

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
      <ProfilePage viewer={viewer} me={me} photos={mediaEnabled(c.env)}
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
