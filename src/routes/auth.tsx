import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import {
  SESSION_COOKIE, createSession, destroySession, verifyPassphrase,
  hashPassphrase, hashLoginCode, sessionCookie, clearedCookie,
} from '../lib/auth';

export const authRoutes = new Hono<AppBindings>();

/** Passphrases are checked for length only. Complexity rules defeat this audience. */
const MIN_PASSPHRASE = 8;

/* -- Welcome --------------------------------------------------------------- */
authRoutes.get('/welcome', (c) =>
  c.html(
    <Layout title="Welcome" viewer={null}>
      <h1>Welcome back, after 45 years.</h1>
      <p class="page-intro">
        This is the home of the pioneer batch of Batticaloa University College.
        A place to keep our photos, our stories and each other — all in one
        spot that will still be here years from now.
      </p>
      <a class="btn btn-block" href="/signin">Sign in</a>
      <p style="margin-top:1.5rem">
        <a class="btn btn-secondary btn-block" href="/join">
          I have an invitation code
        </a>
      </p>
      <p class="page-intro" style="margin-top:2rem">
        Stuck? Ask on our WhatsApp group and one of us will help you.
        Nobody gets left behind.
      </p>
    </Layout>,
  ),
);

/* -- Sign in --------------------------------------------------------------- */
authRoutes.get('/signin', (c) =>
  c.html(
    <Layout title="Sign in" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
      <h1>Sign in</h1>
      <p class="page-intro">Use the email address you gave the reunion committee.</p>
      <form method="post" action="/signin">
        <div class="field">
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" autocomplete="email"
                 inputmode="email" required />
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
        <a class="back" href="/forgot">I have forgotten my passphrase</a>
      </p>
    </Layout>,
  ),
);

authRoutes.post('/signin', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const passphrase = String(form.get('passphrase') ?? '');

  const member = await c.env.DB
    .prepare('SELECT id, passphrase_hash, status FROM members WHERE email = ?1')
    .bind(email)
    .first<{ id: string; passphrase_hash: string | null; status: string }>();

  const ok = member?.status === 'active'
    && (await verifyPassphrase(passphrase, member.passphrase_hash));

  if (!ok) {
    // One message for every failure mode — never reveal which emails exist.
    return c.html(
      <Layout title="Sign in" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
        <ErrorNotice title="That did not work.">
          <p>Please check the email and passphrase, then try once more.</p>
        </ErrorNotice>
        <a class="btn btn-block" href="/signin">Try again</a>
        <p style="margin-top:1.25rem">
          <a class="back" href="/forgot">I have forgotten my passphrase</a>
        </p>
      </Layout>,
      401,
    );
  }

  const token = await createSession(c.env.DB, member!.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/', 303);
});

authRoutes.post('/signout', async (c) => {
  await destroySession(c.env.DB, getCookie(c, SESSION_COOKIE));
  c.header('Set-Cookie', clearedCookie());
  return c.redirect('/welcome', 303);
});

/* -- Join with an invitation code ------------------------------------------ */
const JoinForm = (props: { error?: string; code?: string }) => (
  <Layout title="Join" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
    <h1>Join with your code</h1>
    <p class="page-intro">
      The reunion committee will have sent you a code that looks like
      <strong> BUC-4KPQ-8MTX</strong>. Type it in exactly as you received it.
    </p>
    {props.error && (
      <ErrorNotice title="We could not match that code.">
        <p>{props.error}</p>
      </ErrorNotice>
    )}
    <form method="post" action="/join">
      <div class="field">
        <label for="code">Your invitation code</label>
        <input id="code" name="code" type="text" autocapitalize="characters"
               autocomplete="off" spellcheck={false}
               value={props.code ?? ''} required />
      </div>
      <button class="btn btn-block" type="submit">Continue</button>
    </form>
  </Layout>
);

authRoutes.get('/join', (c) => c.html(<JoinForm />));

authRoutes.post('/join', async (c) => {
  const form = await c.req.formData();
  const code = String(form.get('code') ?? '').trim().toUpperCase();

  const member = await c.env.DB
    .prepare(
      `SELECT id, full_name, email, status FROM members WHERE invite_code = ?1`,
    )
    .bind(code)
    .first<{ id: string; full_name: string; email: string; status: string }>();

  if (!member) {
    return c.html(
      <JoinForm code={code} error="Please check each character and try again, or ask on WhatsApp for a fresh code." />,
      404,
    );
  }

  if (member.status === 'active') {
    return c.html(
      <JoinForm code={code} error="That code has already been used. Try signing in instead." />,
      409,
    );
  }

  return c.html(
    <Layout title="Choose a passphrase" viewer={null} back={{ href: '/join', label: 'Back' }}>
      <h1>Hello, {member.full_name}</h1>
      <p class="page-intro">
        One last step. Choose a passphrase you will remember — a short phrase
        works better than a complicated word. You will use your email and this
        passphrase to sign in from now on.
      </p>
      <form method="post" action="/join/finish">
        <input type="hidden" name="code" value={code} />
        <div class="field">
          <label for="email">Your email</label>
          <span class="hint">This is what we have on file. You can change it later.</span>
          <input id="email" name="email" type="email" value={member.email}
                 autocomplete="email" required />
        </div>
        <div class="field">
          <label for="passphrase">Choose a passphrase</label>
          <span class="hint">At least {MIN_PASSPHRASE} characters. For example: green mango tree</span>
          <input id="passphrase" name="passphrase" type="password"
                 autocomplete="new-password" minlength={MIN_PASSPHRASE} required />
        </div>
        <button class="btn btn-block" type="submit">Finish and sign in</button>
      </form>
    </Layout>,
  );
});

