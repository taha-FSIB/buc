/**
 * The privacy model, checked over HTTP.
 *
 * The rule in src/lib/visibility.ts is the single most security-critical thing
 * in this project: a post must never reach somebody it was not shared with.
 * Reading the SQL and nodding is not a test. This drives the real running app
 * — real sessions, real uploads to R2, real routes — and asserts a full
 * visibility matrix, including the cases that are easy to get wrong:
 *
 *   * a draft that HAS been shared is still invisible;
 *   * a public submission that is only PENDING is invisible to everyone but
 *     its author, admins included;
 *   * media inherits its post's visibility, so a forwarded /media/ link
 *     grants nothing;
 *   * an admin has no blanket read access to private vaults.
 *
 * Usage:  node scripts/check-visibility.mjs [baseUrl]
 * Needs a dev server running against the local D1 (npm run dev).
 *
 * Fixtures all carry a `vtest_` prefix and are removed at the end, including
 * the R2 objects, which are deleted through the app's own delete route.
 */

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Run wrangler's entry point directly rather than through `npx`: on Windows,
// spawning a .cmd shim without a shell fails with EINVAL on current Node.
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/* -- Running SQL against the local database -------------------------------- */
function sql(statements) {
  const file = join(tmpdir(), `vtest-${randomBytes(6).toString('hex')}.sql`);
  writeFileSync(file, statements.join('\n'), 'utf8');
  try {
    execFileSync(
      process.execPath,
      [WRANGLER, 'd1', 'execute', 'buc_alumni', '--local', '--file', file],
      { stdio: 'pipe', cwd: ROOT },
    );
  } finally {
    unlinkSync(file);
  }
}

/* -- Fixtures -------------------------------------------------------------- */
const PEOPLE = {
  author:   { id: 'vtest_author',   name: 'Test Author',   role: 'member' },
  friend:   { id: 'vtest_friend',   name: 'Test Friend',   role: 'member' },
  grpmate:  { id: 'vtest_grpmate',  name: 'Test Groupmate', role: 'member' },
  stranger: { id: 'vtest_stranger', name: 'Test Stranger', role: 'member' },
  admin:    { id: 'vtest_admin',    name: 'Test Admin',    role: 'admin'  },
};

const tokens = Object.fromEntries(
  Object.keys(PEOPLE).map((k) => [k, randomBytes(32).toString('hex')]),
);

function seed() {
  const rows = Object.values(PEOPLE).map(
    (p) => `INSERT INTO members (id, full_name, email, role, status)
            VALUES ('${p.id}', '${p.name}', '${p.id}@visibility.test', '${p.role}', 'active');`,
  );

  const links = Object.entries(PEOPLE).map(
    ([key, p]) => `INSERT INTO login_links (id, member_id, token_hash, purpose, expires_at)
                   VALUES ('vtest_link_${key}', '${p.id}', '${sha256(tokens[key])}',
                           'signin', unixepoch() + 3600);`,
  );

  sql([
    'PRAGMA foreign_keys = ON;',
    ...rows,
    `INSERT INTO groups (id, name, kind, join_policy, created_by)
       VALUES ('vtest_group', 'Test Group', 'interest', 'invite', '${PEOPLE.author.id}');`,
    `INSERT INTO group_members (group_id, member_id, role, state)
       VALUES ('vtest_group', '${PEOPLE.author.id}', 'owner', 'active');`,
    `INSERT INTO group_members (group_id, member_id, role, state)
       VALUES ('vtest_group', '${PEOPLE.grpmate.id}', 'member', 'active');`,
    ...links,
  ]);
}

function cleanup() {
  sql([
    'PRAGMA foreign_keys = ON;',
    "DELETE FROM posts WHERE author_id LIKE 'vtest_%';",
    "DELETE FROM flipbook_pages WHERE member_id LIKE 'vtest_%';",
    `DELETE FROM group_members WHERE group_id IN
       (SELECT id FROM groups WHERE id = 'vtest_group' OR name LIKE 'vtest%');`,
    "DELETE FROM groups WHERE id = 'vtest_group' OR name LIKE 'vtest%';",
    "DELETE FROM media WHERE owner_id LIKE 'vtest_%';",
    "DELETE FROM guest_rsvps WHERE full_name LIKE 'vtest%';",
    "DELETE FROM login_links WHERE member_id LIKE 'vtest_%';",
    "DELETE FROM sessions WHERE member_id LIKE 'vtest_%';",
    // An invited guest becomes a member with a generated id, so these three go
    // by address instead. Every fixture account lives at visibility.test.
    `DELETE FROM login_links WHERE member_id IN
       (SELECT id FROM members WHERE email LIKE '%@visibility.test');`,
    `DELETE FROM sessions WHERE member_id IN
       (SELECT id FROM members WHERE email LIKE '%@visibility.test');`,
    "DELETE FROM members WHERE id LIKE 'vtest_%' OR email LIKE '%@visibility.test';",
  ]);
}

