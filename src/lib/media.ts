/**
 * R2 upload and retrieval.
 *
 * Media inherits the visibility of the post it hangs off. There is no
 * public R2 bucket and no signed URL — every byte is served through
 * /media/:id, which re-checks readability on each request. A leaked media
 * URL therefore grants nothing, which matters when members forward links
 * over WhatsApp without thinking about who else is in the group.
 */

import { newId } from './ids';

/** What members may upload, and what we will render back. */
const ALLOWED: Record<string, { kind: 'photo' | 'audio' | 'video' | 'pdf'; ext: string }> = {
  'image/jpeg':      { kind: 'photo', ext: 'jpg'  },
  'image/png':       { kind: 'photo', ext: 'png'  },
  'image/webp':      { kind: 'photo', ext: 'webp' },
  'image/heic':      { kind: 'photo', ext: 'heic' }, // iPhone default
  'image/heif':      { kind: 'photo', ext: 'heif' },
  'audio/mpeg':      { kind: 'audio', ext: 'mp3'  },
  'audio/mp4':       { kind: 'audio', ext: 'm4a'  },
  'audio/aac':       { kind: 'audio', ext: 'aac'  },
  'audio/ogg':       { kind: 'audio', ext: 'ogg'  },
  'audio/wav':       { kind: 'audio', ext: 'wav'  },
  'audio/webm':      { kind: 'audio', ext: 'weba' },
  'video/mp4':       { kind: 'video', ext: 'mp4'  },
  'video/quicktime': { kind: 'video', ext: 'mov'  }, // iPhone default
  'video/webm':      { kind: 'video', ext: 'webm' },
  'application/pdf': { kind: 'pdf',   ext: 'pdf'  },
};

/** 100 MB. Generous enough for a phone video, small enough to survive a slow uplink. */
export const MAX_BYTES = 100 * 1024 * 1024;

export interface StoredMedia {
  id: string;
  kind: 'photo' | 'audio' | 'video' | 'pdf';
}

export class UploadError extends Error {}

/**
 * Store one uploaded file in R2 and record it in D1.
 * `postId` may be null for media attached to a souvenir page instead.
 */
export async function storeUpload(
  env: { DB: D1Database; MEDIA: R2Bucket },
  file: File,
  ownerId: string,
  postId: string | null,
  altText: string | null,
): Promise<StoredMedia> {
  const spec = ALLOWED[file.type];
  if (!spec) {
    throw new UploadError(
      'That kind of file cannot be added yet. Photos, audio, video and PDFs work.',
    );
  }
  if (file.size > MAX_BYTES) {
    throw new UploadError('That file is larger than 100 MB. Please try a smaller one.');
  }
  if (file.size === 0) {
    throw new UploadError('That file appears to be empty.');
  }

  const id = newId();
  const key = `${ownerId}/${id}.${spec.ext}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  try {
    await env.DB
      .prepare(
        `INSERT INTO media
           (id, post_id, owner_id, r2_key, kind, mime_type, byte_size,
            original_filename, alt_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(id, postId, ownerId, key, spec.kind, file.type, file.size,
            file.name || null, altText)
      .run();
  } catch (err) {
    // Never leave an orphaned object paying storage for a row that failed.
    await env.MEDIA.delete(key);
    throw err;
  }

  return { id, kind: spec.kind };
}

/** Delete both the R2 object and its row. */
export async function deleteMedia(
  env: { DB: D1Database; MEDIA: R2Bucket },
  mediaId: string,
  ownerId: string,
): Promise<void> {
  const row = await env.DB
    .prepare('SELECT r2_key FROM media WHERE id = ?1 AND owner_id = ?2')
    .bind(mediaId, ownerId)
    .first<{ r2_key: string }>();
  if (!row) return;

  await env.MEDIA.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM media WHERE id = ?1').bind(mediaId).run();
}

export interface MediaRow {
  id: string;
  post_id: string | null;
  owner_id: string;
  r2_key: string;
  kind: 'photo' | 'audio' | 'video' | 'pdf';
  mime_type: string;
  alt_text: string | null;
}

export function mediaForPost(db: D1Database, postId: string) {
  return db
    .prepare(
      `SELECT id, post_id, owner_id, r2_key, kind, mime_type, alt_text
         FROM media WHERE post_id = ?1 ORDER BY created_at`,
    )
    .bind(postId)
    .all<MediaRow>();
}
