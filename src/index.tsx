import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from './types';
import { Layout, VisibilityChip } from './views/layout';
import {
  SESSION_COOKIE, resolveSession, createSession, destroySession,
  verifyPassphrase, sessionCookie, clearedCookie,
} from './lib/auth';
import { feedForViewer, vaultForMember } from './lib/visibility';

const app = new Hono<AppBindings>();

/* -- Session middleware: every request knows who is looking ---------------- */
app.use('*', async (c, next) => {
  const viewer = await resolveSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  c.set('viewer', viewer);
  await next();
});

/** Guard for member-only pages. Callers redirect to sign-in, never a 403 wall. */
function requireViewer(c: Context<AppBindings>) {
  return c.get('viewer');
}

/* -- Static assets --------------------------------------------------------- */
app.get('/styles.css', (c) => c.env.ASSETS.fetch(c.req.raw));

/* -- Welcome (signed out) -------------------------------------------------- */
app.get('/welcome', (c) =>
  c.html(
    <Layout title="Welcome" viewer={null}>
      <h1>Welcome back, after 45 years.</h1>
      <p class="page-intro">
        This is the home of the pioneer batch of Batticaloa University College —
        a place to keep our photos, our stories and each other, all in one
        spot that will still be here years from now.
      </p>
      <a class="btn btn-block" href="/signin">Sign in</a>
      <p class="page-intro" style="margin-top:1.5rem">
        Not sure how to get in? Ask on our WhatsApp group and one of us will
        help you — nobody gets left behind.
      </p>
    </Layout>,
  ),
);

/* -- Sign in --------------------------------------------------------------- */
app.get('/signin', (c) =>
  c.html(
    <Layout title="Sign in" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
      <h1>Sign in</h1>
      <p class="page-intro">Use the email address you gave the reunion committee.</p>
      <form method="post" action="/signin">
        <div class="field">
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="passphrase">Your passphrase</label>
          <span class="hint">The secret words you chose when you first signed in.</span>
          <input id="passphrase" name="passphrase" type="password"
                 autocomplete="current-password" required />
        </div>
        <button class="btn btn-block" type="submit">Sign in</button>
      </form>
      <p style="margin-top:1.25rem">
        <a class="back" href="/signin/forgot">I have forgotten my passphrase</a>
      </p>
    </Layout>,
  ),
);

app.post('/signin', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const passphrase = String(form.get('passphrase') ?? '');

  const member = await c.env.DB
    .prepare(`SELECT id, passphrase_hash, status FROM members WHERE email = ?1`)
    .bind(email)
    .first<{ id: string; passphrase_hash: string | null; status: string }>();

  const ok = member?.status === 'active'
    && (await verifyPassphrase(passphrase, member.passphrase_hash));

  if (!ok) {
    // One message for every failure mode — never reveal which emails exist.
    return c.html(
      <Layout title="Sign in" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
        <div class="notice notice-error">
          <strong>That did not work.</strong>
          <p style="margin:0.35rem 0 0">
            Please check the email and passphrase and try once more.
          </p>
        </div>
        <a class="btn btn-block" href="/signin">Try again</a>
        <p style="margin-top:1.25rem">
          <a class="back" href="/signin/forgot">Send me a sign-in code instead</a>
        </p>
      </Layout>,
      401,
    );
  }

  const token = await createSession(c.env.DB, member!.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/', 303);
});

app.post('/signout', async (c) => {
  await destroySession(c.env.DB, getCookie(c, SESSION_COOKIE));
  c.header('Set-Cookie', clearedCookie());
  return c.redirect('/welcome', 303);
});

/* -- Home feed ------------------------------------------------------------- */
app.get('/', async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect('/welcome', 303);

  const { results } = await feedForViewer(c.env.DB, viewer.id);

  return c.html(
    <Layout title="Home" viewer={viewer} tab="home">
      <h1>Hello, {viewer.preferred_name ?? viewer.full_name}</h1>
      <p class="page-intro">Everything friends have shared with you.</p>

      {results.length === 0 ? (
        <div class="empty">
          <h2>Nothing here just yet</h2>
          <p>
            When friends share a photo or a story with you, it will appear on
            this page. You could be the one to start it off.
          </p>
          <a class="btn" href="/vault/new">Share a memory</a>
        </div>
      ) : (
        results.map((p) => (
          <a class="card" href={`/post/${p.id}`}>
            <h2>{p.title ?? 'Untitled'}</h2>
            <p class="card-meta">{p.author_name}</p>
            <p class="card-body">{(p.body ?? '').slice(0, 160)}</p>
          </a>
        ))
      )}
    </Layout>,
  );
});

/* -- My Vault -------------------------------------------------------------- */
app.get('/vault', async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect('/welcome', 303);

  const { results } = await vaultForMember(c.env.DB, viewer.id);

  return c.html(
    <Layout title="My Vault" viewer={viewer} tab="vault">
      <h1>My Vault</h1>
      <p class="page-intro">
        Everything here is private to you until you choose to share it.
      </p>
      <a class="btn btn-block" href="/vault/new">Add something new</a>

      {results.length === 0 ? (
        <div class="empty" style="margin-top:1.5rem">
          <h2>Your vault is empty</h2>
          <p>
            Put your first photo or story in — only you will see it until you
            decide otherwise.
          </p>
          <a class="btn" href="/vault/new">Add something</a>
        </div>
      ) : (
        <div style="margin-top:1.5rem">
          {results.map((p) => (
            <a class="card" href={`/post/${p.id}`}>
              <h2>{p.title ?? 'Untitled'}</h2>
              <p class="card-meta">
                <VisibilityChip kind={p.state === 'draft' ? 'private' : 'shared'} />
              </p>
            </a>
          ))}
        </div>
      )}
    </Layout>,
  );
});

export default app;
