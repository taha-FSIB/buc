import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { canReadMedia, mediaForModeration } from '../lib/visibility';

export const mediaRoutes = new Hono<AppBindings>();

/**
 * Serve one object from R2, but only to someone allowed to see the post it
 * belongs to. There are no signed URLs and no public bucket: a media link
 * forwarded into the wrong WhatsApp group grants the recipient nothing.
 *
 * Supports Range so a long recording can be scrubbed without refetching.
 */
mediaRoutes.get('/media/:id', async (c) => {
  const viewer = c.get('viewer');
  const id = c.req.param('id');

  let allowed = await canReadMedia(c.env.DB, viewer?.id ?? null, id);

  // An admin may also see a photograph attached to something offered to the
  // public pages — otherwise they would be approving a picture sight unseen.
  // Nothing else in a private vault opens up: see mediaForModeration.
  if (!allowed && viewer?.role === 'admin') {
    allowed = await mediaForModeration(c.env.DB, id);
  }

  // Indistinguishable from a missing object, so this never confirms that a
  // private item exists.
  if (!allowed) return c.notFound();

  const range = c.req.header('range');
  const object = await c.env.MEDIA.get(allowed.r2_key, range ? { range: c.req.raw.headers } : undefined);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-type', allowed.mime_type);
  headers.set('accept-ranges', 'bytes');
  // Private: proxies and shared caches must never hold a member's photo.
  headers.set('cache-control', 'private, max-age=3600');

  if (object.range && 'offset' in object.range) {
    const start = object.range.offset ?? 0;
    const end = start + (object.range.length ?? object.size) - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  return new Response(object.body, { headers });
});
