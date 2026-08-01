import { useState, useEffect, useRef, useCallback } from 'react';
import { PageFlip } from 'page-flip';

/**
 * The souvenir page-turn viewer.
 *
 * The turning itself is StPageFlip (`page-flip`, ~10 KB gzipped, no
 * dependencies) rather than anything hand-rolled — an earlier version of this
 * file was a custom renderer, and a page turn is not a wheel worth reinventing.
 *
 * WHAT THIS SHOWS, AND WHY IT IS NOT THE PDF
 * The brief asked for a viewer over the generated PDF. Rendering a PDF in the
 * browser means pdf.js: roughly 350 KB gzipped, rasterising each page on the
 * main thread. On a 2015 Android handset over Sri Lankan mobile data — which
 * is what a good number of the batch are carrying — that is a long stare at
 * nothing, to show content the site already has as HTML. So the book turns the
 * same pages the site already renders: real text, selectable, readable by a
 * screen reader, photographs already lazy. The PDF is still generated and
 * still downloadable; the phone's own viewer opens it, and that is the copy
 * that goes to the printer.
 *
 * The server renders every page inside the container this mounts into, and
 * PageFlip is handed those exact elements. One copy of the markup, no way for
 * the two to disagree. With JavaScript off the whole book reads as one long
 * scrolling page.
 */

const A5_RATIO = 595 / 420;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Flipbook(
  { container, titles, start = 0 }: { container: HTMLElement; titles: string[]; start?: number },
) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), titles.length - 1));
  const book = useRef<PageFlip | null>(null);

  useEffect(() => {
    const sheets = container.querySelectorAll<HTMLElement>('.flip-sheet');
    if (!sheets.length) return;

    const width = Math.min(container.clientWidth || 360, 420);
    const height = Math.min(Math.round(width * A5_RATIO), Math.round(innerHeight * 0.72));

    let flip: PageFlip;
    try {
      flip = new PageFlip(container, {
        width,
        height,
        size: 'stretch',
        minWidth: 260,
        maxWidth: 520,
        minHeight: 340,
        maxHeight: 780,
        maxShadowOpacity: 0.3,
        showCover: false,
        // One page at a time on a phone; a spread only where there is room.
        usePortrait: true,
        mobileScrollSupport: true,
        flippingTime: reducedMotion() ? 0 : 600,
        useMouseEvents: true,
      });
      flip.loadFromHTML(sheets);
    } catch {
      // If the library cannot start, the server-rendered pages are still
      // sitting there, readable. Leave them alone.
      return;
    }

    book.current = flip;
    if (start > 0 && start < titles.length) {
      try { flip.turnToPage(start); } catch { /* out of range */ }
    }

    flip.on('flip', (e: { data: number }) => {
      const at = Number(e.data) || 0;
      setIndex(at);
      // Keep the URL honest so Back and a bookmark both behave.
      history.replaceState(null, '', at === 0 ? '/souvenir' : `/souvenir?page=${at}`);
    });

    const onResize = () => { try { flip.update(); } catch { /* mid-teardown */ } };
    addEventListener('resize', onResize);

    return () => {
      removeEventListener('resize', onResize);
      try { flip.destroy(); } catch { /* already gone */ }
      book.current = null;
    };
    // Mount once. PageFlip owns those elements afterwards and must not be torn
    // down and rebuilt every time the page number changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback((delta: number) => {
    if (!book.current) return;
    if (delta > 0) book.current.flipNext();
    else book.current.flipPrev();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [go]);

  // Big buttons as well as swipe: a page turn that only responds to a
  // confident drag is no use to an unsteady hand.
  return (
    <div class="flip-controls">
      <p class="page-intro" aria-hidden="true">
        Page {index + 1} of {titles.length}
      </p>

      {/* Announces the turn without stealing focus from the buttons. */}
      <div class="visually-hidden" aria-live="polite">
        Page {index + 1} of {titles.length}: {titles[index] ?? ''}
      </div>

      <nav class="flip-nav" aria-label="Souvenir pages">
        <button class="btn btn-secondary" type="button"
                onClick={() => go(-1)} disabled={index === 0}>
          Previous page
        </button>
        <button class="btn" type="button"
                onClick={() => go(1)} disabled={index >= titles.length - 1}>
          Next page
        </button>
      </nav>
    </div>
  );
}
