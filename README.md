# BUC Alumni Portal

A private home for the pioneer batch of Batticaloa University College (now
Eastern University), reconnecting 45+ years after graduation.

Members are in their 60s and 70s, scattered across several countries, and
mostly on phones over uneven mobile data. Every technical decision below
follows from that.

---

## How it is put together

| Piece | Choice | Why |
|---|---|---|
| Hosting | Cloudflare Workers | One deploy target, no servers to patch |
| Pages | Server-rendered HTML (Hono JSX) | ~15 KB per page. Nothing to hydrate, nothing to wait for |
| Interactivity | React islands (Preact/compat), 2 of them | Only where it earns its keep — see below |
| Database | Cloudflare D1 (SQLite) | Members, groups, posts, share grants, RSVPs |
| Files | Cloudflare R2 | Photos, audio, video, PDFs |
| Auth | Emailed sign-in link, passphrase as fallback | Nothing to remember; no identity provider to explain |
| Souvenir PDF | pdf-lib | Pure JS, runs inside the Worker |

### Where React is used, and where it is not

The site is server-rendered. Two screens use a React island because a plain
form is genuinely worse there:

- **The souvenir flipbook** (`src/islands/Flipbook.tsx`) — turning 60 pages
  via full page loads is slow and loses your place.
- **The share-with-a-friend picker** (`src/islands/MemberPicker.tsx`) — a
  native `<select>` with 60 names is painful on a phone with imprecise touch.

Both are progressive enhancements. The server renders working HTML first (real
prev/next links, a real `<select>`); the island replaces it once the bundle
lands. **With JavaScript off, both screens still work.**

The islands are written as ordinary React and aliased to `preact/compat` at
build time: same code, ~12 KB gzipped instead of ~45 KB. Swap the alias in
`scripts/build-islands.mjs` if that trade ever stops being worth it — nothing
in `src/islands/` would need to change.

---

## Signing in

There is no public signup. An admin adds a member, and that is the only way in.

The normal path has no password in it at all:

1. The member types their email address. One field, one button.
2. They get a link. Opening it shows **their own name** and a single button.
3. Tapping it signs them in for 60 days.

Three details are deliberate:

- **The GET does not spend the token.** Mail scanners and corporate "safe
  links" services follow every URL in an email. If the first request consumed
  the link, members would routinely find their only way in already used up by
  their own mail provider. The confirmation screen also reads as reassurance
  — *Welcome back, Kamala* — rather than as friction.
- **Links last a day, not fifteen minutes.** This batch checks email once a
  day, and an admin may forward a link over WhatsApp hours later. A short
  expiry would not buy security here; it would produce a wall of "this link
  has expired" and a batch of 70-year-olds concluding the site is broken. The
  safety comes from single use and a hashed token, not from the clock.
- **Issuing a link retires the previous one**, and a passphrase reset retires
  every outstanding link.

A **passphrase is optional**, offered on the profile page for anyone whose
email is unreliable. It is a fallback, never the front door.

Every sign-in form answers identically whether or not the address belongs to a
member, so it can never be used to find out who is in the batch. Members are
limited to three links an hour, so nobody can use the form to flood a friend's
inbox.

### Email is optional

Set `MAIL_FROM` and the `RESEND_API_KEY` secret and links are emailed. Leave
them unset and **nothing pretends to have been sent**: the screens say "ask us
on WhatsApp", and every link an admin can generate is shown on screen at
`/admin/members` to be copied into a chat. That is a supported way to run this
site, and given where this batch actually talks, possibly the better one.

Swapping Resend for another provider means changing `deliver()` in
`src/lib/mailer.ts` and nothing else.

---

## The privacy model

This is the part to understand before changing anything.

**A post is readable only by its author, unless a row in `post_shares` says
otherwise.** There is no `visibility` column to flip. Reach is additive and
explicit:

| Audience | What is required |
|---|---|
| One member | `post_shares(audience_kind='member', audience_id=…)` |
| A group | `post_shares(audience_kind='group', audience_id=…)` + active membership |
| Everyone | `post_shares(audience_kind='public')` **and** `public_submissions.status='approved'` |

Public reach therefore needs **two independent facts**: the member asked for
it, and an admin approved it. Neither alone is enough.

