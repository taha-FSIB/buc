/**
 * The single source of truth for "who may read what".
 *
 * Every read path in the app MUST go through this module. Do not hand-write
 * `SELECT ... FROM posts` anywhere else — the privacy rule is only as strong
 * as the number of places it is written down, and that number should be one.
 *
 * A post is readable by a viewer when ANY of these hold:
 *   1. the viewer is the author;
 *   2. the post is posted (not draft) AND shared directly with the viewer;
 *   3. the post is posted AND shared with a group the viewer is active in;
 *   4. the post is posted AND shared publicly AND an admin approved it.
 *
 * Note what is absent: admins get no blanket read access to private vaults.
 * Moderators see a post only once a member has offered it to the public, which
 * is exactly the moment consent exists. That is deliberate — see CLAUDE.md.
 */

/** SQL that yields the set of post ids a viewer may read. */
const READABLE_POST_IDS = `
  SELECT p.id
    FROM posts p
   WHERE p.author_id = ?1

  UNION

  SELECT p.id
    FROM posts p
    JOIN post_shares s ON s.post_id = p.id
   WHERE p.state = 'posted'
     AND s.audience_kind = 'member'
     AND s.audience_id = ?1

  UNION

  SELECT p.id
    FROM posts p
    JOIN post_shares s  ON s.post_id = p.id
    JOIN group_members g ON g.group_id = s.audience_id
   WHERE p.state = 'posted'
     AND s.audience_kind = 'group'
     AND g.member_id = ?1
     AND g.state = 'active'

  UNION

  SELECT p.id
    FROM posts p
    JOIN post_shares s       ON s.post_id = p.id
    JOIN public_submissions m ON m.post_id = p.id
   WHERE p.state = 'posted'
     AND s.audience_kind = 'public'
     AND m.status = 'approved'
`;

/**
 * SQL for the ONE read path that is not a member's own reach: a moderator
 * looking at something that has been offered to the public.
 *
 * Deliberately narrow. It requires a 'public' share row — the member's own
 * act of offering — so a private vault stays unreadable to admins. Consent
 * exists exactly when the member asked for the post to be seen, and not a
 * moment before. Callers must be behind requireAdmin.
 */
const MODERATABLE_POST_IDS = `
  SELECT p.id
    FROM posts p
    JOIN post_shares s        ON s.post_id = p.id
    JOIN public_submissions m ON m.post_id = p.id
   WHERE p.state = 'posted'
     AND s.audience_kind = 'public'
     AND m.status IN ('pending', 'approved')
`;

/** SQL for the anonymous public site: approved public posts only. */
const PUBLIC_POST_IDS = `
  SELECT p.id
    FROM posts p
    JOIN post_shares s        ON s.post_id = p.id
    JOIN public_submissions m ON m.post_id = p.id
   WHERE p.state = 'posted'
     AND s.audience_kind = 'public'
     AND m.status = 'approved'
`;

export interface PostRow {
  id: string;
  author_id: string;
  author_name: string;
  title: string | null;
  body: string | null;
  medium: 'text' | 'photo' | 'audio' | 'video';
  language: 'en' | 'ta' | 'si';
  created_at: number;
}

const POST_COLUMNS = `
  p.id, p.author_id, p.title, p.body, p.medium, p.language, p.created_at,
  COALESCE(m.preferred_name, m.full_name) AS author_name
`;

/** Can this viewer read this post? The gate for every single-post page. */
export async function canRead(
  db: D1Database,
  viewerId: string | null,
  postId: string,
): Promise<boolean> {
  const sql = viewerId
    ? `SELECT 1 FROM (${READABLE_POST_IDS}) WHERE id = ?2 LIMIT 1`
    : `SELECT 1 FROM (${PUBLIC_POST_IDS}) WHERE id = ?2 LIMIT 1`;

  const stmt = viewerId
    ? db.prepare(sql).bind(viewerId, postId)
    : db.prepare(sql).bind(null, postId);

  return (await stmt.first()) !== null;
}

