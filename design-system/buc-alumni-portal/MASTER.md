# Design System Master File — BUC Alumni Portal

> **LOGIC:** When building a specific page, first check `design-system/buc-alumni-portal/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.

**Project:** BUC Alumni Portal
**Generated:** 2026-08-01 with ui-ux-pro-max 2.11.0, then corrected by hand — see "Deviations".
**Category:** Membership/Community → **overridden to Accessible & Ethical**
**Design Dials:** Variance 2/10 (Centered/Minimal) | Motion 2/10 (Subtle) | Density 2/10 (Spacious)

**Audience:** ~40-80 members of one graduating batch, aged 60-75, scattered globally,
mostly on phones over uneven mobile data, largely not tech-native. This audience —
not a generic "community product" — drives every rule below.

---

## Deviations from the generated recommendation

The generator matched "alumni portal" to its *Membership/Community* row and returned
a growth-product landing page. Four outputs were rejected. Recorded here so nobody
silently re-applies them later.

### Rejected

| Generated | Reason |
|---|---|
| Pattern: *Community/Forum Landing* — member counts, "posts today", prominent Join CTA | A public acquisition funnel. This portal is invite-only and everyone already knows each other; there is nobody to convert. Worse, showing engagement metrics to ~50 people in their 70s turns a quiet fortnight into visible failure. Show **content, never counters**. |
| Style: *Exaggerated Minimalism* — `clamp(3rem,10vw,12rem)`, `font-weight:900`, `letter-spacing:-0.05em` | A fashion/agency aesthetic. Negative tracking at large sizes hurts legibility for ageing eyes — the opposite of the brief. |
| Palette: purple `#7C3AED` + green `#16A34A` on `#FAF5FF` | Generic SaaS-community colour with no warmth and no relationship to a 45-year reunion. Replaced with the verified-AAA warm palette below. |
| Motion: GSAP ScrollTrigger reveal | Pulls in a library and makes content appear late on scroll. For this audience stillness beats choreography. **No scroll-triggered animation anywhere.** |

### Adopted

| Generated | Reason |
|---|---|
| Typography: **Atkinson Hyperlegible** | Designed by the Braille Institute for low-vision readers; disambiguates `I/l/1` and `O/0`. The best call the generator made for this audience. |
| Style: **Accessible & Ethical** (surfaced via the Newsletter row) | WCAG AAA, 7:1 contrast, 16px+ text, 44px targets, low complexity, excellent performance. This *is* the brief. |
| Pre-delivery checklist | Caught a real bug — the first-pass bottom nav used Unicode glyphs as icons. |
| Pattern spirit: *Storytelling-Driven* (Magazine/Blog row) | A memory archive is closer to an editorial archive than to a forum. |

---

## Global Rules

### Colour palette — every pair verified ≥ 7:1 (AAA)

| Role | Hex | CSS Variable | Measured contrast |
|------|-----|--------------|-------------------|
| Background (paper) | `#FFFBEB` | `--paper` | — |
| Card | `#FFFFFF` | `--card` | — |
| Ink (body) | `#1C1917` | `--ink` | 16.86:1 on paper |
| Ink soft (meta) | `#57534E` | `--ink-soft` | 7.36:1 on paper |
| Primary (terracotta) | `#9A3412` | `--accent` | 7.05:1 on paper |
| Primary hover | `#7C2D12` | `--accent-dark` | 9.04:1 on paper |
| On primary | `#FFFFFF` | `--on-accent` | 7.31:1 on primary |
| Focus ring (teal) | `#115E59` | `--teal` | 7.31:1 on paper |
| Border | `#E7E0CF` | `--line` | non-text |

**Never** use `--ink-soft` below 16px, and never grey-on-grey. **No dark mode in v1** —
one well-tested light theme beats two half-tested ones before a 27-day deadline.

### Typography

- **Font:** Atkinson Hyperlegible, weights 400 + 700 only, `display=swap`, system fallback.
- **Tamil and Sinhala:** Noto Sans Tamil / Noto Sans Sinhala, selected by
  `:lang()`. Atkinson carries neither script — without these, a translation
  renders as tofu on a good number of older Android handsets. Line height goes
  to 1.8 for both; the glyphs are taller.
