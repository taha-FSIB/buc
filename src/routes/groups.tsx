import { Hono } from 'hono';
import type { FC } from 'hono/jsx';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import { PlusIcon } from '../views/icons';
import { requireAuth, viewerOf } from '../lib/guard';
import { feedForGroup } from '../lib/visibility';
import { storeUpload, deleteMedia, kindOf, UploadError } from '../lib/media';
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
  { code: 'invite',  label: 'Nobody can ask — I add people myself' },
] as const;

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  join_policy: string;
  listed: number;
  cover_media_id: string | null;
  created_by: string;
}

const GROUP_COLUMNS =
  'id, name, description, kind, join_policy, listed, cover_media_id, created_by';

/** Owner of this group, and still an active member of it. */
async function isOwner(db: D1Database, groupId: string, memberId: string) {
  const row = await db
    .prepare(
      `SELECT 1 FROM group_members
        WHERE group_id = ?1 AND member_id = ?2
          AND role = 'owner' AND state = 'active'`,
    )
    .bind(groupId, memberId)
    .first();
  return row !== null;
}

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

const Cover: FC<{ id: string | null; name: string; large?: boolean }> = ({ id, name, large }) =>
  id ? (
    <img class={large ? 'group-cover group-cover-large' : 'group-cover'}
         src={`/media/${id}`} alt={`The ${name} group`} loading="lazy" />
  ) : null;

