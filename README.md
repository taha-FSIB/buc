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
| Page turn | `page-flip` (StPageFlip) | ~10 KB, no dependencies, not hand-rolled |
| Database | Cloudflare D1 (SQLite) | Members, groups, posts, share grants, RSVPs |
| Files | Cloudflare R2 | Photos, audio, video, PDFs |
| Auth | Emailed sign-in link, passphrase as fallback | Nothing to remember; no identity provider to explain |
| Souvenir PDF | pdf-lib | Pure JS, runs inside the Worker |

### Where React is used, and where it is not

The site is server-rendered. Two screens use a React island because a plain
form is genuinely worse there:

- **The souvenir flipbook** (`src/islands/Flipbook.tsx`) — turning 60 pages
  via full page loads is slow and loses your place. The turn itself belongs to
  `page-flip`; the island only wires it to the server-rendered pages and to a
  pair of large Previous/Next buttons, because a page turn that answers only to
  a confident swipe is no use to an unsteady hand.
- **The share-with-a-friend picker** (`src/islands/MemberPicker.tsx`) — a
  native `<select>` with 60 names is painful on a phone with imprecise touch.

Both are progressive enhancements. The server renders working HTML first (every
souvenir page, a real `<select>`); the island takes it over once the bundle
lands. **With JavaScript off, both screens still work.** The whole bundle,
`page-flip` included, is 24 KB gzipped.

The islands are written as ordinary React and aliased to `preact/compat` at
build time: same code, ~12 KB gzipped instead of ~45 KB. Swap the alias in
`scripts/build-islands.mjs` if that trade ever stops being worth it — nothing
in `src/islands/` would need to change.

---

## Putting something in the vault

Composing asks what you are adding first — a memory, a photograph, a
recording, a video — and then shows a form built for that. It is one more tap
than a single do-everything form, and worth it: the phone opens the camera
roll rather than a file browser, the labels talk about the right thing, and
the medium is recorded because the member said so rather than because we
guessed from a MIME type an old Android browser invented.

**Who can see it is chosen on that same screen**, not left to a second step
somebody might never reach. Four options, with **Only me pre-selected** — the
safe answer is never the one you have to remember to pick:

| Choice | What happens |
|---|---|
| Only me | Nothing else. It sits in the vault. |
| Friends I choose | Saved, then straight to the picker — one name at a time, each confirmed |
| One of my groups | Group chosen inline; membership re-checked server-side before saving |
| Offer to the public pages | Creates the share row **and** a pending submission. Nothing is public yet |

Everything is changeable afterwards from the vault list or the post itself.

Upload ceilings are per kind — 25 MB a photograph, 50 MB a recording, 100 MB a
video. A 100 MB photograph is a mistake or an attack, and either way the
member should find out in the first second rather than after ten minutes on a
mobile connection. A file of the wrong kind is rejected **before** it reaches
R2, so a refused upload never leaves bytes behind.

---

## The reunion souvenir

Every member gets a page: a photo from back then, a photo from now, a name and
a few words. They can add extra pages too — a longer written piece, which
flows over as many sheets as it needs, or a single photograph printed large.
Everything is previewed with the **same component the book itself uses**, so
what a member approves is what everyone sees. Any edit re-enters moderation.

Admins get progress ("38 of 61 members have sent their page"), a list of who
still needs a nudge, print-order fields, and one button that produces the PDF.

**The souvenir is members-only.** Sending in a page is consent to appear in a
book handed round at a reunion — not consent to put your face, your town and
an account of your life on the open internet. The five public pages in the
brief do not include this one, and `/souvenir` redirects a visitor to sign in.
Souvenir photographs are served to signed-in members only.

### The viewer is HTML, not the PDF

The brief asked for a page-turn viewer over the generated PDF. Rendering a PDF
in a browser means pdf.js: ~350 KB gzipped, rasterising each page on the main
thread. On a 2015 Android handset over Sri Lankan mobile data that is a long
stare at nothing, to show content the site already has as HTML.

So the book turns the pages the site already renders — real text, selectable,
readable by a screen reader, photographs already lazy — using
[`page-flip`](https://github.com/Nodlik/StPageFlip) (~10 KB gzipped, no
dependencies) rather than anything hand-rolled. The server renders every page
into the container and the library is handed those exact elements, so there is
one copy of the markup. With JavaScript off the whole book reads as one long
scrolling page.

**The PDF is still the artefact that matters** — it is what goes to the
printer, and the phone's own viewer opens it perfectly well.

### Known limitation: Tamil and Sinhala do not print

The standard PDF fonts are WinAnsi-encoded. A Tamil or Sinhala blurb — which
on this site is entirely expected — cannot be drawn, and **used to throw**,
which would have taken down the whole book on the strength of one page.

It no longer throws. Every string is reduced to what the font can set, every
draw is wrapped as a backstop, and a page whose words cannot be printed says
so in English and points at the website. The build is capped at 200 pages and
survives corrupt photographs and missing R2 objects.