authRoutes.post('/join/finish', async (c) => {
  const form = await c.req.formData();
  const code = String(form.get('code') ?? '').trim().toUpperCase();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const passphrase = String(form.get('passphrase') ?? '');

  if (passphrase.length < MIN_PASSPHRASE) {
    return c.html(
      <JoinForm code={code} error={`The passphrase needs at least ${MIN_PASSPHRASE} characters.`} />,
      400,
    );
  }

  const member = await c.env.DB
    .prepare(`SELECT id, status FROM members WHERE invite_code = ?1`)
    .bind(code)
    .first<{ id: string; status: string }>();

  if (!member || member.status === 'active') {
    return c.html(<JoinForm code={code} error="That code is no longer usable." />, 409);
  }

  // Burn the invite code so it cannot be reused if it was forwarded onward.
  await c.env.DB
    .prepare(
      `UPDATE members
          SET passphrase_hash = ?1, email = ?2, status = 'active',
              invite_code = NULL, updated_at = unixepoch()
        WHERE id = ?3`,
    )
    .bind(await hashPassphrase(passphrase), email, member.id)
    .run();

  const token = await createSession(c.env.DB, member.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/', 303);
});

/* -- Forgotten passphrase (admin-assisted, no email provider needed) -------- */
authRoutes.get('/forgot', (c) =>
  c.html(
    <Layout title="Forgotten passphrase" viewer={null} back={{ href: '/signin', label: 'Back' }}>
      <h1>Forgotten your passphrase?</h1>
      <p class="page-intro">
        No trouble at all. Message the reunion committee on our WhatsApp group
        and ask for a reset code. One of them will send you a six-digit number.
      </p>
      <p class="page-intro">Once you have that number, come back here and enter it below.</p>
      <form method="post" action="/forgot">
        <div class="field">
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="code">The six-digit code</label>
          <input id="code" name="code" type="text" inputmode="numeric"
                 autocomplete="one-time-code" pattern="[0-9]*" required />
        </div>
        <div class="field">
          <label for="passphrase">Choose a new passphrase</label>
          <span class="hint">At least {MIN_PASSPHRASE} characters.</span>
          <input id="passphrase" name="passphrase" type="password"
                 autocomplete="new-password" minlength={MIN_PASSPHRASE} required />
        </div>
        <button class="btn btn-block" type="submit">Set my new passphrase</button>
      </form>
    </Layout>,
  ),
);

authRoutes.post('/forgot', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const code = String(form.get('code') ?? '').trim();
  const passphrase = String(form.get('passphrase') ?? '');

  const fail = (msg: string) =>
    c.html(
      <Layout title="Forgotten passphrase" viewer={null} back={{ href: '/signin', label: 'Back' }}>
        <ErrorNotice title="That code did not work.">
          <p>{msg}</p>
        </ErrorNotice>
        <a class="btn btn-block" href="/forgot">Try again</a>
      </Layout>,
      400,
    );

  if (passphrase.length < MIN_PASSPHRASE) {
    return fail(`The new passphrase needs at least ${MIN_PASSPHRASE} characters.`);
  }

  const row = await c.env.DB
    .prepare(
      `SELECT lc.id, lc.member_id
         FROM login_codes lc
         JOIN members m ON m.id = lc.member_id
        WHERE m.email = ?1
          AND lc.code_hash = ?2
          AND lc.purpose = 'reset'
          AND lc.consumed_at IS NULL
          AND lc.expires_at > unixepoch()
        LIMIT 1`,
    )
    .bind(email, await hashLoginCode(code))
    .first<{ id: string; member_id: string }>();

  if (!row) {
    return fail('It may have expired, or already been used. Ask on WhatsApp for a fresh one.');
  }

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE members SET passphrase_hash = ?1, status = 'active',
                            updated_at = unixepoch()
          WHERE id = ?2`,
      )
      .bind(await hashPassphrase(passphrase), row.member_id),
    c.env.DB
      .prepare('UPDATE login_codes SET consumed_at = unixepoch() WHERE id = ?1')
      .bind(row.id),
    // A reset means the account may have been at risk — drop every other session.
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?1').bind(row.member_id),
  ]);

  const token = await createSession(c.env.DB, row.member_id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/', 303);
});