/* -- Browse ---------------------------------------------------------------- */
groupRoutes.get('/groups', requireAuth, async (c) => {
  const viewer = viewerOf(c);

  const [{ results: mine }, { results: others }] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT g.id, g.name, g.description, g.cover_media_id, gm.role, gm.state,
                (SELECT COUNT(*) FROM group_members x
                  WHERE x.group_id = g.id AND x.state = 'active') AS members
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE gm.member_id = ?1 AND gm.state IN ('active','pending','invited')
          ORDER BY gm.state = 'invited' DESC, g.name`,
      )
      .bind(viewer.id)
      .all<{
        id: string; name: string; description: string | null;
        cover_media_id: string | null; role: string; state: string; members: number;
      }>(),
    c.env.DB
      .prepare(
        `SELECT g.id, g.name, g.description, g.join_policy, g.cover_media_id,
                (SELECT COUNT(*) FROM group_members x
                  WHERE x.group_id = g.id AND x.state = 'active') AS members
           FROM groups g
          WHERE g.listed = 1
            AND g.id NOT IN (SELECT group_id FROM group_members
                              WHERE member_id = ?1
                                AND state IN ('active','pending','invited'))
          ORDER BY g.name`,
      )
      .bind(viewer.id)
      .all<{
        id: string; name: string; description: string | null;
        join_policy: string; cover_media_id: string | null; members: number;
      }>(),
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
            <Cover id={g.cover_media_id} name={g.name} />
            <h2>{g.name}</h2>
            <p class="card-meta">
              {g.state === 'invited' ? 'You have been invited — have a look'
                : g.state === 'pending' ? 'Waiting to be let in'
                : g.role === 'owner' ? `You started this · ${g.members} in it`
                : `${g.members} ${g.members === 1 ? 'member' : 'members'}`}
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
            <Cover id={g.cover_media_id} name={g.name} />
            <h2>{g.name}</h2>
            <p class="card-meta">
              {g.members} {g.members === 1 ? 'member' : 'members'}
              {g.join_policy === 'open' && ' · Anyone can join'}
              {g.join_policy === 'request' && ' · Ask to join'}
              {g.join_policy === 'invite' && ' · By invitation'}
            </p>
            {g.description && <p class="card-body">{g.description}</p>}
          </a>
        ))
      )}
    </Layout>,
  );
});

/* -- Create and edit -------------------------------------------------------- */
const GroupForm: FC<{
  viewer: ReturnType<typeof viewerOf>;
  group?: GroupRow;
  error?: string;
}> = ({ viewer, group, error }) => {
  const editing = Boolean(group);
  const action = editing ? `/groups/${group!.id}/edit` : '/groups/new';

  return (
    <Layout title={editing ? 'Group settings' : 'Start a group'} viewer={viewer} tab="groups"
            back={editing
              ? { href: `/groups/${group!.id}`, label: 'Back to the group' }
              : { href: '/groups', label: 'Groups' }}>
      <h1>{editing ? 'Group settings' : 'Start a group'}</h1>
      {!editing && (
        <p class="page-intro">Anyone in the batch can start one. You decide who joins.</p>
      )}

      {error && <ErrorNotice title="That did not save."><p>{error}</p></ErrorNotice>}

      <form method="post" action={action} enctype="multipart/form-data">
        <div class="field">
          <label for="name">What is it called?</label>
          <input id="name" name="name" type="text" maxlength={80}
                 value={group?.name ?? ''} required />
        </div>

        <div class="field">
          <label for="description">What is it for?</label>
          <span class="hint">A sentence is plenty.</span>
          {/* One line: a textarea preserves the whitespace between its tags. */}
          <textarea id="description" name="description" style="min-height:6rem">{group?.description ?? ''}</textarea>
        </div>

        <div class="field">
          <label for="cover">A photograph for the top of the page</label>
          <span class="hint">Optional. It shows in the list of groups too.</span>
          {group?.cover_media_id && (
            <Cover id={group.cover_media_id} name={group.name} />
          )}
          <input id="cover" name="cover" type="file" accept="image/*" />
          {group?.cover_media_id && (
            <label class="check" style="margin-top:0.75rem">
              <input type="checkbox" name="remove_cover" value="1" />
              <span>Remove the photograph it has now</span>
            </label>
          )}
        </div>

        <div class="field">
          <label for="kind">What kind of group?</label>
          <select id="kind" name="kind">
            {KINDS.map((k) => (
              <option value={k.code} selected={group?.kind === k.code}>
                {k.label}{k.hint && ` — ${k.hint}`}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label for="join_policy">Who can join?</label>
          <select id="join_policy" name="join_policy">
            {JOIN_POLICIES.map((p) => (
              <option value={p.code} selected={group?.join_policy === p.code}>{p.label}</option>
            ))}
          </select>
        </div>

        <label class="check">
          <input type="checkbox" name="listed" value="1"
                 checked={group ? group.listed === 1 : true} />
          <span>
            <span class="check-label">Show this group in the list</span>
            <span class="card-meta">
              Turn this off and only people already in it can find it.
            </span>
          </span>
        </label>

        <button class="btn btn-block" type="submit" style="margin-top:var(--space-md)">
          {editing ? 'Save these settings' : 'Start this group'}
        </button>
      </form>
    </Layout>
  );
};

groupRoutes.get('/groups/new', requireAuth, (c) =>
  c.html(<GroupForm viewer={viewerOf(c)} />));

/** Shared by create and edit: read the form, or an error to show back. */
async function readGroupForm(form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim() || null;
  const kind = String(form.get('kind') ?? 'interest');
  const joinPolicy = String(form.get('join_policy') ?? 'request');
  const listed = form.get('listed') === '1' ? 1 : 0;
  const cover = form.get('cover');
  const hasCover = cover instanceof File && cover.size > 0;

  if (!name) return { error: 'Please give the group a name.' } as const;
  if (!KINDS.some((k) => k.code === kind)) {
    return { error: 'Please choose what kind of group this is.' } as const;
  }
  if (!JOIN_POLICIES.some((p) => p.code === joinPolicy)) {
    return { error: 'Please choose who can join.' } as const;
  }
  // Checked before anything reaches R2, so a refused upload leaves nothing behind.
  if (hasCover && kindOf(cover.type) !== 'photo') {
    return { error: 'The cover needs to be a photograph. A JPEG or PNG works best.' } as const;
  }

  return {
    name, description, kind, joinPolicy, listed,
    cover: hasCover ? cover : null,
  } as const;
}

groupRoutes.post('/groups/new', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const parsed = await readGroupForm(await c.req.formData());
  if ('error' in parsed) {
    return c.html(<GroupForm viewer={viewer} error={parsed.error} />, 400);
  }

  let coverId: string | null = null;
  if (parsed.cover) {
    try {
      coverId = (await storeUpload(c.env, parsed.cover, viewer.id, null,
        `The ${parsed.name} group`)).id;
    } catch (err) {
      return c.html(
        <GroupForm viewer={viewer} error={err instanceof UploadError ? err.message
          : 'We could not save that photograph. Please try another one.'} />,
        400,
      );
    }
  }

  const id = newId();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO groups
           (id, name, description, kind, join_policy, listed, cover_media_id, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(id, parsed.name, parsed.description, parsed.kind, parsed.joinPolicy,
            parsed.listed, coverId, viewer.id),
    c.env.DB
      .prepare(
        `INSERT INTO group_members (group_id, member_id, role, state)
         VALUES (?1, ?2, 'owner', 'active')`,
      )
      .bind(id, viewer.id),
  ]);

  return c.redirect(`/groups/${id}`, 303);
});

groupRoutes.get('/groups/:id/edit', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();

  const group = await c.env.DB
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = ?1`)
    .bind(id)
    .first<GroupRow>();
  if (!group) return c.notFound();

  return c.html(<GroupForm viewer={viewer} group={group} />);
});

