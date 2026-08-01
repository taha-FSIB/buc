import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from './types';
import { Layout } from './views/layout';
import { PlusIcon } from './views/icons';
import { SESSION_COOKIE, resolveSession } from './lib/auth';
import { feedForViewer } from './lib/visibility';

import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vault';
import { postRoutes } from './routes/posts';
import { groupRoutes } from './routes/groups';
import { souvenirRoutes } from './routes/souvenir';
import { adminRoutes } from './routes/admin';
import { publicRoutes } from './routes/publicSite';
import { moreRoutes } from './routes/more';
import { mediaRoutes } from './routes/media';
import { reunionRoutes } from './routes/reunion';
import { souvenirAdminRoutes } from './routes/souvenirAdmin';

const app = new Hono<AppBindings>();

/* -- Every request knows who is looking ------------------------------------ */
app.use('*', async (c, next) => {
  const viewer = await resolveSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  c.set('viewer', viewer);
  await next();
});

/* -- Static assets --------------------------------------------------------- */
app.get('/styles.css', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/transcripts.js', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/islands.js', (c) => c.env.ASSETS.fetch(c.req.raw));

/* -- Home feed ------------------------------------------------------------- */
app.get('/', async (c) => {
  const viewer = c.get('viewer');
  if (!viewer) return c.redirect('/welcome', 303);

  const { results } = await feedForViewer(c.env.DB, viewer.id);
  const mine = results.filter((p) => p.author_id === viewer.id).length;

  return c.html(
    <Layout title="Home" viewer={viewer} tab="home">
      <h1>Hello, {viewer.preferred_name ?? viewer.full_name}</h1>
      <p class="page-intro">Your memories, and everything friends have shared with you.</p>

      {/* The reunion sits above everything until it has happened — it is the
          one thing on this site with a date attached. */}
      <a class="card" href="/reunion"
         style="border-color:var(--accent);border-width:3px">
        <h2>Our reunion · 28-29 August</h2>
        <p class="card-meta">Eastern University · tell us if you are coming</p>
      </a>

      <a class="btn btn-block" href="/vault/new">
        <PlusIcon />
        Share a memory
      </a>

      <div style="margin-top:2rem">
        {results.length === 0 ? (
          <div class="empty">
            <h2>Nothing here just yet</h2>
            <p>
              When you add a memory, or a friend shares one with you, it will
              appear on this page. You could be the one to start it off.
            </p>
            <a class="btn" href="/vault/new">Share a memory</a>
          </div>
        ) : (
          results.map((p) => (
            <a class="card" href={`/post/${p.id}`}>
              <h2>{p.title || 'Untitled'}</h2>
              <p class="card-meta">
                {p.author_id === viewer.id ? 'You' : p.author_name}
              </p>
              {p.body && <p class="card-body">{p.body.slice(0, 160)}</p>}
            </a>
          ))
        )}
      </div>

      {results.length > 0 && mine === results.length && (
        <p class="page-intro" style="margin-top:2rem">
          Only your own memories are here so far. Share one with a friend and
          theirs will start appearing too.
        </p>
      )}
    </Layout>,
  );
});

/* -- Feature routers ------------------------------------------------------- */
app.route('/', authRoutes);
app.route('/', vaultRoutes);
app.route('/', postRoutes);
app.route('/', groupRoutes);
app.route('/', souvenirRoutes);
app.route('/', reunionRoutes);
// Mounted before adminRoutes so /admin/souvenir/compile wins over /admin/souvenir/:pageId.
app.route('/', souvenirAdminRoutes);
app.route('/', adminRoutes);
app.route('/', publicRoutes);
app.route('/', moreRoutes);
app.route('/', mediaRoutes);

/* -- No dead ends ---------------------------------------------------------- */
app.notFound((c) => {
  const viewer = c.get('viewer');
  return c.html(
    <Layout title="Not found" viewer={viewer ?? null}>
      <h1>We could not find that page</h1>
      <p class="page-intro">
        The link may be old, or it may be something that is not shared with
        you. Neither is anything to worry about.
      </p>
      <a class="btn btn-block" href={viewer ? '/' : '/welcome'}>
        {viewer ? 'Go to my home page' : 'Go to the start'}
      </a>
    </Layout>,
    404,
  );
});

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  const viewer = c.get('viewer');
  return c.html(
    <Layout title="Something went wrong" viewer={viewer ?? null}>
      <h1>Something went wrong at our end</h1>
      <p class="page-intro">
        Nothing you did caused this, and nothing of yours has been lost.
        Please try again in a moment.
      </p>
      <a class="btn btn-block" href={viewer ? '/' : '/welcome'}>Go back</a>
    </Layout>,
    500,
  );
});

export default app;