/* -- Talking to the app ---------------------------------------------------- */
function cookiesFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function signIn(key) {
  const res = await fetch(`${BASE}/signin/link/${tokens[key]}`, {
    method: 'POST', redirect: 'manual',
  });
  if (res.status !== 303) throw new Error(`sign-in for ${key} returned ${res.status}`);
  const cookie = cookiesFrom(res);
  if (!cookie.includes('buc_session=')) throw new Error(`no session cookie for ${key}`);
  return cookie;
}

/** A 1x1 PNG, so uploads are real objects in R2 rather than mocked rows. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createPost(cookie, { kind, title, visibility, groupId, withPhoto }) {
  const body = new FormData();
  body.set('title', title);
  body.set('body', 'Fixture created by check-visibility.mjs');
  body.set('language', 'en');
  body.set('visibility', visibility);
  if (groupId) body.set('group_id', groupId);
  if (withPhoto) body.set('file', new Blob([PIXEL], { type: 'image/png' }), 'pixel.png');

  const res = await fetch(`${BASE}/vault/new/${kind}`, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  if (res.status !== 303) {
    throw new Error(`creating "${title}" returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const id = new URL(res.headers.get('location'), BASE).pathname.split('/')[2];
  if (!id) throw new Error(`could not read a post id back for "${title}"`);
  return id;
}

async function createGroup(cookie, { name, listed, joinPolicy = 'invite' }) {
  const body = new FormData();
  body.set('name', name);
  body.set('description', 'Fixture created by check-visibility.mjs');
  body.set('kind', 'other');
  body.set('join_policy', joinPolicy);
  if (listed) body.set('listed', '1');
  body.set('cover', new Blob([PIXEL], { type: 'image/png' }), 'cover.png');

  const res = await fetch(`${BASE}/groups/new`, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  if (res.status !== 303) {
    throw new Error(`creating group "${name}" returned ${res.status}`);
  }
  return new URL(res.headers.get('location'), BASE).pathname.split('/')[2];
}

async function coverIdOf(cookie, groupId) {
  const html = await (await fetch(`${BASE}/groups/${groupId}`, { headers: { cookie } })).text();
  const m = html.match(/\/media\/([a-z0-9]+)/);
  if (!m) throw new Error(`no cover found on group ${groupId}`);
  return m[1];
}

async function post(path, cookie, fields = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { cookie },
    body: new URLSearchParams(fields), redirect: 'manual',
  });
  return res.status;
}

/**
 * Submit a souvenir page with a photograph and approve it, returning the
 * media id. Uses the admin's own approval route rather than writing SQL, so
 * the whole submit-and-approve path is exercised.
 */