The real fix is embedding a Noto font with `@pdf-lib/fontkit`, which needs a
TTF; `@fontsource` publishes WOFF/WOFF2 only, so it needs a font file from
elsewhere or a WOFF→TTF step at build time. **Worth doing before the book goes
to the printer** if anyone writes their page in Tamil.

---

## Three languages, one interface

A member writes in English, Tamil or Sinhala, chosen when they post. English
can carry Tamil and Sinhala translations; Tamil or Sinhala can carry an
English one. What shows first is always what the member actually wrote — a
translation is supplementary, never a replacement.

The switch sits **beneath the words and never in the site navigation**, and
both the members' page and the public page render it from the same component
(`src/views/story.tsx`) so the two cannot drift apart.

**The interface itself is never translated.** The buttons say "English",
"Tamil", "Sinhala" — in English, including the Tamil one. That is the language
rule in CLAUDE.md, and it is right: a member who reads only Sinhala still
needs the chrome to keep its shape, and a control that renames itself is
exactly the kind of surprise this audience does not need. The words inside the
panel are in the language; everything around it is not.

Three details that are easy to get wrong:

- **Every language is rendered visible.** `transcripts.js` collapses to one
  once it has loaded. With JavaScript off, blocked or still arriving, the
  reader gets all of them stacked — worse looking, and infinitely better than
  a translation nobody can reach. The previous version hid all but the first
  server-side, which left a second translation unreachable without script.
- **They are toggle buttons, not an ARIA tablist.** `role="tab"` promises
  arrow-key navigation between tabs. Claiming a keyboard behaviour that is not
  implemented is worse than not claiming it, so these are plain buttons with
  `aria-pressed`.
- **Atkinson Hyperlegible has no Tamil or Sinhala glyphs.** Without Noto, a
  translation falls back to whatever the phone has, which on plenty of older
  Android handsets is a row of empty boxes. Both Noto families are in the same
  stylesheet request; `unicode-range` means a page with no Tamil or Sinhala on
  it downloads neither font file.

Order is fixed (`en`, `ta`, `si`) rather than whatever SQL returned, so the
buttons never move about between two pages showing the same story.

For a recording, the same screen writes out what is said — which for an audio
memory in Tamil with an English transcript is the whole point of the feature.

---

## The public site

Five pages, no session needed: **Home** (`/`), **Our Story** (`/our-story`),
**Stories & Memories** (`/stories`), **Reunion** (`/reunion`) and **Contact**
(`/contact`), with their own bottom navigation.

`/` is one address with two front doors — the batch's public face to a
visitor, a member's own feed once they sign in. A link pasted into a WhatsApp
group should open something worth reading, which is why the public site lives
at the root rather than behind `/public`. The old `/public` URLs 301 to
`/stories`, so anything already shared keeps working. `/reunion` works the
same way: the details to a visitor, the RSVP form to a member.

**Nothing reaches these pages without both facts.** Every query runs through
`publicFeed` or `getPost` with a null viewer, which resolve against
`PUBLIC_POST_IDS`: an explicit `public` share from the author **and**
`public_submissions.status = 'approved'`. The enforcement is in the SQL, not
in what the templates choose to render — a mistake in the markup cannot
publish anything. A rejection drops the post straight back to private, and
takes the moderator's own access with it.

The copy on Our Story and Contact is written in `src/routes/publicSite.tsx`.
There is no page editor: two pages that will settle down after the first week
are not worth building one for. **The committee will need someone to make
changes for them** — worth knowing before they ask.

### Contact

A Contact page that only prints an email address is a dead end for whoever
uses it — they cannot tell if anything arrived. Messages land in the database
and appear on the admin dashboard instead, so nothing depends on a mail server
being configured. Expect a relative of a classmate, or somebody from the
university.

Spam defences are a honeypot field and a limit of ten an hour per sender, on a
hashed IP that is never stored raw. Over the limit the page still says thank
you: telling a flooder they have been spotted only tells them to change
address. That does mean a genuine eleventh message would be lost, which is why
the limit is set where no real person will reach it.

---

## The approval queue

The admin dashboard opens on it, and it is the only thing on that screen with
a coloured border. Everything else there is housekeeping.

An admin can **approve** (it appears on Stories & Memories immediately),
**reject with a note** (the author sees the note on their own copy, so a "no"
is never silent), or **leave it** — pending is a valid outcome and the screen
says so rather than pressing for a decision.

Photographs, audio and video are rendered in the queue itself. Approving a
picture you have not looked at is not moderation, and before Phase 2 the
"Read the whole thing" link 404'd on the admin — see `getPostForModeration`.

---

## The Communication Hub

Four fixed channels — General Discussion, Projects & Give-Back, Casual Chat,
Photos. Anyone can start a thread; anyone can reply. It is the part of the site
meant to replace the WhatsApp group for anything worth keeping, and the only
thing here WhatsApp does better is notify you.

**A thread is an ordinary post with a channel on it.** That is the whole trick:
threads inherit the same read rule, the same media handling and the same
transcripts as everything else, and `visibility.ts` never had to learn what a
channel is. A reply has no visibility of its own — it is readable exactly when
its thread is, so every reply route asks about the *thread* and never about the
reply.