/** Fetch a post, or null if the viewer may not read it. */
export async function getPost(
  db: D1Database,
  viewerId: string | null,
  postId: string,
): Promise<PostRow | null> {
  const ids = viewerId ? READABLE_POST_IDS : PUBLIC_POST_IDS;
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p
         JOIN members m ON m.id = p.author_id
        WHERE p.id IN (${ids}) AND p.id = ?2`,
    )
    .bind(viewerId, postId)
    .first<PostRow>();
}

/**
 * The moderator's read of a single post. Returns null unless the post has
 * actually been offered to the public pages. Only call this from a route
 * behind requireAdmin — this module knows about reach, not about roles.
 */
export function getPostForModeration(db: D1Database, postId: string) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p
         JOIN members m ON m.id = p.author_id
        WHERE p.id IN (${MODERATABLE_POST_IDS}) AND p.id = ?1`,
    )
    .bind(postId)
    .first<PostRow>();
}

/** The signed-in member's home feed: everything they may read, newest first. */
export function feedForViewer(
  db: D1Database,
  viewerId: string,
  limit = 30,
  offset = 0,
) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p
         JOIN members m ON m.id = p.author_id
        WHERE p.id IN (${READABLE_POST_IDS})
          AND p.state = 'posted'
        ORDER BY p.created_at DESC
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(viewerId, limit, offset)
    .all<PostRow>();
}

/** The member's own vault, drafts included. Only ever their own rows. */
export function vaultForMember(db: D1Database, memberId: string, limit = 50) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}, p.state
         FROM posts p
         JOIN members m ON m.id = p.author_id
        WHERE p.author_id = ?1 AND p.state != 'archived'
        ORDER BY p.updated_at DESC
        LIMIT ?2`,
    )
    .bind(memberId, limit)
    .all<PostRow & { state: string }>();
}

/** Posts shared into one group, for that group's page. Membership checked. */
export function feedForGroup(
  db: D1Database,
  viewerId: string,
  groupId: string,
  limit = 30,
) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p
         JOIN members m      ON m.id = p.author_id
         JOIN post_shares s  ON s.post_id = p.id
        WHERE s.audience_kind = 'group'
          AND s.audience_id = ?2
          AND p.state = 'posted'
          AND EXISTS (
                SELECT 1 FROM group_members g
                 WHERE g.group_id = ?2 AND g.member_id = ?1 AND g.state = 'active'
              )
        ORDER BY p.created_at DESC
        LIMIT ?3`,
    )
    .bind(viewerId, groupId, limit)
    .all<PostRow>();
}

/** The public site's feed. No viewer, no session, approved content only. */
export function publicFeed(db: D1Database, limit = 30, offset = 0) {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
         FROM posts p
         JOIN members m ON m.id = p.author_id
        WHERE p.id IN (${PUBLIC_POST_IDS})
        ORDER BY p.created_at DESC
        LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<PostRow>();
}

/**
 * Offer a post to the public site. Creates the share grant AND a pending
 * moderation row in one transaction — the post does not become publicly
 * readable until an admin sets status='approved'.
 */
