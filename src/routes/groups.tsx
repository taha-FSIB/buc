import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { PlusIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { feedForGroup } from '../lib/visibility';
import { newId } from '../lib/ids';

export const groupRoutes = new Hono<AppBindings>();


const KINDS = [
  { code: 'interest', label: 'A shared interest', hint: 'Cricket, gardening, reading' },
  { code: 'project',  label: 'A project',        hint: 'The souvenir, the scholarship fund' },
  { code: 'family',   label: 'Family',           hint: 'For relatives within the batch' },
  { code: 'other',    label: 'Something else',   hint: '' },
] as const;

const JOIN_POLICIES = [
  { code: 'open',    label: 'Anyone in the batch can join straight away' },
  { code: 'request', label: 'People ask, and I say yes or no' },
  { code: 'invite',  label: 'Only I can add people' },
] as const;

/* -- Browse ---------------------------------------------------------------- */
groupRoutes.get('/groups', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  const [{ results: mine }, { results: others }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT g.id, g.name, g.description, gm.role, gm.state
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE gm.member_id = ?1 AND gm.state IN ('active','pending')
          ORDER BY g.name`,
      )
      .bind(viewer.id)
      .all<{ id: string; name: string; description: string | null; role: string; state: string }>(),
    c.env.DB
      .prepare(
        `SELECT g.id, g.name, g.description, g.join_policy,
                (SELECT COUNT(*) FROM group_members x
                  WHERE x.group_id = g.id AND x.state = 'active') AS members
           FROM groups g
          WHERE g.listed = 1
            AND g.id NOT IN (SELECT group_id FROM group_members
                              WHERE member_id = ?1 AND state IN ('active','pending'))
          ORDER BY g.name`,
      )
      .bind(viewer.id)
      .all<{ id: string; name: string; description: string | null; join_policy: string; members: number }>(),
  ]);

  return c.html(
    <Layout title="Groups" viewer={viewer} tab="groups">
      <h1>Groups</h1>
      <p class="page-intro">
        Smaller corners of the batch — for an interest, a project, or family.
      </p>
      <a class="btn btn-block" href="/groups/new">
        <PlusIcon />
        Start a group
      </a>

      <h2 class="section-title">Your groups</h2>
      {mine.length === 0 ? (
        <p class="page-intro">You have not joined any groups yet.</p>
      ) : (
        mine.map((g) => (
          <a class="card" href={`/groups/${g.id}`}>
            <h2>{g.name}</h2>
            <p class="card-meta">
              {g.state === 'pending' ? 'Waiting to be let in' : g.role === 'owner' ? 'You started this' : 'Member'}
            </p>
            {g.description && <p class="card-body">{g.description}</p>}
          </a>
        ))
      )}

      <h2 class="section-title">Other groups</h2>
      {others.length === 0 ? (
        <p class="page-intro">
          Nothing else yet. Start the first one and invite a few friends.
        </p>
      ) : (
        others.map((g) => (
          <a class="card" href={`/groups/${g.id}`}>
            <h2>{g.name}</h2>
            <p class="card-meta">
              {g.members} {g.members === 1 ? 'member' : 'members'}
              {g.join_policy === 'invite' && ' · By invitation'}
            </p>
            {g.description && <p class="card-body">{g.description}</p>}
          </a>
        ))
      )}
    </Layout>,
  );
});

/* -- Create ---------------------------------------------------------------- */
groupRoutes.get('/groups/new', requireAuth, (c) =>
  c.html(
    <Layout title="Start a group" viewer={viewerOf(c)} tab="groups"
            back={{ href: '/groups', label: 'Groups' }}>
      <h1>Start a group</h1>
      <p class="page-intro">Anyone in the batch can start one. You decide who joins.</p>
      <form method="post" action="/groups/new">
        <div class="field">
          <label for="name">What is it called?</label>
          <input id="name" name="name" type="text" maxlength={80} required />
        </div>
        <div class="field">
          <label for="description">What is it for?</label>
          <span class="hint">A sentence is plenty.</span>
          <textarea id="description" name="description" style="min-height:6rem"></textarea>
        </div>
        <div class="field">
          <label for="kind">What kind of group?</label>
          <select id="kind" name="kind">
            {KINDS.map((k) => (
              <option value={k.code}>{k.label}{k.hint && ` — ${k.hint}`}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="join_policy">Who can join?</label>
          <select id="join_policy" name="join_policy">
            {JOIN_POLICIES.map((p) => <option value={p.code}>{p.label}</option>)}
          </select>
        </div>
        <button class="btn btn-block" type="submit">Start this group</button>
      </form>
    </Layout>,
  ),
);

groupRoutes.post('/groups/new', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const form = await c.req.formData();
  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  const kind = String(form.get('kind') ?? 'interest');
  const joinPolicy = String(form.get('join_policy') ?? 'request');

  if (!name) return c.redirect('/groups/new', 303);
  if (!KINDS.some((k) => k.code === kind)) return c.redirect('/groups/new', 303);
  if (!JOIN_POLICIES.some((p) => p.code === joinPolicy)) return c.redirect('/groups/new', 303);

  const id = newId();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO groups (id, name, description, kind, join_policy, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, name, description || null, kind, joinPolicy, viewer.id),
    c.env.DB
      .prepare(
        `INSERT INTO group_members (group_id, member_id, role, state)
         VALUES (?1, ?2, 'owner', 'active')`,
      )
      .bind(id, viewer.id),
  ]);

  return c.redirect(`/groups/${id}`, 303);
});

/* -- One group ------------------------------------------------------------- */
groupRoutes.get('/groups/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const group = await c.env.DB
    .prepare('SELECT id, name, description, join_policy, listed FROM groups WHERE id = ?1')
    .bind(id)
    .first<{ id: string; name: string; description: string | null; join_policy: string; listed: number }>();
  if (!group) return c.notFound();

  const membership = await c.env.DB
    .prepare('SELECT role, state FROM group_members WHERE group_id = ?1 AND member_id = ?2')
    .bind(id, viewer.id)
    .first<{ role: string; state: string }>();

  const isMember = membership?.state === 'active';
  const isOwner = isMember && membership?.role === 'owner';

  // An unlisted group is invisible to non-members entirely.
  if (!group.listed && !membership) return c.notFound();

  const posts = isMember ? (await feedForGroup(c.env.DB, viewer.id, id)).results : [];

  const { results: people } = isMember
    ? await c.env.DB
        .prepare(
          `SELECT m.id, COALESCE(m.preferred_name, m.full_name) AS name, gm.role, gm.state
             FROM group_members gm
             JOIN members m ON m.id = gm.member_id
            WHERE gm.group_id = ?1 AND gm.state IN ('active','pending')
            ORDER BY gm.state DESC, name`,
        )
        .bind(id)
        .all<{ id: string; name: string; role: string; state: string }>()
    : { results: [] as { id: string; name: string; role: string; state: string }[] };

  const pending = people.filter((p) => p.state === 'pending');

  return c.html(
    <Layout title={group.name} viewer={viewer} tab="groups"
            back={{ href: '/groups', label: 'Groups' }}>
      <h1>{group.name}</h1>
      {group.description && <p class="page-intro">{group.description}</p>}

      {!membership && (
        <form method="post" action={`/groups/${id}/join`}>
          <button class="btn btn-block" type="submit">
            {group.join_policy === 'open' ? 'Join this group'
              : group.join_policy === 'request' ? 'Ask to join'
              : 'This group is by invitation only'}
          </button>
        </form>
      )}

      {membership?.state === 'pending' && (
        <div class="notice">
          <strong>You have asked to join.</strong>
          <p>Whoever started the group will let you in.</p>
        </div>
      )}

      {isMember && (
        <>
          {isOwner && pending.length > 0 && (
            <>
              <h2 class="section-title">Waiting to join</h2>
              {pending.map((p) => (
                <div class="card">
                  <h3>{p.name}</h3>
                  <form method="post" action={`/groups/${id}/approve`} style="display:inline">
                    <input type="hidden" name="member_id" value={p.id} />
                    <button class="btn btn-compact" type="submit">Let them in</button>
                  </form>
                  {' '}
                  <form method="post" action={`/groups/${id}/remove`} style="display:inline">
                    <input type="hidden" name="member_id" value={p.id} />
                    <button class="btn btn-secondary btn-compact" type="submit">Not now</button>
                  </form>
                </div>
              ))}
            </>
          )}

          <h2 class="section-title">Shared with this group</h2>
          {posts.length === 0 ? (
            <div class="empty">
              <h3>Nothing shared here yet</h3>
              <p>
                Anything you share with this group will appear here for
                everyone in it.
              </p>
              <a class="btn" href="/vault">Share from my vault</a>
            </div>
          ) : (
            posts.map((p) => (
              <a class="card" href={`/post/${p.id}`}>
                <h2>{p.title || 'Untitled'}</h2>
                <p class="card-meta">{p.author_name}</p>
              </a>
            ))
          )}

          <h2 class="section-title">Who is in this group</h2>
          <ul class="directory">
            {people.filter((p) => p.state === 'active').map((p) => (
              <li>
                <a href={`/members/${p.id}`}>
                  {p.name}{p.role === 'owner' ? ' · started this group' : ''}
                </a>
              </li>
            ))}
          </ul>

          <p style="margin-top:2rem">
            <form method="post" action={`/groups/${id}/leave`}>
              <button class="linklike" type="submit">Leave this group</button>
            </form>
          </p>
        </>
      )}
    </Layout>,
  );
});

/* -- Join / leave / owner actions ------------------------------------------ */
groupRoutes.post('/groups/:id/join', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const group = await c.env.DB
    .prepare('SELECT join_policy FROM groups WHERE id = ?1')
    .bind(id)
    .first<{ join_policy: string }>();
  if (!group) return c.notFound();
  if (group.join_policy === 'invite') return c.redirect(`/groups/${id}`, 303);

  await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO group_members (group_id, member_id, role, state)
       VALUES (?1, ?2, 'member', ?3)`,
    )
    .bind(id, viewer.id, group.join_policy === 'open' ? 'active' : 'pending')
    .run();

  return c.redirect(`/groups/${id}`, 303);
});