groupRoutes.post('/groups/:id/edit', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();

  const group = await c.env.DB
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = ?1`)
    .bind(id)
    .first<GroupRow>();
  if (!group) return c.notFound();

  const form = await c.req.formData();
  const parsed = await readGroupForm(form);
  if ('error' in parsed) {
    return c.html(<GroupForm viewer={viewer} group={group} error={parsed.error} />, 400);
  }

  let coverId = group.cover_media_id;
  if (parsed.cover) {
    try {
      coverId = (await storeUpload(c.env, parsed.cover, viewer.id, null,
        `The ${parsed.name} group`)).id;
    } catch (err) {
      return c.html(
        <GroupForm viewer={viewer} group={group}
          error={err instanceof UploadError ? err.message
            : 'We could not save that photograph. Please try another one.'} />,
        400,
      );
    }
  } else if (form.get('remove_cover') === '1') {
    coverId = null;
  }

  await c.env.DB
    .prepare(
      `UPDATE groups
          SET name = ?1, description = ?2, kind = ?3, join_policy = ?4,
              listed = ?5, cover_media_id = ?6
        WHERE id = ?7`,
    )
    .bind(parsed.name, parsed.description, parsed.kind, parsed.joinPolicy,
          parsed.listed, coverId, id)
    .run();

  // Only after the row stopped pointing at it, so a failed save never leaves
  // the group showing a broken image.
  if (group.cover_media_id && group.cover_media_id !== coverId) {
    await deleteMedia(c.env, group.cover_media_id, group.created_by);
  }

  return c.redirect(`/groups/${id}`, 303);
});

/* -- One group ------------------------------------------------------------- */
groupRoutes.get('/groups/:id', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  const group = await c.env.DB
    .prepare(`SELECT ${GROUP_COLUMNS} FROM groups WHERE id = ?1`)
    .bind(id)
    .first<GroupRow>();
  if (!group) return c.notFound();

  const membership = await c.env.DB
    .prepare('SELECT role, state FROM group_members WHERE group_id = ?1 AND member_id = ?2')
    .bind(id, viewer.id)
    .first<{ role: string; state: string }>();

  const isMember = membership?.state === 'active';
  const owner = isMember && membership?.role === 'owner';

  // An unlisted group is invisible to anyone without a membership row.
  if (!group.listed && !membership) return c.notFound();

  const posts = isMember ? (await feedForGroup(c.env.DB, viewer.id, id)).results : [];

  const { results: people } = isMember
    ? await c.env.DB
        .prepare(
          `SELECT m.id, COALESCE(m.preferred_name, m.full_name) AS name,
                  m.photo_media_id, gm.role, gm.state
             FROM group_members gm
             JOIN members m ON m.id = gm.member_id
            WHERE gm.group_id = ?1 AND gm.state IN ('active','pending','invited')
            ORDER BY gm.state DESC, name`,
        )
        .bind(id)
        .all<{
          id: string; name: string; photo_media_id: string | null;
          role: string; state: string;
        }>()
    : { results: [] as {
        id: string; name: string; photo_media_id: string | null;
        role: string; state: string;
      }[] };

  const pending = people.filter((p) => p.state === 'pending');
  const invited = people.filter((p) => p.state === 'invited');

  // Only owners get the "add somebody" list, and only for people not already in.
  const { results: addable } = owner
    ? await c.env.DB
        .prepare(
          `SELECT id, COALESCE(preferred_name, full_name) AS name
             FROM members
            WHERE status = 'active'
              AND id NOT IN (SELECT member_id FROM group_members WHERE group_id = ?1)
            ORDER BY name`,
        )
        .bind(id)
        .all<{ id: string; name: string }>()
    : { results: [] as { id: string; name: string }[] };

  return c.html(
    <Layout title={group.name} viewer={viewer} tab="groups"
            back={{ href: '/groups', label: 'Groups' }}>
      <Cover id={group.cover_media_id} name={group.name} large />
      <h1>{group.name}</h1>
      {group.description && <p class="page-intro">{group.description}</p>}

      {membership?.state === 'invited' && (
        <div class="notice" role="status">
          <strong>You have been invited to join.</strong>
          <p>Nothing here is shared with you until you accept.</p>
          <form method="post" action={`/groups/${id}/accept`} style="margin-top:0.75rem">
            <button class="btn btn-block" type="submit">Join {group.name}</button>
          </form>
          <form method="post" action={`/groups/${id}/decline`} style="margin-top:0.75rem">
            <button class="btn btn-secondary btn-block" type="submit">No thank you</button>
          </form>
        </div>
      )}

      {!membership && (
        group.join_policy === 'invite' ? (
          <div class="notice">
            <strong>This group is by invitation.</strong>
            <p>
              Whoever started it adds people themselves. Ask them on WhatsApp if
              you would like to be in it.
            </p>
          </div>
        ) : (
          <form method="post" action={`/groups/${id}/join`}>
            <button class="btn btn-block" type="submit">
              {group.join_policy === 'open' ? 'Join this group' : 'Ask to join'}
            </button>
          </form>
        )
      )}

      {membership?.state === 'pending' && (
        <div class="notice">
          <strong>You have asked to join.</strong>
          <p>Whoever started the group will let you in.</p>
        </div>
      )}

      {isMember && (
        <>
          {owner && pending.length > 0 && (
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
              <div class="card">
                <h2><a href={`/post/${p.id}`}>{p.title || 'Untitled'}</a></h2>
                <p class="card-meta">{p.author_name}</p>
                {/* The owner looks after their own group; no site admin needed.
                    This unshares it from here only — the memory stays in its
                    author's vault, and anywhere else they shared it. */}
                {owner && p.author_id !== viewer.id && (
                  <form method="post" action={`/groups/${id}/posts/${p.id}/remove`}>
                    <button class="linklike" type="submit">
                      Take this out of the group
                    </button>
                  </form>
                )}
              </div>
            ))
          )}

          <h2 class="section-title">Who is in this group</h2>
          <ul class="member-list">
            {people.filter((p) => p.state === 'active').map((p) => (
              <li>
                <a href={`/members/${p.id}`}>
                  {p.photo_media_id ? (
                    <img class="avatar" src={`/media/${p.photo_media_id}`} alt=""
                         width="56" height="56" loading="lazy" />
                  ) : (
                    <span class="avatar avatar-blank" aria-hidden="true">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span class="member-name">
                    {p.name}
                    {p.role === 'owner' && <span class="card-meta">Started this group</span>}
                  </span>
                </a>
                {owner && p.id !== viewer.id && (
                  <form method="post" action={`/groups/${id}/remove`}>
                    <input type="hidden" name="member_id" value={p.id} />
                    <button class="linklike" type="submit">Remove from the group</button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {owner && (
            <>
              <h2 class="section-title">Add somebody</h2>
              {invited.length > 0 && (
                <p class="page-intro">
                  Waiting to answer: {invited.map((p) => p.name).join(', ')}.
                </p>
              )}
              {addable.length === 0 ? (
                <p class="page-intro">Everyone in the batch is already here.</p>
              ) : (
                <form method="post" action={`/groups/${id}/invite`}>
                  <div class="field">
                    <label for="add">Who would you like to add?</label>
                    <span class="hint">
                      They are asked first — nobody is put into a group without saying yes.
                    </span>
                    <select id="add" name="member_id" required>
                      <option value="">Please choose…</option>
                      {addable.map((m) => <option value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <button class="btn btn-block" type="submit">Invite them</button>
                </form>
              )}

              <p style="margin-top:1.5rem">
                <a class="back" href={`/groups/${id}/edit`}>Group settings</a>
              </p>
            </>
          )}

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

/* -- Join / leave ---------------------------------------------------------- */
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

/* -- Being invited --------------------------------------------------------- */
groupRoutes.post('/groups/:id/accept', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  await c.env.DB
    .prepare(
      `UPDATE group_members SET state = 'active'
        WHERE group_id = ?1 AND member_id = ?2 AND state = 'invited'`,
    )
    .bind(id, viewer.id)
    .run();

  return c.redirect(`/groups/${id}`, 303);
});

groupRoutes.post('/groups/:id/decline', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');

  await c.env.DB
    .prepare(
      `DELETE FROM group_members
        WHERE group_id = ?1 AND member_id = ?2 AND state = 'invited'`,
    )
    .bind(id, viewer.id)
    .run();

  return c.redirect('/groups', 303);
});

/* -- Owner moderation ------------------------------------------------------ */

/** Owner invites somebody. They land as 'invited' and must accept. */
groupRoutes.post('/groups/:id/invite', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();

  const memberId = String((await c.req.formData()).get('member_id') ?? '');
  if (!memberId) return c.redirect(`/groups/${id}`, 303);

  const exists = await c.env.DB
    .prepare(`SELECT 1 FROM members WHERE id = ?1 AND status = 'active'`)
    .bind(memberId)
    .first();
  if (!exists) return c.redirect(`/groups/${id}`, 303);

  await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO group_members (group_id, member_id, role, state)
       VALUES (?1, ?2, 'member', 'invited')`,
    )
    .bind(id, memberId)
    .run();

  await log(c.env.DB, viewer.id, 'group_invited', 'group', id, memberId);
  return c.redirect(`/groups/${id}`, 303);
});

