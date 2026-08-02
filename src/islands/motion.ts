/**
 * Motion.
 *
 * Deliberately expressive: sections rise as you reach them, the headline
 * arrives a word at a time, photographs wipe open, the countdown counts, and
 * the tab bar's marker slides to where you are.
 *
 * The audience is still people in their sixties and seventies, so "expressive"
 * has limits that are not up for negotiation:
 *
 *   - Nothing is pinned and nothing is scrubbed. Hijacking the scroll — the
 *     one control somebody trusts — is where scroll animation stops being
 *     decoration and starts being an obstacle.
 *   - Every reveal plays once and stays played. Content that animates out
 *     again when you scroll back is content you have to chase.
 *   - Reduced motion is honoured everywhere, and it means NO motion, not less.
 *
 * FAILING SAFE
 * Content that starts invisible must never be able to stay invisible:
 *
 *   1. `html.anim` is added by an inline script in the head, so the CSS that
 *      hides anything only exists where JavaScript is already running.
 *   2. That script removes the class again after two seconds no matter what,
 *      so a bundle that is blocked or broken costs a pause, not the page.
 *   3. When this file does load it takes ownership immediately: it writes the
 *      hidden state as inline styles it controls and drops the class itself.
 *      Without that handover, step 2 would fire mid-scroll and flash every
 *      unrevealed section into view at once.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const main = document.querySelector('main');

/** Hand the page back from the CSS gate. Safe to call repeatedly. */
const reveal = () => root.classList.remove('anim');

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
 * Reduced motion: show everything, wire nothing.
 * ---------------------------------------------------------------------- */
if (still || !main) {
  if (main) gsap.set(Array.from(main.children), { opacity: 1, y: 0 });
  reveal();
}

