import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

/**
 * Gate for member-only routes. Signed-out visitors are sent to the welcome
 * page rather than shown a 403 — a dead end is a design failure here, not
 * just an inconvenience.
 */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('viewer')) return c.redirect('/welcome', 303);
  await next();
};

/** Gate for the admin area. */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const viewer = c.get('viewer');
  if (!viewer) return c.redirect('/welcome', 303);
  if (viewer.role !== 'admin') return c.notFound();
  await next();
};

/** Non-null viewer inside a route already behind requireAuth. */
export function viewerOf(c: { get: (k: 'viewer') => AppBindings['Variables']['viewer'] }) {
  const v = c.get('viewer');
  if (!v) throw new Error('viewerOf called outside requireAuth');
  return v;
}