async function createSouvenirPage(cookie) {
  const body = new FormData();
  body.set('heading', 'vtest souvenir');
  body.set('blurb', 'Fixture created by check-visibility.mjs');
  body.set('then', new Blob([PIXEL], { type: 'image/png' }), 'then.png');
  const made = await fetch(`${BASE}/souvenir/mine`, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  if (made.status !== 303) throw new Error(`souvenir submit returned ${made.status}`);

  const mine = await (await fetch(`${BASE}/souvenir/mine`, { headers: { cookie } })).text();
  const m = mine.match(/\/media\/([a-z0-9]+)/);
  if (!m) throw new Error('no souvenir photo found');

  // Approve it as the admin so it reaches the "approved page" branch.
  const queue = await (await fetch(`${BASE}/admin/souvenir`, { headers: { cookie: cookiesRef.admin } })).text();
  for (const id of new Set([...queue.matchAll(/action="\/admin\/souvenir\/([a-z0-9]+)"/g)].map((x) => x[1]))) {
    await fetch(`${BASE}/admin/souvenir/${id}`, {
      method: 'POST', headers: { cookie: cookiesRef.admin },
      body: new URLSearchParams({ decision: 'approved' }), redirect: 'manual',
    });
  }
  return m[1];
}

/** Filled in once sessions exist, so the helper above can reach the admin. */
const cookiesRef = {};

async function share(cookie, postId, kind, audienceId) {
  const body = new URLSearchParams({ kind });
  if (audienceId) body.set('audience_id', audienceId);
  const res = await fetch(`${BASE}/post/${postId}/share`, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  if (res.status !== 303) throw new Error(`sharing ${postId} returned ${res.status}`);
}

async function mediaIdOf(cookie, postId) {
  const html = await (await fetch(`${BASE}/post/${postId}`, { headers: { cookie } })).text();
  const m = html.match(/\/media\/([a-z0-9]+)/);
  if (!m) throw new Error(`no media found on ${postId}`);
  return m[1];
}

async function status(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {}, redirect: 'manual',
  });
  return res.status;
}

/* -- The matrix ------------------------------------------------------------ */
let failures = 0;
let checks = 0;

function assertReach(label, actual, shouldSee) {
  checks++;
  // Anything under 400 means the bytes were served (206 shows up on ranged
  // media). Denial is always 404, never 403 — the app must not confirm that a
  // private item exists.
  const seen = actual < 400;
  const ok = seen === shouldSee;
  if (!ok) {
    failures++;
    console.error(
      `  FAIL  ${label}: expected ${shouldSee ? 'to be readable' : 'to be hidden'}, got HTTP ${actual}`,
    );
  } else {
    console.log(`  ok    ${label} (${actual})`);
  }
}

