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
| Auth | Email + passphrase (PBKDF2-SHA256) | No per-seat cost, no identity provider to explain |
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

Sign in as that admin, then use **Admin → Members** to invite everyone else.
Invitations produce a code like `BUC-4KPQ-8MTX` to send over WhatsApp.

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
npm run db:remote
npm run deploy
```

For push-to-deploy, connect the repo in the Cloudflare dashboard
(Workers & Pages → Create → Connect to Git) with build command
`npm run build:islands` and deploy command `npx wrangler deploy`. Every push
to `main` then ships.

**Migrations do not run automatically.** Run `npm run db:remote` before a
deploy that includes a new file in `migrations/`.

---

## No email provider — on purpose

Nothing here sends email. The batch already talks daily on WhatsApp, so:

- **Joining:** an admin creates the member and sends the invite code.
- **Forgotten passphrase:** the member asks on WhatsApp, an admin generates a
  six-digit reset code from **Admin → Members** and reads it out. It lasts a
  day and works once.

This removes a whole class of failure — no mail server, no spam folder a
72-year-old will never find. Add a provider later if it earns its place.

---

## Layout

```
migrations/          D1 schema, applied in order
src/
  index.tsx          Entry, session middleware, home feed, error pages
  lib/
    visibility.ts    THE privacy rule — every read goes through here
    auth.ts          PBKDF2 passphrases, hashed session tokens
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
