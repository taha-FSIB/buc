/*
 * Motion for the deck.
 *
 * The page does not scroll — `body { overflow: hidden }` — so nothing here may
 * be driven by window scroll. Movement happens inside `main.deck`, which snaps
 * one full-screen panel at a time, and IntersectionObserver against that
 * scroller is what tells us which panel a member is looking at.
 *
 * Two rules, both learned the hard way on this project:
 *
 *   1. CSS NEVER hides content. The previous version put `main > *` at
 *      opacity 0 from an inline head script and relied on JavaScript to bring
 *      it back. In a background tab requestAnimationFrame does not run, so the
 *      whole site rendered blank — a bug that only surfaced because a window
 *      happened to be minimised during testing. Here the stylesheet has no
 *      hiding rule at all and this file only ever animates TRANSFORMS. If it
 *      fails to load, fails to parse, or throws on line one, every page is
 *      still completely readable. That is worth more than a fade.
 *
 *   2. Nothing animates out. Content that leaves when you move away is content
 *      somebody has to chase.
 *
 * ScrollTrigger is gone along with the window scroll it depended on, which
 * also takes a good chunk off the bundle.
 */

import { gsap } from 'gsap';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const deck = document.querySelector<HTMLElement>('main.deck');
const panels = deck ? Array.from(deck.querySelectorAll<HTMLElement>('.panel')) : [];

/* -- The section navbar: which keyword is lit, and where the bead sits ----- */

const keys = Array.from(document.querySelectorAll<HTMLAnchorElement>('.keys a'));
const bead = document.getElementById('bead');
const keyStrip = document.querySelector<HTMLElement>('.keys');

function markSection(index: number) {
  keys.forEach((a, i) => {
    if (i === index) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });

  if (bead && panels.length > 1) {
    // 6%..94% rather than 0..100, so the bead never half-hangs off the rule.
    bead.style.left = `${(index / (panels.length - 1)) * 88 + 6}%`;
  }

  // Keep the live keyword visible when the strip is wider than the phone.
  const active = keys[index];
  if (active && keyStrip && keyStrip.scrollWidth > keyStrip.clientWidth) {
    keyStrip.scrollTo({
      left: Math.max(0, active.offsetLeft - 16),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }
}

/* -- Jumping to a section -------------------------------------------------- */

for (const link of keys) {
  link.addEventListener('click', (e) => {
    const id = link.dataset.section;
    const target = id ? document.getElementById(id) : null;
    if (!target) return;                    // let the plain #hash do its job
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    // The hash still belongs in the URL so a section can be linked to and the
    // back button behaves. replaceState keeps it out of the history stack, so
    // "back" leaves the page rather than walking four sections first.
    history.replaceState(null, '', `#${id}`);
  });
}

/* -- Panel entrances ------------------------------------------------------- */

/*
 * Transform only. There is deliberately no opacity anywhere in here: a member
 * whose ticker never runs sees the content sitting exactly where it belongs,
 * having simply not moved into place.
 */
function enter(panel: HTMLElement) {
  if (reduced || panel.dataset.entered === '1') return;
  panel.dataset.entered = '1';

  const inner = panel.querySelector<HTMLElement>('.panel-inner');
  const blocks = inner ? Array.from(inner.children) : [];
  if (!blocks.length) return;

  gsap.from(blocks, {
    y: 18,
    duration: 0.5,
    ease: 'power2.out',
    // `amount` spreads the whole stagger over a fixed time, so a panel with
    // twelve rows does not take six times longer than one with two.
    stagger: { amount: Math.min(0.28, blocks.length * 0.05) },
    clearProps: 'transform',
  });
}

if (deck && panels.length) {
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const panel = entry.target as HTMLElement;
          markSection(panels.indexOf(panel));
          enter(panel);
        }
      },
      { root: deck, threshold: 0.55 },
    );
    for (const panel of panels) io.observe(panel);
  }

  markSection(0);
  enter(panels[0]);

  // Arriving on /reunion#programme should land on that panel, not the first.
  if (location.hash.length > 1) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

/* -- The sliding marker under the current bottom tab ----------------------- */

/*
 * The CSS inset shadow is the marker when this never runs, which is what
 * guarantees the current tab is not signalled by colour alone. `has-marker`
 * retires that shadow, and is added only once the bar has actually been
 * measured — so the two can never both be on screen, and neither can neither.
 */
const bar = document.querySelector<HTMLElement>('.tabbar');
const currentTab = bar?.querySelector<HTMLElement>('a[aria-current="page"]');

if (bar && currentTab) {
  const marker = document.createElement('span');
  marker.className = 'tab-marker';
  bar.appendChild(marker);
  bar.classList.add('has-marker');

  const place = () => {
    const barBox = bar.getBoundingClientRect();
    const tabBox = currentTab.getBoundingClientRect();
    gsap.set(marker, {
      x: tabBox.left - barBox.left,
      width: tabBox.width,
      opacity: 1,
    });
  };

  place();
  addEventListener('resize', place);
}

/* -- Press feedback -------------------------------------------------------- */

const PRESSABLE = '.btn, a.card, .tabbar a, .linklike, .card-choice, .keys a';

function pressed(e: Event, down: boolean) {
  const t = e.target;
  // `pointerleave` on the document reports the document itself, which has no
  // .closest — this threw on every mouse-out before the guard was added.
  if (!(t instanceof Element)) return;
  const el = t.closest<HTMLElement>(PRESSABLE);
  if (!el || reduced) return;
  gsap.to(el, { scale: down ? 0.985 : 1, duration: 0.12, ease: 'power2.out' });
}

document.addEventListener('pointerdown', (e) => pressed(e, true));
document.addEventListener('pointerup', (e) => pressed(e, false));
document.addEventListener('pointerleave', (e) => pressed(e, false));