- **Base size 19px**, not 16px. The 16px floor is a minimum, not a target.
- Line height 1.6 body / 1.25 headings. Reading measure capped at ~34rem.
- Letter-spacing: **never negative.**

### Spacing (Density 2/10 — Spacious)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `0.25rem` | Tight gaps |
| `--space-sm` | `0.5rem` | Icon gaps |
| `--space-md` | `1.5rem` | Standard padding |
| `--space-lg` | `2rem` | Section padding |
| `--space-xl` | `3rem` | Large gaps |
| `--space-2xl` | `4rem` | Section margins |

### Touch & interaction

- Minimum target **52×52px** (above the 44px floor), ≥8px apart.
- Focus ring 3px solid `--teal`, 2px offset, never removed.
- `cursor: pointer` on everything clickable; 150-300ms transitions.
- No hover-only affordances — phones have no hover.

### Icons

- **Inline SVG only** (Lucide-style, 2px stroke, `currentColor`, 24px).
- Never emoji or Unicode glyphs — they render as tofu or full-colour emoji
  depending on the phone.
- Always paired with a visible text label. Never icon-only.

### Navigation

- Bottom tab bar, **max 5 items**, fixed, respecting `env(safe-area-inset-bottom)`.
- `main` carries bottom padding ≥ bar height so it never overlaps content.
- Every non-root screen has a visible **Back** link — no dead ends.
- Real URLs and real page loads so the browser Back button always works.

### Forms

- Visible `<label>` on every input. Never placeholder-as-label.
- Helper text above the input, not after it.
- Errors next to the field **and** in a `role="alert"` region.
- Submit buttons show a pending state; never a dead click.
- Inputs ≥16px so iOS does not zoom on focus.
- A checkbox and its label are one 52px row (`.check`), the whole row clickable.
  A 20px box is not a target to give an unsteady hand.
- **Sign-in asks for one thing.** Email, one button, a link in return. Anything
  a member has to remember is a fallback, placed below and named as one.
- **Ask what, then show the form for it.** A chooser ahead of a long form beats
  one form that does everything: the phone opens the right picker and every
  label can talk about the actual thing. One extra tap is cheap; a form full of
  fields that do not apply is not.
- A set of related choices is a real `<fieldset>`/`<legend>` (`.choices`), so
  the question is announced before the options rather than four loose radios.
- **The safe option is the pre-selected one.** Never make privacy the thing a
  member has to remember to choose.

### ARIA

- Claim only what is implemented. `role="tab"` promises arrow-key navigation
  between tabs; if that is not built, use toggle buttons with `aria-pressed`
  instead. A promise the keyboard does not keep is worse than no promise.
- Content in Tamil or Sinhala carries `lang` on its container, so a screen
  reader switches voice instead of reading Tamil as though it were English.

### Photographs of people

- Round, `object-fit: cover`, explicit `width`/`height` so the row does not
  reflow as images land.
- No photograph yet → the member's initial on a warm ground, never an empty
  grey circle. A placeholder that looks broken reads as "the site is broken".

### Motion

- State transitions only (150-300ms). No scroll reveals, no parallax.
- `prefers-reduced-motion` honoured globally.

### Performance

- Server-rendered HTML by default. **React islands only where a plain form is
  genuinely worse**: the souvenir flipbook viewer and the share-with-a-friend
  picker. Both progressively enhance server-rendered markup that already
  works, and both ship via `preact/compat` (~12 KB gzipped, not ~45 KB).
  Adding a third island needs a reason written down here.
- Images lazy-loaded with explicit `width`/`height` to hold CLS < 0.1.
- Photos from R2 as WebP where possible, always with `alt` text.

---

## Pre-delivery checklist

- [ ] No emoji/Unicode glyphs as icons (inline SVG only)
- [ ] All text ≥ 4.5:1; body and meta ≥ 7:1
- [ ] Focus visible (3px) on every interactive element
- [ ] Touch targets ≥ 52px, ≥ 8px apart
- [ ] Every input has an associated visible label
- [ ] Errors announced via `role="alert"`
- [ ] `prefers-reduced-motion` respected
- [ ] Tested at 375px, 768px, 1024px — no horizontal scroll
- [ ] Every screen has a Back affordance or a clear next step
