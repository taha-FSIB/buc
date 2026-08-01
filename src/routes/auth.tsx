import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppBindings } from '../types';
import { Layout, ErrorNotice } from '../views/layout';
import {
  SESSION_COOKIE, createSession, destroySession, verifyPassphrase,
  hashPassphrase, hashLoginCode, sessionCookie, clearedCookie,
  createLoginLink, peekLoginLink, consumeLoginLink, linksSentSince,
} from '../lib/auth';
import { emailConfigured, sendSignInLink, siteOrigin } from '../lib/mailer';

export const authRoutes = new Hono<AppBindings>();

/** Passphrases are checked for length only. Complexity rules defeat this audience. */
const MIN_PASSPHRASE = 8;

/**
 * At most this many links per member per hour. Anyone can type anyone else's
 * address into the sign-in form, so without this the form is a way to flood a
 * friend's inbox. Three is well above what an honest, confused member needs.
 */
const MAX_LINKS_PER_HOUR = 3;

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

/* -- Sign in: one field, one button ---------------------------------------- */
authRoutes.get('/signin', (c) =>
  c.html(
    <Layout title="Sign in" viewer={null} back={{ href: '/welcome', label: 'Back' }}>
      <h1>Sign in</h1>
      <p class="page-intro">
        We’ll email you a link to sign in — no password needed.
      </p>
      <form method="post" action="/signin">
        <div class="field">
          <label for="email">Your email</label>
          <span class="hint">The address you gave the reunion committee.</span>
          <input id="email" name="email" type="email" autocomplete="email"
                 inputmode="email" autocapitalize="off" spellcheck={false} required />
        </div>
        <button class="btn btn-block" type="submit">Email me a link</button>
      </form>
      <p style="margin-top:1.75rem">
        <a class="back" href="/signin/passphrase">I would rather use my passphrase</a>
      </p>
    </Layout>,
  ),
);

authRoutes.post('/signin', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();

  const member = await c.env.DB
    .prepare('SELECT id, full_name, preferred_name, status FROM members WHERE email = ?1')
    .bind(email)
    .first<{ id: string; full_name: string; preferred_name: string | null; status: string }>();

  // Everything below renders the same page whatever happened, so this form
  // never becomes a way to find out who is a member and who is not.
  if (member && member.status !== 'suspended') {
    const recent = await linksSentSince(c.env.DB, member.id, 3600);
    if (recent < MAX_LINKS_PER_HOUR) {
      const token = await createLoginLink(c.env.DB, member.id, 'signin');
      const url = `${siteOrigin(c.env, c.req.url)}/signin/link/${token}`;
      await sendSignInLink(
        c.env, email, member.preferred_name ?? member.full_name, url,
      );
    }
  }

  const canEmail = emailConfigured(c.env);

  return c.html(
    <Layout title="Check your email" viewer={null} back={{ href: '/signin', label: 'Back' }}>
      {canEmail ? (
        <>
          <h1>Check your email</h1>
          <p class="page-intro">
            If <strong>{email}</strong> belongs to one of us, a link is on its
            way. Open it and you are in — there is nothing to type.
          </p>
          <p class="page-intro">
            It can take a minute or two. If nothing arrives, have a look in
            your junk or spam folder.
          </p>
        </>
      ) : (
        <>
          <h1>Ask us for your link</h1>
          <p class="page-intro">
            We are not sending email from this site yet. Message the reunion
            committee on our WhatsApp group and one of us will send you a
            sign-in link straight away.
          </p>
        </>
      )}
      <p style="margin-top:1.75rem">
        <a class="back" href="/signin/passphrase">I have a passphrase — let me use that</a>
      </p>
      <p style="margin-top:0.75rem">
        <a class="back" href="/signin">Try a different email address</a>
      </p>
    </Layout>,
  );
});

/* -- Following the link ---------------------------------------------------- */
const LinkExpired = () => (
  <Layout title="Link no longer works" viewer={null}>
    <h1>That link has been used already</h1>
    <p class="page-intro">
      Sign-in links work once, and stop working after a day. Nothing is wrong
      with your account — you just need a fresh one.
    </p>
    <a class="btn btn-block" href="/signin">Send me a new link</a>
    <p style="margin-top:1.5rem">
      <a class="back" href="/signin/passphrase">Or sign in with a passphrase</a>
    </p>
  </Layout>
);

/**
 * A GET only shows the link's owner and a button. Mail scanners and "safe
 * links" services follow every URL in an email; if the GET spent the token,
 * members would routinely find their only way in already used up by their own
 * mail provider. The extra tap is worth it, and it reads as reassurance
 * ("Sign in as Kamala") rather than as friction.
 */
authRoutes.get('/signin/link/:token', async (c) => {
  const token = c.req.param('token');
  const target = await peekLoginLink(c.env.DB, token);
  if (!target) return c.html(<LinkExpired />, 410);

  const name = target.preferred_name ?? target.full_name;

  return c.html(
    <Layout title="Sign in" viewer={null}>
      <h1>Welcome back, {name}</h1>
      <p class="page-intro">One tap and you are in.</p>
      <form method="post" action={`/signin/link/${token}`}>
        <button class="btn btn-block" type="submit">Sign me in</button>
      </form>
      <p class="page-intro" style="margin-top:1.75rem">
        Not {name}? Then this link was not meant for you — please close this
        page and let us know on WhatsApp.
      </p>
    </Layout>,
  );
});

