import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * The souvenir page-turn viewer.
 *
 * This is one of only two places React earns its keep: turning 60 pages via
 * full page loads over Sri Lankan mobile data is slow and loses your place.
 * Everything the island needs is already in the page as JSON, so no network
 * request happens while turning.
 *
 * The server renders page 1 as plain HTML underneath this. If the bundle
 * never arrives, the Previous/Next links still work — the souvenir is
 * readable with JavaScript switched off.
 */

export interface Page {
  id: string;
  heading: string | null;
  blurb: string | null;
  memberName: string | null;
  thenId: string | null;
  nowId: string | null;
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Flipbook({ pages, start = 0 }: { pages: Page[]; start?: number }) {
  const [index, setIndex] = useState(Math.min(start, pages.length - 1));
  const [turning, setTurning] = useState<'none' | 'next' | 'prev'>('none');
  const touchX = useRef<number | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = current + delta;
        if (next < 0 || next >= pages.length) return current;
        if (!prefersReducedMotion()) {
          setTurning(delta > 0 ? 'next' : 'prev');
          setTimeout(() => setTurning('none'), 260);
        }
        // Keep the URL honest so Back and bookmarks behave.
        history.replaceState(null, '', next === 0 ? '/souvenir' : `/souvenir?page=${next}`);
        return next;
      });
    },
    [pages.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [go]);

  if (pages.length === 0) return null;
  const page = pages[index];
  const name = page.heading || page.memberName || 'Our batch';

  return (
    <div>
      <p class="page-intro" aria-hidden="true">
        Page {index + 1} of {pages.length}
      </p>

      {/* Announces the page change to a screen reader without stealing focus. */}
      <div ref={liveRef} class="visually-hidden" aria-live="polite">
        Page {index + 1} of {pages.length}: {name}
      </div>

      <article
        class={`flip-page flip-turn-${turning}`}
        onTouchStart={(e: TouchEvent) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e: TouchEvent) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <h2>{name}</h2>
        {(page.thenId || page.nowId) && (
          <div class="then-now">
            <figure>
              {page.thenId && (
                <img src={`/media/${page.thenId}`} alt={`${name}, back then`} loading="lazy" />
              )}
              <figcaption>Then</figcaption>
            </figure>
            <figure>
              {page.nowId && (
                <img src={`/media/${page.nowId}`} alt={`${name}, now`} loading="lazy" />
              )}
              <figcaption>Now</figcaption>
            </figure>
          </div>
        )}
        {page.blurb?.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
      </article>

      <nav class="flip-nav" aria-label="Souvenir pages">
        <button class="btn btn-secondary" type="button"
                onClick={() => go(-1)} disabled={index === 0}>
          Previous page
        </button>
        <button class="btn" type="button"
                onClick={() => go(1)} disabled={index === pages.length - 1}>
          Next page
        </button>
      </nav>
    </div>
  );
}
