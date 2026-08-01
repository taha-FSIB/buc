import type { Viewer } from './lib/auth';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SESSION_SECRET: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  viewer: Viewer | null;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