groupRoutes.post('/groups/:id/leave', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  // Never let the last owner walk out and strand the group.
  const owners = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM group_members
        WHERE group_id = ?1 AND role = 'owner' AND state = 'active'`,
    )
    .bind(id)
    .first<{ n: number }>();

  const me = await c.env.DB
    .prepare('SELECT role FROM group_members WHERE group_id = ?1 AND member_id = ?2')
    .bind(id, viewer.id)
    .first<{ role: string }>();

  if (me?.role === 'owner' && (owners?.n ?? 0) <= 1) {
    return c.html(
      <Layout title="Leave group" viewer={viewer} tab="groups"
              back={{ href: `/groups/${id}`, label: 'Back to the group' }}>
        <ErrorNotice title="You are the only owner.">
          <p>
            Make someone else an owner first, so the group is not left without
            anyone to look after it.
          </p>
        </ErrorNotice>
        <a class="btn btn-block" href={`/groups/${id}`}>Back to the group</a>
      </Layout>,
      400,
    );
  }

  await c.env.DB
    .prepare('DELETE FROM group_members WHERE group_id = ?1 AND member_id = ?2')
    .bind(id, viewer.id)
    .run();

  return c.redirect('/groups', 303);
});

/** Owner lets a pending member in. */
groupRoutes.post('/groups/:id/approve', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const memberId = String(form.get('member_id') ?? '');

  const isOwner = await c.env.DB
    .prepare(
      `SELECT 1 FROM group_members
        WHERE group_id = ?1 AND member_id = ?2 AND role = 'owner' AND state = 'active'`,
    )
    .bind(id, viewer.id)
    .first();
  if (!isOwner) return c.notFound();

  await c.env.DB
    .prepare(
      `UPDATE group_members SET state = 'active'
        WHERE group_id = ?1 AND member_id = ?2 AND state = 'pending'`,
    )
    .bind(id, memberId)
    .run();

  return c.redirect(`/groups/${id}`, 303);
});

groupRoutes.post('/groups/:id/remove', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const form = await c.req.formData();
  const memberId = String(form.get('member_id') ?? '');

  const isOwner = await c.env.DB
    .prepare(
      `SELECT 1 FROM group_members
        WHERE group_id = ?1 AND member_id = ?2 AND role = 'owner' AND state = 'active'`,
    )
    .bind(id, viewer.id)
    .first();
  if (!isOwner) return c.notFound();
  if (memberId === viewer.id) return c.redirect(`/groups/${id}`, 303);

  await c.env.DB
    .prepare('DELETE FROM group_members WHERE group_id = ?1 AND member_id = ?2')
    .bind(id, memberId)
    .run();

  return c.redirect(`/groups/${id}`, 303);
});