Consequences worth knowing:

- **Admins cannot read private vaults.** A moderator sees a post only once it
  has been offered to the public — which is exactly when consent exists.
- **A draft stays private even if shared.** State and reach are separate checks.
- **Media inherits its post's visibility.** No public bucket, no signed URLs;
  `/media/:id` re-checks on every request, so a link forwarded into the wrong
  WhatsApp group grants nothing.

Every read path goes through `src/lib/visibility.ts`. **Do not hand-write
`SELECT … FROM posts` anywhere else** — the rule is only as strong as the
number of places it is written down, and that number should stay at one.

---

## Local development

```bash
npm install
npx wrangler d1 create buc_alumni     # paste the id into wrangler.toml
npx wrangler r2 bucket create buc-alumni-media

npm run db:local                       # apply migrations
node scripts/make-admin.mjs "Your Name" you@example.com "a passphrase"
npm run dev                            # http://127.0.0.1:8787
```

`make-admin.mjs` sets a passphrase, because the first admin has nobody to send
them a link. Sign in at `/signin/passphrase`, then use **Admin → Members** to
add everyone else. Each one produces a sign-in link and a code like
`BUC-4KPQ-8MTX`, both shown on screen to send over WhatsApp.

| Command | What it does |
|---|---|
| `npm run dev` | Builds islands, starts wrangler dev |
| `npm run typecheck` | Typechecks the Worker and the islands |
| `npm run build:islands` | Bundles `public/islands.js` |
| `npm run db:local` / `db:remote` | Applies migrations |
| `npm run db:reset` | Wipes and rebuilds the local database |

---

## Deploying

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY   # optional — see "Email is optional"
npm run db:remote
npm run deploy
```

**Set `SITE_URL` in `wrangler.toml` before going live.** Sign-in links fall
back to the request's own origin when it is empty, which is convenient in
development but means a forged `Host` header could have a real member emailed
a real token pointing at somebody else's site.

For push-to-deploy, connect the repo in the Cloudflare dashboard
(Workers & Pages → Create → Connect to Git) with build command
`npm run build:islands` and deploy command `npx wrangler deploy`. Every push
to `main` then ships.

**Migrations do not run automatically.** Run `npm run db:remote` before a
deploy that includes a new file in `migrations/`.

---

## When somebody is locked out

Every route out of trouble goes through WhatsApp, because that is where this
batch actually is. From **Admin → Members**, an admin can:

- **Make a sign-in link** — works once, lasts a day, shown on screen to paste
  into a chat. This is the answer to almost every problem.
- **Make a passphrase reset code** — six digits, read aloud over the phone.
  Lasts a day, works once, and drops all of that member's other sessions.

No mail server has to be working for either of these. That was the point.

---

## Layout

```
migrations/          D1 schema, applied in order
src/
  index.tsx          Entry, session middleware, home feed, error pages
  lib/
    visibility.ts    THE privacy rule — every read goes through here
    auth.ts          Sign-in links, PBKDF2 passphrases, hashed session tokens
    mailer.ts        Optional email delivery; honest when unconfigured
    media.ts         R2 upload/delete, allowed types
    souvenirPdf.ts   Builds the souvenir PDF
    guard.ts         requireAuth / requireAdmin
  routes/            One file per area of the site
  views/             Layout, icons (inline SVG, never emoji)
  islands/           The two React components
public/              styles.css, transcripts.js, islands.js (built)
design-system/       Design decisions, and what was rejected
scripts/             make-admin, build-islands
```

### A trap to avoid

Routers are all mounted at `/`. **Never use `router.use('*', middleware)`** in
one of them — it applies to the entire site, not just that router's paths, and
will silently put the public pages behind a login. Attach `requireAuth` /
`requireAdmin` per route instead. This has already happened once.

---

## Still to build

Deliberately left for after 28 August:

- Communication hub (§4.7) — channels and threaded replies
- Memorial page (§5) — the data model is cheap now, painful to retrofit
- Give-back board, milestones wall, batch map, archive timeline
- Machine-generated transcript drafts for members to correct

Transcripts currently have to be typed by the member. The schema already
distinguishes `source='machine'` from `'human'` and keeps unapproved machine
output hidden, so an automatic draft step can be added without a migration.
