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

/**
 * What kind of thing a browser says this file is, or null if we will not take
 * it. Exported so a caller can reject a file BEFORE it reaches R2 — otherwise
 * a rejected upload leaves bytes behind that nothing will ever clean up.
 */
export function kindOf(mimeType: string): 'photo' | 'audio' | 'video' | 'pdf' | null {
  return ALLOWED[mimeType]?.kind ?? null;
}

/**
 * Size ceilings, per kind rather than one blanket number.
 *
 * A 100 MB photograph is never a real photograph — it is a mistake or an
 * attack, and either way the member finds out in the first second instead of
 * after ten minutes of uploading over a Sri Lankan mobile connection. Video
 * keeps the generous ceiling because a two-minute clip from a phone genuinely
 * reaches that size.
 */
export const MAX_BYTES_BY_KIND: Record<'photo' | 'audio' | 'video' | 'pdf', number> = {
  photo: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
};

/** The largest anything may be. Used for the copy on the compose form. */
export const MAX_BYTES = MAX_BYTES_BY_KIND.video;

const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);

export interface StoredMedia {
  id: string;
  kind: 'photo' | 'audio' | 'video' | 'pdf';
}

export class UploadError extends Error {}

/**
 * Is file storage available at all?
 *
 * False on a deployment where R2 has not been switched on. Callers use this to
 * stop OFFERING to take a photograph, which matters more than handling the
 * failure: a form that accepts a file and then refuses it wastes an upload
 * over mobile data and reads as the site being broken.
 */
export function mediaEnabled(env: { MEDIA?: R2Bucket }): boolean {
  return Boolean(env.MEDIA);
}

/** What to say when somebody reaches an upload anyway. */
export const MEDIA_OFF =
  'Photographs and recordings are switched off on this site at the moment. '
  + 'Your words are safe — everything else works as usual.';

/**
 * Store one uploaded file in R2 and record it in D1.
 * `postId` may be null for media attached to a souvenir page instead.
 */
export async function storeUpload(
  env: { DB: D1Database; MEDIA?: R2Bucket },
  file: File,
  ownerId: string,
  postId: string | null,
  altText: string | null,
): Promise<StoredMedia> {
  if (!env.MEDIA) throw new UploadError(MEDIA_OFF);

  const spec = ALLOWED[file.type];
  if (!spec) {
    throw new UploadError(
      'That kind of file cannot be added yet. Photos, audio, video and PDFs work.',
    );
  }
  const ceiling = MAX_BYTES_BY_KIND[spec.kind];
  if (file.size > ceiling) {
    throw new UploadError(
      `That file is ${MB(file.size)} MB. The most we can take here is ${MB(ceiling)} MB.`,
    );
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
  env: { DB: D1Database; MEDIA?: R2Bucket },
  mediaId: string,
  ownerId: string,
): Promise<void> {
  if (!env.MEDIA) return;

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