### A fourth audience

`post_shares` could address one person, one group, or the public. It had no way
to say "everyone in the batch", so this adds `audience_kind = 'batch'` —
requiring a table rebuild, since SQLite cannot alter a CHECK in place.

**It is not a back door to the public site.** A batch share reaches signed-in
members and stops; the public pages still demand their own share row and an
admin's approval. The harness asserts exactly that: a hub thread is readable by
every member, 404s for a visitor, and never appears in `/stories`.

Hub threads are kept out of the memories feed and the vault list. A hundred
one-line replies would bury the memories those pages exist for.

### No polling loop

The brief allowed refresh or polling. This refreshes: writing a reply reloads
the thread at the newest one, and there is a plain "look for new replies" link
at the bottom. For an audience that finds a moving screen unsettling, a page
that only changes when you ask it to is a feature, not a shortcut.

### What the tab bar gave up

Five tabs is a rule, not a target, so the Hub had to displace something. The
souvenir lost its tab: **sending in your page is a task you do once**, and that
belongs in a prompt, not in permanent furniture. The home page now carries a
souvenir card until a member has sent theirs, and the souvenir is one tap away
under More. Home, Talk, My Vault, Groups, More.

---

## Groups

A group is the members' own — **no site admin is involved in running one**.
Whoever starts it decides who joins, can remove a member, and can take a post
out of the group.

| Who can join | What happens |
|---|---|
| Anyone in the batch | Instant. They are in |
| People ask | Lands as `pending`; the owner lets them in |
| The owner adds people | Lands as `invited`; **they still have to accept** |

That last row matters. Being invited is not being in: an invitation grants no
read access at all until the member says yes. Nobody is put into a group
without agreeing to it, which for a family sub-group is the whole point.

**Taking a post out of a group deletes one share grant and nothing else.** The
memory stays in its author's vault and stays wherever else they shared it. An
owner looks after their own group; they do not get to delete somebody's
memory. An owner also cannot remove another owner — two people who started
something together should not be able to eject one another mid-argument. Both
actions are written to `audit_log`.

An **unlisted** group is invisible to anyone without a membership row: not in
the directory, and its page 404s. Its cover photograph is hidden too, since a
picture is as much of a leak as a name.

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
| The whole batch | `post_shares(audience_kind='batch')` — every signed-in member, and no further |
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

There is exactly one read that is not a member's own reach: an admin opening
something that has been **offered** to the public pages, so they can decide
about it. It needs the member's own `public` share row, so a private vault is
still closed to admins. It lives in `getPostForModeration` /
`mediaForModeration`, and nowhere else.

Every read path goes through `src/lib/visibility.ts`. **Do not hand-write
`SELECT … FROM posts` anywhere else** — the rule is only as strong as the
number of places it is written down, and that number should stay at one.

### Proving it

```bash
npm run dev                            # in one terminal
npm run check:visibility -- http://127.0.0.1:8787
```

`scripts/check-visibility.mjs` drives the running app — real sessions, real
uploads to R2, real routes — and asserts a full matrix of who can read what:
five viewers plus an anonymous visitor against private, friend-shared,
group-shared, pending, approved, rejected and draft posts, the media hanging
off them, group covers and invitations, and every public listing. It cleans up
after itself.

It exists because reading the SQL and nodding is not a test. It caught a real
bug the first time it ran: an admin got a 404 on the very post they were being
asked to approve, so the "Read the whole thing" link in the moderation queue
was dead.

Run it before every deploy. If a check fails, the privacy model is broken and
nothing else matters.

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
| `npm run check:visibility` | Asserts the privacy matrix against a running server |
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
  index.tsx          Entry, session middleware, the two front doors, errors
  lib/
    visibility.ts    THE privacy rule — every read goes through here
    auth.ts          Sign-in links, PBKDF2 passphrases, hashed session tokens
    mailer.ts        Optional email delivery; honest when unconfigured
    media.ts         R2 upload/delete, allowed types
    souvenirPdf.ts   Builds the souvenir PDF
    guard.ts         requireAuth / requireAdmin
  routes/            One file per area of the site
  views/             Layout, icons (inline SVG, never emoji), story + language switch
  islands/           The two React components
public/              styles.css, transcripts.js, islands.js (built)
design-system/       Design decisions, and what was rejected
scripts/             make-admin, build-islands, check-visibility
```

### A trap to avoid

Routers are all mounted at `/`. **Never use `router.use('*', middleware)`** in
one of them — it applies to the entire site, not just that router's paths, and
will silently put the public pages behind a login. Attach `requireAuth` /
`requireAdmin` per route instead. This has already happened once.

---

## Still to build

Deliberately left for after 28 August:

- Memorial page (§5) — the data model is cheap now, painful to retrofit
- Give-back board, milestones wall, batch map, archive timeline
- Machine-generated transcript drafts for members to correct

Transcripts currently have to be typed by the member. The schema already
distinguishes `source='machine'` from `'human'` and keeps unapproved machine
output hidden, so an automatic draft step can be added without a migration.