if (!still && main) {
  const blocks = Array.from(main.children) as HTMLElement[];

  /* -----------------------------------------------------------------------
   * Take ownership from the CSS before anything else happens.
   * -------------------------------------------------------------------- */
  gsap.set(blocks, { opacity: 0, y: 28 });
  reveal();

  /* -----------------------------------------------------------------------
   * The ticker might never run.
   *
   * GSAP advances on requestAnimationFrame, and a browser does not call rAF
   * for a page it is not painting — a background tab, a minimised window, a
   * restored session. That matters here because the line above just made
   * every block invisible and handed the CSS failsafe back. Without this,
   * opening a link from WhatsApp in a new background tab and coming to it
   * later could mean arriving at a blank page.
   *
   * setTimeout keeps running when rAF does not, so it is the right tool to
   * ask the question with. If the ticker's frame counter has not moved by
   * then, nothing is animating and nothing is going to be: show everything.
   * If it has moved, this does nothing and the scroll reveals carry on.
   */
  const frameAtStart = gsap.ticker.frame;
  setTimeout(() => {
    if (gsap.ticker.frame !== frameAtStart) return;      // ticker is alive
    ScrollTrigger.getAll().forEach((t) => t.kill());
    gsap.set(blocks, { opacity: 1, y: 0, clearProps: 'transform,opacity' });
    gsap.set(main.querySelectorAll('img'), { clearProps: 'clipPath,transform' });
  }, 2500);

  /* A tab that wakes up later has stale trigger positions — it measured them
     against a viewport it was never painting. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ScrollTrigger.refresh();
  });

  /* -----------------------------------------------------------------------
   * The headline, a word at a time.
   *
   * Only split an h1 that is plain text — several carry a member's name in a
   * nested element, and rebuilding those would throw the markup away.
   * -------------------------------------------------------------------- */
  const h1 = main.querySelector('h1');
  let words: HTMLElement[] = [];

  if (h1 && h1.childNodes.length === 1 && h1.firstChild?.nodeType === Node.TEXT_NODE) {
    const text = h1.textContent ?? '';
    h1.textContent = '';
    words = text.split(/(\s+)/).map((chunk) => {
      const span = document.createElement('span');
      // Whitespace keeps its own span so the line can still break normally.
      span.textContent = chunk;
      if (chunk.trim()) span.className = 'word';
      h1.appendChild(span);
      return span;
    }).filter((s) => s.className === 'word');
  }

  /* -----------------------------------------------------------------------
   * Everything above the fold arrives on load; everything below waits until
   * you reach it.
   *
   * ScrollTrigger.batch groups whatever crosses the line at roughly the same
   * moment into one stagger, so a row of cards enters as a row rather than as
   * six unrelated events.
   * -------------------------------------------------------------------- */
  ScrollTrigger.batch(blocks, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 0.75,
        ease: 'power3.out',
        stagger: { amount: Math.min(0.4, batch.length * 0.09) },
        overwrite: true,
        clearProps: 'transform,opacity',
      });
    },
  });

  /* -- The headline's words, riding just ahead of its block -------------- */
  if (words.length) {
    gsap.set(words, { display: 'inline-block' });
    gsap.from(words, {
      yPercent: 110,
      opacity: 0,
      duration: 0.85,
      ease: 'power4.out',
      stagger: 0.055,
      delay: 0.1,
      clearProps: 'transform,opacity,display',
    });
  }

  /* -----------------------------------------------------------------------
   * Photographs wipe open rather than fading.
   *
   * Only ones big enough for it to read as intentional — running this on a
   * 56px avatar is a flicker, not a reveal.
   * -------------------------------------------------------------------- */
  const photos = (Array.from(main.querySelectorAll('img')) as HTMLImageElement[])
    .filter((img) => img.getBoundingClientRect().width > 140);

  if (photos.length) {
    gsap.set(photos, { clipPath: 'inset(0% 0% 100% 0%)', scale: 1.08 });
    ScrollTrigger.batch(photos, {
      start: 'top 90%',
      once: true,
      onEnter: (batch) => {
        gsap.to(batch, {
          clipPath: 'inset(0% 0% 0% 0%)',
          scale: 1,
          duration: 1.0,
          ease: 'power3.out',
          stagger: 0.12,
          overwrite: true,
          clearProps: 'clipPath,transform',
        });
      },
    });
  }

  /* -----------------------------------------------------------------------
   * The countdown counts.
   * -------------------------------------------------------------------- */
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tally'))) {
    const target = Number(el.dataset.countTo ?? el.textContent ?? 0);
    if (!Number.isFinite(target) || target <= 0) continue;
    const counter = { n: 0 };
    gsap.to(counter, {
      n: target,
      duration: Math.min(1.8, 0.6 + target * 0.02),
      ease: 'power2.out',
      delay: 0.35,
      // Zeroed in onStart, NOT before the tween is built. Setting it to "0" up
      // front meant that on any page whose ticker never ran — a background tab
      // — the countdown sat there reading "0 days to go" for a reunion that is
      // weeks away. A decoration that never plays should cost the animation,
      // never the fact.
      onStart: () => { el.textContent = '0'; },
      onUpdate: () => { el.textContent = String(Math.round(counter.n)); },
      onComplete: () => { el.textContent = String(target); },
    });
  }

  /* -----------------------------------------------------------------------
   * The tab bar's marker slides to the tab you are on.
   *
   * This is a multi-page site, so it happens once per load rather than
   * following taps. The CSS keeps its own inset-shadow marker for the no-JS
   * case; `has-marker` turns that off in favour of this one so there is never
   * a pair of them.
   * -------------------------------------------------------------------- */
  const bar = document.querySelector<HTMLElement>('.tabbar');
  const current = bar?.querySelector<HTMLElement>('a[aria-current="page"]');

  if (bar && current) {
    const marker = document.createElement('span');
    marker.className = 'tab-marker';
    marker.setAttribute('aria-hidden', 'true');
    bar.appendChild(marker);
    bar.classList.add('has-marker');

    const place = (animate: boolean) => {
      const x = current.offsetLeft;
      const w = current.offsetWidth;
      if (animate) {
        gsap.fromTo(marker,
          { x: x + w / 2, width: 0, opacity: 0 },
          { x, width: w, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.25 });
      } else {
        gsap.set(marker, { x, width: w, opacity: 1 });
      }
    };

    place(true);
    addEventListener('resize', () => place(false), { passive: true });
  }

  /* -----------------------------------------------------------------------
   * Tap feedback.
   *
   * The one piece here that does work rather than decoration: on a slow
   * connection the next page takes a second, and without an answer people tap
   * again. Delegated, so it costs one listener and covers anything added later.
   * -------------------------------------------------------------------- */
  const PRESSABLE = '.btn, a.card, .tabbar a, .linklike, .card-choice';
  const press = (e: Event, to: number) => {
    // e.target is not always an Element. `pointerleave` on the document fires
    // with the document itself as the target, and Document has no .closest —
    // which threw a TypeError on every pointer exit until this check existed.
    const t = e.target;
    if (!(t instanceof Element)) return;
    const el = t.closest(PRESSABLE);
    if (el) gsap.to(el, { scale: to, duration: 0.14, ease: 'power2.out', overwrite: 'auto' });
  };

  document.addEventListener('pointerdown', (e) => press(e, 0.97), { passive: true });
  for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
    document.addEventListener(evt, (e) => press(e, 1), { passive: true });
  }

  /* -----------------------------------------------------------------------
   * Photographs change the height of the page as they arrive, which moves
   * every trigger below them. Without this, sections further down fire at the
   * wrong scroll position on a slow connection — which is exactly the
   * connection this site is built for.
   * -------------------------------------------------------------------- */
  addEventListener('load', () => ScrollTrigger.refresh());
}

// Belt and braces, whatever happened above.
reveal();
