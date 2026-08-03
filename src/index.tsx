import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from './types';
import { Layout, Panel } from './views/layout';
import { PlusIcon } from './views/icons';
import { SESSION_COOKIE, resolveSession } from './lib/auth';
import { feedForViewer } from './lib/visibility';

import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vault';
import { postRoutes } from './routes/posts';
import { groupRoutes } from './routes/groups';
import { souvenirRoutes } from './routes/souvenir';
import { hubRoutes } from './routes/hub';
import { adminRoutes } from './routes/admin';
import { publicRoutes, publicHome } from './routes/publicSite';
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
app.get('/motion.js', (c) => c.env.ASSETS.fetch(c.req.raw));

/* -- Home ------------------------------------------------------------------ */
// One address, two front doors. A visitor from outside gets the batch's public
// face; a member gets their own feed. The public site is what a link pasted
// into a WhatsApp group should open, so it lives at the root rather than
// behind /public.
app.get('/', async (c) => {
  const viewer = c.get('viewer');
  if (!viewer) return publicHome(c);

  const [{ results }, souvenir] = await Promise.all([
    feedForViewer(c.env.DB, viewer.id),
    c.env.DB
      .prepare(
        `SELECT status FROM flipbook_pages
          WHERE member_id = ?1 AND page_type = 'member'`,
      )
      .bind(viewer.id)
      .first<{ status: string }>(),
  ]);
  const mine = results.filter((p) => p.author_id === viewer.id).length;

  const sections = [
    { id: 'hello', key: 'Hello' },
    { id: 'reunion', key: 'Reunion' },
    { id: 'memories', key: 'Memories' },
  ];

  return c.html(
    <Layout title="Home" viewer={viewer} tab="home" sections={sections} timeline>
      <Panel id="hello">
        <p class="eyebrow">Pioneer batch · 1979</p>
        <h1 class="display-line">
          Hello,
          <span class="quiet">{viewer.preferred_name ?? viewer.full_name}</span>
        </h1>
        <p class="page-intro">
          Your memories, and everything friends have shared with you.
        </p>
        <a class="btn" href="/vault/new">
          <PlusIcon />
          Share a memory
        </a>
      </Panel>

      {/* The reunion gets a screen of its own until it has happened — it is the
          one thing on this site with a date attached. */}
      <Panel id="reunion">
        <p class="eyebrow">Friday and Saturday</p>
        <h2 class="display-line">28–29<span class="quiet">August</span></h2>
        <p class="page-intro">
          Eastern University, Vantharumoolai. Tell us if you are coming so the
          committee knows how many to cook for.
        </p>
        <a class="btn" href="/reunion">Our reunion</a>

        {/* The souvenir gave up its tab because sending in a page is a task you
            do once. This is where the reminder lives instead, and it disappears
            the moment they have done it. */}
        {!souvenir && (
          <ul class="ruled" style="margin-top:2rem">
            <li>
              <a class="row" href="/souvenir/mine">
                <span class="k">Souvenir</span>
                <p class="v">
                  <strong>Your page is not in yet</strong>
                  Every member gets one — a photo from back then, one from now,
                  and a few words.
                </p>
              </a>
            </li>
          </ul>
        )}
      </Panel>

      <Panel id="memories" list>
        <p class="eyebrow">Shared with you</p>
        <h2>Memories</h2>

        {results.length === 0 ? (
          <div class="empty">
            <h3>Nothing here just yet</h3>
            <p>
              When you add a memory, or a friend shares one with you, it will
              appear on this page. You could be the one to start it off.
            </p>
            <a class="btn" href="/vault/new">Share a memory</a>
          </div>
        ) : (
          <ul class="ruled">
            {results.map((p) => (
              <li>
                <a class="row" href={`/post/${p.id}`}>
                  <span class="k">
                    {p.author_id === viewer.id ? 'You' : p.author_name}
                  </span>
                  <p class="v">
                    <strong>{p.title || 'Untitled'}</strong>
                    {p.body ? p.body.slice(0, 160) : ''}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}

        {results.length > 0 && mine === results.length && (
          <p class="page-intro" style="margin-top:2rem">
            Only your own memories are here so far. Share one with a friend and
            theirs will start appearing too.
          </p>
        )}
      </Panel>
    </Layout>,
  );
});

/* -- Feature routers ------------------------------------------------------- */
app.route('/', authRoutes);
app.route('/', vaultRoutes);
app.route('/', postRoutes);
app.route('/', groupRoutes);
app.route('/', souvenirRoutes);
app.route('/', hubRoutes);
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
      <a class="btn btn-block" href="/">
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
      <a class="btn btn-block" href="/">Go back</a>
    </Layout>,
    500,
  );
});

export default app;