authRoutes.post('/signin/link/:token', async (c) => {
  const result = await consumeLoginLink(c.env.DB, c.req.param('token'));
  if (!result) return c.html(<LinkExpired />, 410);

  const token = await createSession(
    c.env.DB, result.memberId, c.req.header('user-agent') ?? null,
  );
  c.header('Set-Cookie', sessionCookie(token));

  // A first sign-in lands on the profile, where the batch will actually
  // recognise them. Everyone else goes straight to their own front page.
  return c.redirect(result.firstSignIn ? '/profile?welcome=1' : '/', 303);
});

/* -- Passphrase, for anyone whose email is unreliable ----------------------- */
const PassphraseForm = (props: { error?: boolean }) => (
  <Layout title="Sign in with a passphrase" viewer={null}
          back={{ href: '/signin', label: 'Back' }}>
    <h1>Sign in with a passphrase</h1>
    {props.error && (
      <ErrorNotice title="That did not work.">
        <p>Please check the email and passphrase, then try once more.</p>
      </ErrorNotice>
    )}
    <p class="page-intro">
      Only if you set one up. Most of us just use the emailed link.
    </p>
    <form method="post" action="/signin/passphrase">
      <div class="field">
        <label for="email">Your email</label>
        <input id="email" name="email" type="email" autocomplete="email"
               inputmode="email" autocapitalize="off" spellcheck={false} required />
      </div>
      <div class="field">
        <label for="passphrase">Your passphrase</label>
        <span class="hint">The secret words you chose yourself.</span>
        <input id="passphrase" name="passphrase" type="password"
               autocomplete="current-password" required />
      </div>
      <button class="btn btn-block" type="submit">Sign in</button>
    </form>
    <p style="margin-top:1.25rem">
      <a class="back" href="/signin">Email me a link instead</a>
    </p>
    <p style="margin-top:0.75rem">
      <a class="back" href="/forgot">I have forgotten my passphrase</a>
    </p>
  </Layout>
);

authRoutes.get('/signin/passphrase', (c) => c.html(<PassphraseForm />));

authRoutes.post('/signin/passphrase', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const passphrase = String(form.get('passphrase') ?? '');

  const member = await c.env.DB
    .prepare('SELECT id, passphrase_hash, status FROM members WHERE email = ?1')
    .bind(email)
    .first<{ id: string; passphrase_hash: string | null; status: string }>();

  const ok = member?.status === 'active'
    && (await verifyPassphrase(passphrase, member.passphrase_hash));

  // One message for every failure mode — never reveal which emails exist.
  if (!ok) return c.html(<PassphraseForm error />, 401);

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
    {props.error && (
      <p style="margin-bottom:1.5rem">
        <a class="back" href="/signin">If you have joined before, sign in instead</a>
      </p>
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

/**
 * The code is the credential, so there is nothing further to prove and no
 * passphrase to invent on the spot. Redeeming it signs the member in and takes
 * them to their profile.
 */
authRoutes.post('/join', async (c) => {
  const form = await c.req.formData();
  const code = String(form.get('code') ?? '').trim().toUpperCase();

  const member = await c.env.DB
    .prepare(`SELECT id, full_name, status FROM members WHERE invite_code = ?1`)
    .bind(code)
    .first<{ id: string; full_name: string; status: string }>();

  if (!member) {
    return c.html(
      <JoinForm code={code}
                error="Check each character and try again. A code stops working the moment it is used — ask on WhatsApp for a fresh one if you need it." />,
      404,
    );
  }

  if (member.status !== 'invited') {
    return c.html(
      <JoinForm code={code} error="That code has already been used. Try signing in instead." />,
      409,
    );
  }

  // Burn the code so a forwarded message cannot be redeemed a second time.
  await c.env.DB
    .prepare(
      `UPDATE members SET status = 'active', invite_code = NULL,
                          updated_at = unixepoch()
        WHERE id = ?1 AND status = 'invited'`,
    )
    .bind(member.id)
    .run();

  const token = await createSession(c.env.DB, member.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/profile?welcome=1', 303);
});

/* -- Forgotten passphrase (admin-assisted, no email provider needed) -------- */
authRoutes.get('/forgot', (c) =>
  c.html(
    <Layout title="Forgotten passphrase" viewer={null}
            back={{ href: '/signin/passphrase', label: 'Back' }}>
      <h1>Forgotten your passphrase?</h1>
      <p class="page-intro">
        No trouble at all — and you may not need it. Go back and ask us to
        <strong> email you a link</strong> instead; that always works and there
        is nothing to remember.
      </p>
      <a class="btn btn-block" href="/signin">Email me a link instead</a>

      <h2 class="section-title">Or set a new passphrase</h2>
      <p class="page-intro">
        Message the reunion committee on our WhatsApp group and ask for a reset
        code. One of them will send you a six-digit number. Once you have it,
        fill this in.
      </p>
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
      <Layout title="Forgotten passphrase" viewer={null}
              back={{ href: '/signin/passphrase', label: 'Back' }}>
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
    // A reset means the account may have been at risk — drop every other
    // session, and any sign-in link still sitting in an inbox.
    c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?1').bind(row.member_id),
    c.env.DB
      .prepare(
        `UPDATE login_links SET consumed_at = unixepoch()
          WHERE member_id = ?1 AND consumed_at IS NULL`,
      )
      .bind(row.member_id),
  ]);

  const token = await createSession(c.env.DB, row.member_id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token));
  return c.redirect('/', 303);
});