/** Owner lets a pending member in. */
groupRoutes.post('/groups/:id/approve', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const memberId = String((await c.req.formData()).get('member_id') ?? '');

  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();

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
  const memberId = String((await c.req.formData()).get('member_id') ?? '');

  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();
  if (memberId === viewer.id) return c.redirect(`/groups/${id}`, 303);

  // An owner cannot remove another owner: two people who each started this
  // together should not be able to eject one another mid-argument.
  await c.env.DB
    .prepare(
      `DELETE FROM group_members
        WHERE group_id = ?1 AND member_id = ?2 AND role != 'owner'`,
    )
    .bind(id, memberId)
    .run();

  await log(c.env.DB, viewer.id, 'group_member_removed', 'group', id, memberId);
  return c.redirect(`/groups/${id}`, 303);
});

/**
 * Take a post out of this group.
 *
 * This deletes one share grant and nothing else. The memory stays in its
 * author's vault, and stays wherever else they shared it — an owner looks
 * after their own group, they do not get to delete somebody's memory. No site
 * admin is involved, which is the point: a group is the members' own.
 */
groupRoutes.post('/groups/:id/posts/:postId/remove', requireAuth, async (c) => {
  const viewer = viewerOf(c);
  const id = c.req.param('id');
  const postId = c.req.param('postId');

  if (!(await isOwner(c.env.DB, id, viewer.id))) return c.notFound();

  await c.env.DB
    .prepare(
      `DELETE FROM post_shares
        WHERE post_id = ?1 AND audience_kind = 'group' AND audience_id = ?2`,
    )
    .bind(postId, id)
    .run();

  await log(c.env.DB, viewer.id, 'group_post_removed', 'post', postId, id);
  return c.redirect(`/groups/${id}`, 303);
});