async function main() {
  console.log(`Checking the privacy model against ${BASE}\n`);

  cleanup(); // in case an earlier run died half-way
  seed();

  const cookies = {};
  for (const key of Object.keys(PEOPLE)) cookies[key] = await signIn(key);
  Object.assign(cookiesRef, cookies);

  const posts = {
    private: await createPost(cookies.author, {
      kind: 'photo', title: 'vtest private', visibility: 'private', withPhoto: true,
    }),
    toFriend: await createPost(cookies.author, {
      kind: 'story', title: 'vtest shared with one friend', visibility: 'private',
    }),
    toGroup: await createPost(cookies.author, {
      kind: 'story', title: 'vtest shared with a group',
      visibility: 'group', groupId: 'vtest_group',
    }),
    pending: await createPost(cookies.author, {
      kind: 'story', title: 'vtest awaiting approval', visibility: 'public',
    }),
    pendingPhoto: await createPost(cookies.author, {
      kind: 'photo', title: 'vtest photo awaiting approval', visibility: 'public',
      withPhoto: true,
    }),
    approved: await createPost(cookies.author, {
      kind: 'photo', title: 'vtest approved for the public', visibility: 'public',
      withPhoto: true,
    }),
    draftShared: await createPost(cookies.author, {
      kind: 'story', title: 'vtest draft but shared', visibility: 'private',
    }),
  };

  await share(cookies.author, posts.toFriend, 'member', PEOPLE.friend.id);
  await share(cookies.author, posts.draftShared, 'member', PEOPLE.friend.id);

  // Approved through the real moderation route, by a real admin.
  const approve = await fetch(`${BASE}/admin/queue/${posts.approved}`, {
    method: 'POST', headers: { cookie: cookies.admin },
    body: new URLSearchParams({ decision: 'approved' }), redirect: 'manual',
  });
  if (approve.status !== 303) throw new Error(`approval returned ${approve.status}`);

  // Only reachable by writing directly: the compose form deliberately has no
  // way to make a draft. The point is that state and reach are separate checks.
  sql([`UPDATE posts SET state = 'draft' WHERE id = '${posts.draftShared}';`]);

  const privateMedia = await mediaIdOf(cookies.author, posts.private);
  const publicMedia = await mediaIdOf(cookies.author, posts.approved);
  const pendingMedia = await mediaIdOf(cookies.author, posts.pendingPhoto);

  const VIEWERS = ['author', 'friend', 'grpmate', 'stranger', 'admin'];

  /** who may read what: [post, path, {viewer: expected}, anonymous] */
  const MATRIX = [
    ['a private post', `/post/${posts.private}`,
      { author: true, friend: false, grpmate: false, stranger: false, admin: false }, false],
    ['a post shared with one friend', `/post/${posts.toFriend}`,
      { author: true, friend: true, grpmate: false, stranger: false, admin: false }, false],
    ['a post shared with a group', `/post/${posts.toGroup}`,
      { author: true, friend: false, grpmate: true, stranger: false, admin: false }, false],
    // The one asymmetry in the model, and it is intentional: the member has
    // asked for this to be public, so a moderator may read it. Everybody else
    // — including other members — still sees nothing until it is approved.
    ['a public submission still pending', `/post/${posts.pending}`,
      { author: true, friend: false, grpmate: false, stranger: false, admin: true }, false],
    ['media on a pending public submission', `/media/${pendingMedia}`,
      { author: true, friend: false, grpmate: false, stranger: false, admin: true }, false],
    ['an approved public post', `/post/${posts.approved}`,
      { author: true, friend: true, grpmate: true, stranger: true, admin: true }, true],
    ['a draft that has been shared', `/post/${posts.draftShared}`,
      { author: true, friend: false, grpmate: false, stranger: false, admin: false }, false],
    ['media on a private post', `/media/${privateMedia}`,
      { author: true, friend: false, grpmate: false, stranger: false, admin: false }, false],
    ['media on an approved public post', `/media/${publicMedia}`,
      { author: true, friend: true, grpmate: true, stranger: true, admin: true }, true],
  ];

  for (const [label, path, expected, anonymous] of MATRIX) {
    console.log(`\n${label}`);
    for (const v of VIEWERS) {
      assertReach(`${v.padEnd(9)}`, await status(path, cookies[v]), expected[v]);
    }
    assertReach('anonymous', await status(path, null), anonymous);
  }

  // Every public page must be reachable with no session at all.
  console.log('\nthe public site, with no session');
  for (const path of ['/', '/our-story', '/stories', '/reunion', '/contact']) {
    checks++;
    const code = await status(path, null);
    if (code === 200) console.log(`  ok    ${path} (200)`);
    else { failures++; console.error(`  FAIL  ${path} returned ${code} to a visitor`); }
  }

  // Each public listing is its own read path and must agree with the matrix.
  // Checked on the home page as well as the index, because the home page runs
  // a second query and a mistake there would publish just as effectively.
  for (const [label, path] of [['/stories', '/stories'], ['the home page', '/']]) {
    console.log(`\nwhat ${label} lists`);
    const feed = await (await fetch(`${BASE}${path}`)).text();
    for (const [key, shouldAppear] of [
      ['approved', true], ['pending', false], ['pendingPhoto', false], ['private', false],
    ]) {
      checks++;
      const appears = feed.includes(posts[key]);
      if (appears !== shouldAppear) {
        failures++;
        console.error(`  FAIL  ${key} post ${shouldAppear ? 'missing from' : 'leaked into'} ${path}`);
      } else {
        console.log(`  ok    ${key} post ${shouldAppear ? 'listed' : 'absent'}`);
      }
    }
  }

  // The public single-story route is a separate query from the listing, so it
  // gets its own assertions rather than being assumed to agree.
  console.log('\nthe public story page');
  assertReach('an approved story', await status(`/stories/${posts.approved}`, null), true);
  assertReach('one still pending', await status(`/stories/${posts.pending}`, null), false);
  assertReach('a private one', await status(`/stories/${posts.private}`, null), false);
  assertReach('a private one, even to its author',
    await status(`/stories/${posts.private}`, cookies.author), false);

  // A rejection leaves the author's 'public' share row in place — they asked,
  // and may ask again. Only the admin's decision was withdrawn, so the post
  // must fall back to being private, and the moderator's own access must go
  // with it.
  console.log('\na submission that was rejected');
  const rejected = await createPost(cookies.author, {
    kind: 'story', title: 'vtest rejected', visibility: 'public',
  });
  await post(`/admin/queue/${rejected}`, cookies.admin,
    { decision: 'rejected', note: 'Not this one.' });
  assertReach('anonymous', await status(`/stories/${rejected}`, null), false);
  assertReach('another member', await status(`/post/${rejected}`, cookies.friend), false);
  assertReach('the admin who rejected it', await status(`/post/${rejected}`, cookies.admin), false);
  assertReach('its author', await status(`/post/${rejected}`, cookies.author), true);
  posts.rejected = rejected;

  /* -- The hub's audience: every member, and no further -------------------- */
  console.log('\na hub thread (shared with the whole batch)');
  const thread = new FormData();
  thread.set('title', 'vtest hub thread');
  thread.set('body', 'Fixture created by check-visibility.mjs');
  const made = await fetch(`${BASE}/talk/general/new`, {
    method: 'POST', headers: { cookie: cookies.author }, body: thread, redirect: 'manual',
  });
  if (made.status !== 303) throw new Error(`starting a thread returned ${made.status}`);
  const threadId = new URL(made.headers.get('location'), BASE).pathname.split('/')[3];

  for (const v of VIEWERS) {
    assertReach(`${v.padEnd(9)}`, await status(`/talk/thread/${threadId}`, cookies[v]), true);
  }
  checks++;
  const anonThread = await status(`/talk/thread/${threadId}`, null);
  if (anonThread === 303) console.log('  ok    anonymous is sent to sign in (303)');
  else { failures++; console.error(`  FAIL  a hub thread returned ${anonThread} to a visitor`); }

  // 'batch' is not a back door to 'public'. It must not reach the public site.
  assertReach('not on the public site', await status(`/stories/${threadId}`, null), false);
  checks++;
  const stories = await (await fetch(`${BASE}/stories`)).text();
  if (stories.includes(threadId)) {
    failures++; console.error('  FAIL  a hub thread leaked into /stories');
  } else console.log('  ok    absent from the public listing');

  // A reply is readable exactly when its thread is — so posting one must be
  // gated on the thread, not on the reply.
  checks++;
  const replied = await post(`/talk/thread/${threadId}/reply`, cookies.stranger, { body: 'vtest reply' });
  if (replied === 303) console.log('  ok    any member may reply (303)');
  else { failures++; console.error(`  FAIL  a member replying got ${replied}`); }

  checks++;
  const anonReply = await fetch(`${BASE}/talk/thread/${threadId}/reply`, {
    method: 'POST', body: new URLSearchParams({ body: 'vtest anonymous' }), redirect: 'manual',
  });
  if (anonReply.status === 303 && (anonReply.headers.get('location') ?? '').includes('/welcome')) {
    console.log('  ok    a visitor cannot reply (sent to sign in)');
  } else {
    failures++; console.error(`  FAIL  a visitor replying got ${anonReply.status}`);
  }

  posts.hubThread = threadId;

  /* -- The souvenir is for the batch, not the open web --------------------- */
  console.log('\nthe souvenir');
  assertReach('the flipbook, to a member', await status('/souvenir', cookies.stranger), true);
  checks++;
  const anonBook = await status('/souvenir', null);
  if (anonBook === 303) console.log('  ok    anonymous is sent to sign in (303)');
  else { failures++; console.error(`  FAIL  /souvenir returned ${anonBook} to a visitor`); }

  // A souvenir photograph is consented to a printed book, not to the internet.
  const souvenirPhoto = await createSouvenirPage(cookies.author);
  assertReach('a souvenir photo, to a member',
    await status(`/media/${souvenirPhoto}`, cookies.friend), true);
  assertReach('a souvenir photo, anonymous',
    await status(`/media/${souvenirPhoto}`, null), false);

  /* -- The reunion, and answers from people who have no account ------------ */
  // The public form is the one place on the site where an unauthenticated
  // stranger writes to the database. It has to be open — an invitee the
  // committee has only just tracked down must be able to say yes — so what
  // matters is that nothing written there is readable by anyone but an admin,
  // and that it cannot be used to flood the table.
  console.log('\nthe reunion, to a visitor');
  assertReach('the reunion page', await status('/reunion', null), true);
  assertReach('the answer form', await status('/reunion/rsvp', null), true);

  const guestAnswer = (fields) => fetch(`${BASE}/reunion/rsvp`, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ answer: 'yes', ...fields }),
  });

  checks++;
  const answered1 = await guestAnswer({
    full_name: 'vtest Outside Guest', email: 'vtest.guest@visibility.test',
    guests: '1', dietary: 'vtest no fish',
  });
  if (answered1.status === 200 && (await answered1.text()).includes('Thank you')) {
    console.log('  ok    a visitor may answer without an account');
  } else {
    failures++; console.error(`  FAIL  a visitor answering got ${answered1.status}`);
  }

  console.log('\nwho can read an outside answer');
  const headcount = await (await fetch(`${BASE}/admin/reunion`, { headers: { cookie: cookies.admin } })).text();
  checks++;
  if (headcount.includes('vtest Outside Guest')) console.log('  ok    the admin sees it on the headcount');
  else { failures++; console.error('  FAIL  the admin cannot see an answer that was sent in'); }

  // Names, addresses and telephone numbers typed by people who are not members
  // must not surface anywhere outside the admin area.
  for (const [label, path, cookie] of [
    ['the public reunion page', '/reunion', null],
    ['the answer form', '/reunion/rsvp', null],
    ['the home page', '/', null],
    ['the reunion page, to a member', '/reunion', cookies.stranger],
  ]) {
    checks++;
    const body = await (await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })).text();
    if (body.includes('vtest Outside Guest') || body.includes('vtest.guest@visibility.test')) {
      failures++; console.error(`  FAIL  an outside answer leaked onto ${label}`);
    } else console.log(`  ok    nothing of it on ${label}`);
  }

  for (const [label, path] of [
    ['the headcount', '/admin/reunion'],
    ['the details editor', '/admin/reunion/event'],
  ]) {
    checks++;
    const code = await status(path, cookies.stranger);
    if (code === 404) console.log(`  ok    ${label} is not there for an ordinary member (404)`);
    else { failures++; console.error(`  FAIL  ${label} returned ${code} to an ordinary member`); }
  }

  for (const [label, path] of [
    ['inviting somebody', '/admin/reunion/guest/whatever/invite'],
    ['marking one dealt with', '/admin/reunion/guest/whatever/handled'],
    ['changing the details', '/admin/reunion/event'],
    ['adding a line to the schedule', '/admin/reunion/schedule'],
  ]) {
    checks++;
    const code = await post(path, cookies.stranger);
    if (code === 404) console.log(`  ok    a member cannot do ${label} (404)`);
    else { failures++; console.error(`  FAIL  ${label} returned ${code} to an ordinary member`); }
  }

  // Inviting somebody out of that list is how an answer becomes an account, so
  // it is worth proving end to end rather than assuming the button is wired up.
  console.log('\nturning an outside answer into a member');
  const guestId = (headcount.match(/\/admin\/reunion\/guest\/([a-z0-9]+)\/invite/) ?? [])[1];
  checks++;
  if (!guestId) {
    failures++; console.error('  FAIL  no invite button on an answer that has an address');
  } else {
    console.log('  ok    the answer offers an invitation');
    const invited = await fetch(`${BASE}/admin/reunion/guest/${guestId}/invite`, {
      method: 'POST', headers: { cookie: cookies.admin }, redirect: 'manual',
    });
    const handout = invited.status === 200 ? await invited.text() : '';

    checks++;
    if (handout.includes('/signin/link/')) console.log('  ok    a sign-in link comes back for them');
    else { failures++; console.error(`  FAIL  inviting them returned ${invited.status} and no link`); }

    const after = await (await fetch(`${BASE}/admin/reunion`, { headers: { cookie: cookies.admin } })).text();
    checks++;
    if (after.includes('now a member')) console.log('  ok    the answer is marked dealt with');
    else { failures++; console.error('  FAIL  the answer was not closed after the invitation'); }
  }

  // The honeypot and the hourly cap both answer with the same thank-you page,
  // so the only honest way to check them is to look at what reached the table.
  console.log('\nwhat the open form refuses to store');
  await guestAnswer({ full_name: 'vtest Robot', website: 'http://spam.example' });
  for (let i = 0; i < 12; i++) await guestAnswer({ full_name: `vtest Flood ${i}` });
  await guestAnswer({ full_name: 'vtest Over The Limit' });

  const afterFlood = await (await fetch(`${BASE}/admin/reunion`, { headers: { cookie: cookies.admin } })).text();
  checks++;
  if (afterFlood.includes('vtest Robot')) {
    failures++; console.error('  FAIL  a filled-in honeypot was stored anyway');
  } else console.log('  ok    a filled-in honeypot stores nothing');

  checks++;
  if (afterFlood.includes('vtest Over The Limit')) {
    failures++; console.error('  FAIL  the hourly cap did not stop a flood');
  } else console.log('  ok    answers past the hourly cap are dropped');

  /* -- Groups: covers, invitations, and an owner taking a post out --------- */
  console.log('\ngroup covers');
  const listedGroup = await createGroup(cookies.author, {
    name: 'vtest listed group', listed: true,
  });
  const secretGroup = await createGroup(cookies.author, {
    name: 'vtest unlisted group', listed: false,
  });
  const listedCover = await coverIdOf(cookies.author, listedGroup);
  const secretCover = await coverIdOf(cookies.author, secretGroup);

  assertReach('listed cover, to a member', await status(`/media/${listedCover}`, cookies.stranger), true);
  assertReach('listed cover, anonymous', await status(`/media/${listedCover}`, null), false);
  assertReach('unlisted cover, to an outsider', await status(`/media/${secretCover}`, cookies.stranger), false);
  assertReach('unlisted cover, to its owner', await status(`/media/${secretCover}`, cookies.author), true);
  assertReach('the unlisted group page, to an outsider', await status(`/groups/${secretGroup}`, cookies.stranger), false);

  console.log('\nan invitation that has not been accepted');
  const secretPost = await createPost(cookies.author, {
    kind: 'story', title: 'vtest inside the unlisted group',
    visibility: 'group', groupId: secretGroup,
  });
  checks++;
  if (await post(`/groups/${secretGroup}/invite`, cookies.author, { member_id: PEOPLE.stranger.id }) !== 303) {
    failures++; console.error('  FAIL  owner could not invite');
  } else console.log('  ok    owner invited them');

  // Being invited is not being in. Nothing is readable until they say yes.
  assertReach('invited, before accepting', await status(`/post/${secretPost}`, cookies.stranger), false);
  await post(`/groups/${secretGroup}/accept`, cookies.stranger);
  assertReach('after accepting', await status(`/post/${secretPost}`, cookies.stranger), true);

  console.log('\nan owner taking a post out of their group');
  const matePost = await createPost(cookies.grpmate, {
    kind: 'story', title: 'vtest from a group member',
    visibility: 'group', groupId: 'vtest_group',
  });
  assertReach('owner sees it', await status(`/post/${matePost}`, cookies.author), true);

  // A member who is not the owner must not be able to unshare it.
  checks++;
  const refused = await post(`/groups/vtest_group/posts/${matePost}/remove`, cookies.grpmate);
  if (refused === 404) console.log('  ok    a non-owner cannot take it out (404)');
  else { failures++; console.error(`  FAIL  a non-owner got HTTP ${refused} removing a post`); }
  assertReach('still readable after that attempt', await status(`/post/${matePost}`, cookies.author), true);

  await post(`/groups/vtest_group/posts/${matePost}/remove`, cookies.author);
  assertReach('owner loses it once removed', await status(`/post/${matePost}`, cookies.author), false);
  assertReach('its author still has it', await status(`/post/${matePost}`, cookies.grpmate), true);

  // Delete through the app so the R2 objects go with the rows.
  for (const c of [[secretPost, cookies.author], [matePost, cookies.grpmate]]) {
    await fetch(`${BASE}/post/${c[0]}/delete`, {
      method: 'POST', headers: { cookie: c[1] }, redirect: 'manual',
    });
  }
  for (const id of Object.values(posts)) {
    await fetch(`${BASE}/post/${id}/delete`, {
      method: 'POST', headers: { cookie: cookies.author }, redirect: 'manual',
    });
  }

  // Group covers are not attached to a post, so nothing cascades them out of
  // R2. Drop them through the settings form, which does delete the object.
  for (const id of [listedGroup, secretGroup]) {
    const body = new FormData();
    body.set('name', 'vtest cleanup');
    body.set('kind', 'other');
    body.set('join_policy', 'invite');
    body.set('remove_cover', '1');
    await fetch(`${BASE}/groups/${id}/edit`, {
      method: 'POST', headers: { cookie: cookies.author }, body, redirect: 'manual',
    });
  }

  cleanup();

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) {
    console.error(`${failures} FAILED — do not deploy this.`);
    process.exit(1);
  }
  console.log('The privacy model holds.');
}

main().catch(async (err) => {
  console.error('\nHarness error:', err.message);
  try { cleanup(); } catch { /* best effort */ }
  process.exit(2);
});