export async function submitForPublic(
  db: D1Database,
  postId: string,
  memberId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO post_shares
           (id, post_id, audience_kind, audience_id, granted_by)
         VALUES (?1, ?2, 'public', NULL, ?3)`,
      )
      .bind(crypto.randomUUID(), postId, memberId),
    db
      .prepare(
        `INSERT INTO public_submissions (id, post_id, submitted_by, status)
         VALUES (?1, ?2, ?3, 'pending')
         ON CONFLICT (post_id) DO UPDATE SET
           status = 'pending', reviewed_by = NULL,
           reviewed_at = NULL, review_note = NULL`,
      )
      .bind(crypto.randomUUID(), postId, memberId),
  ]);
}

/**
 * Media inherits its post's visibility. Media not attached to a post is
 * readable by its owner, by anyone once the souvenir page carrying it is
 * approved, and — for profile photographs and group covers — by signed-in
 * members. Those two are shown in the Directory and the group list, so they
 * are visible to the batch by design; neither is ever served to the anonymous
 * public site.
 */
export async function canReadMedia(
  db: D1Database,
  viewerId: string | null,
  mediaId: string,
): Promise<{ r2_key: string; mime_type: string } | null> {
  const row = await db
    .prepare(
      `SELECT m.r2_key, m.mime_type, m.post_id, m.owner_id
         FROM media m WHERE m.id = ?1`,
    )
    .bind(mediaId)
    .first<{ r2_key: string; mime_type: string; post_id: string | null; owner_id: string }>();

  if (!row) return null;
  if (viewerId && row.owner_id === viewerId) return row;

  if (row.post_id) {
    return (await canRead(db, viewerId, row.post_id)) ? row : null;
  }

  // A profile photograph, to a signed-in member. Anonymous visitors get nothing.
  if (viewerId) {
    const isProfilePhoto = await db
      .prepare(
        `SELECT 1 FROM members
          WHERE photo_media_id = ?1 AND status = 'active' LIMIT 1`,
      )
      .bind(mediaId)
      .first();
    if (isProfilePhoto) return row;

    // A group's cover: to the batch if the group is listed — its existence is
    // already on the directory page — and otherwise only to people with a
    // membership row. An unlisted group gives nothing away, cover included.
    const isVisibleCover = await db
      .prepare(
        `SELECT 1 FROM groups g
          WHERE g.cover_media_id = ?1
            AND (g.listed = 1
                 OR EXISTS (SELECT 1 FROM group_members gm
                             WHERE gm.group_id = g.id AND gm.member_id = ?2))
          LIMIT 1`,
      )
      .bind(mediaId, viewerId)
      .first();
    if (isVisibleCover) return row;
  }

  // Unattached media: visible once it appears on an approved souvenir page.
  const onApprovedPage = await db
    .prepare(
      `SELECT 1 FROM flipbook_pages
        WHERE status = 'approved'
          AND (then_media_id = ?1 OR now_media_id = ?1)
        LIMIT 1`,
    )
    .bind(mediaId)
    .first();

  return onApprovedPage ? row : null;
}

/**
 * The moderator's equivalent for media: a photograph attached to something
 * offered to the public. Without this, an admin could read the words of a
 * submission but not see the picture they are being asked to approve.
 */
export async function mediaForModeration(
  db: D1Database,
  mediaId: string,
): Promise<{ r2_key: string; mime_type: string } | null> {
  const row = await db
    .prepare(
      `SELECT m.r2_key, m.mime_type
         FROM media m
        WHERE m.id = ?1
          AND m.post_id IN (${MODERATABLE_POST_IDS})`,
    )
    .bind(mediaId)
    .first<{ r2_key: string; mime_type: string }>();

  return row ?? null;
}

export interface ShareRow {
  id: string;
  audience_kind: 'member' | 'group' | 'public';
  audience_id: string | null;
  audience_name: string | null;
}

/** Who a post currently reaches, for the "Shared with" list on the post page. */
export function sharesForPost(db: D1Database, postId: string) {
  return db
    .prepare(
      `SELECT s.id, s.audience_kind, s.audience_id,
              CASE s.audience_kind
                WHEN 'member' THEN (SELECT COALESCE(preferred_name, full_name)
                                      FROM members WHERE id = s.audience_id)
                WHEN 'group'  THEN (SELECT name FROM groups WHERE id = s.audience_id)
                ELSE NULL
              END AS audience_name
         FROM post_shares s
        WHERE s.post_id = ?1
        ORDER BY s.audience_kind, audience_name`,
    )
    .bind(postId)
    .all<ShareRow>();
}

/** Current moderation state of a post's public submission, if any. */
export function publicStatusFor(db: D1Database, postId: string) {
  return db
    .prepare(
      `SELECT status, review_note FROM public_submissions WHERE post_id = ?1`,
    )
    .bind(postId)
    .first<{ status: string; review_note: string | null }>();
}
