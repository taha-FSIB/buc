PROJECT: BUC Alumni Portal

We are the pioneer batch of Batticaloa University College (BUC), Sri Lanka —
now Eastern University — reconnecting 45+ years after graduation. Most of us
still communicate over WhatsApp, are scattered globally, and some now have
grandchildren. This project is a web platform to:

1. Keep the batch connected long-term, beyond WhatsApp's limitations.
2. Preserve our shared history — old photos, stories, memories — in one
   permanent place.
3. Give members a private space (a "vault") for their own content, with full
   control over who sees it.
4. Support small groups within the batch (interest groups, project groups,
   family sub-groups) that members can join or create themselves.
5. Offer public-facing pages where anything shared is moderated by an admin
   before going live — the batch's public face to the wider community.
6. Publish stories/memories as text, audio, or video, in English, Tamil, or
   Sinhala, with transcripts making English content available in Tamil and
   Sinhala.
7. Host a digital flipbook (reunion souvenir) — one page per member ("then
   and now"), plus optional extra pages for articles/photos members submit.
8. Launch in time for our reunion, August 28-29, at Eastern University.

TONE AND DESIGN PRIORITY: Simplicity above all else. Many members are in
their 60s-70s and not tech-native. The emotional register is warm, familial,
nostalgic — this is a reunion of lifelong friends, not a corporate product.
Every screen should feel calm, uncluttered, and easy for a first-time,
non-technical user to navigate on a phone.

LANGUAGE RULE: All navigation, menus, buttons, and system UI text are in
English only, always. Only user-submitted content (stories, articles,
videos) gets bilingual transcripts: English content gets Tamil + Sinhala
transcripts; Tamil or Sinhala content gets an English transcript. Transcripts
are supplementary, shown as tabs/toggles under the content, not separate
navigation.

STACK: Cloudflare Pages (frontend hosting) + Cloudflare Workers (API/backend
logic) + Cloudflare D1 (SQLite — relational data: users, groups, posts,
permissions) + Cloudflare R2 (object storage — photos, audio, video, PDFs)
+ Cloudflare Access or a lightweight custom auth (email/passphrase — see
§2). Version control in Git from day one; deploy via Cloudflare Pages'
Git integration so every push to main auto-deploys.

NON-NEGOTIABLE PRINCIPLES:
- Privacy by default. Nothing a member posts is visible to anyone else
  unless the member explicitly shares it (specific person, specific group,
  or "public" — and "public" always routes through admin approval first).
- No public content goes live without admin approval. No exceptions.
- Members have zero content restrictions on private/group posts — they can
  post anything within their own Vault or groups without moderation.
- Mobile-first. Assume most members will use this on a phone.
- Big touch targets, high contrast, minimal jargon, no dead ends (always a
  clear way back or a clear next step).
