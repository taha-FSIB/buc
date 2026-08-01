import type { Viewer } from './lib/auth';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SESSION_SECRET: string;
  /** Absolute origin used to build sign-in links. See lib/mailer.ts. */
  SITE_URL?: string;
  /** Both must be set for any email to be sent; otherwise links are copied by hand. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  viewer: Viewer | null;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
