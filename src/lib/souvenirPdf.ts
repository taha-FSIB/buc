/**
 * Builds the reunion souvenir as a single PDF.
 *
 * pdf-lib is pure JavaScript, so it runs inside a Worker with no native
 * dependency. Three constraints worth knowing:
 *
 *  - The standard PDF fonts are WinAnsi-encoded. Anything outside that — a
 *    Tamil or Sinhala blurb, which on this site is entirely expected —
 *    makes drawText THROW, and one such page would take the whole book down.
 *    Every string therefore goes through safeText first, and every draw is
 *    wrapped as a backstop. A page that cannot be printed says so in English
 *    and points at the website. See "Known limitation" in the README: the real
 *    fix is embedding a Noto font, which needs a TTF that @fontsource does not
 *    ship.
 *  - It can embed JPEG and PNG only. iPhones shoot HEIC by default, so a HEIC
 *    photo is skipped with a printed note rather than crashing the book two
 *    days before the reunion.
 *  - Workers cap at 128 MB of memory. Photos are drawn at print size but the
 *    source bytes are released between pages, and the build is capped at
 *    MAX_PAGES so one enormous run cannot take the export down for everyone.
 *
 * The overriding rule here: this function must never throw. A souvenir with
 * one apologetic page beats no souvenir at all on the morning of the reunion.
 */

import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from 'pdf-lib';

const A5 = { width: 420, height: 595 };  // points — half of A4, a keepsake size
const MARGIN = 36;
const MAX_PAGES = 200;

const INK = rgb(0.11, 0.098, 0.09);      // #1C1917
const SOFT = rgb(0.34, 0.33, 0.31);      // #57534E
const TERRACOTTA = rgb(0.60, 0.20, 0.07); // #9A3412
const PAPER = rgb(1, 0.984, 0.92);       // #FFFBEB

export interface SouvenirPage {
  id: string;
  page_type: string;
  heading: string | null;
  blurb: string | null;
  member_name: string | null;
  then_key: string | null;
  now_key: string | null;
}

/* -- Text the standard fonts can actually draw ----------------------------- */

/** Typographic characters that have a plain equivalent worth keeping. */
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
  '•': '-', '­': '',
};

/**
 * Reduce a string to what WinAnsi can encode.
 *
 * Returns the printable text and whether anything had to be dropped, so the
 * caller can be honest on the page rather than silently mangling somebody's
 * words.
 */
export function safeText(input: string): { text: string; lost: boolean } {
  let lost = false;
  let out = '';

  for (const ch of input.replace(/[‘’‚‛“”„–—−‐‑…   •­]/g,
    (c) => FOLD[c] ?? c)) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff && code !== 0xad)) {
      out += ch;
    } else {
      lost = true;
    }
  }

  return { text: out, lost };
}

/** Draw, or give up on that one line. Never throws. */
function safeDraw(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb> },
) {
  try {
    page.drawText(text, opts);
  } catch {
    // A character slipped past safeText. One missing line is survivable;
    // a thrown exception in the middle of a 60-page build is not.
  }
}

/** Wrap text to a width, since pdf-lib draws strings without reflowing them. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      let tooWide = false;
      try {
        tooWide = font.widthOfTextAtSize(candidate, size) > maxWidth;
      } catch {
        tooWide = candidate.length * size * 0.5 > maxWidth; // rough, but never throws
      }
      if (tooWide && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function embed(
  pdf: PDFDocument, bucket: R2Bucket, key: string | null,
): Promise<PDFImage | null> {
  if (!key) return null;
  let object: R2ObjectBody | null = null;
  try {
    object = await bucket.get(key);
  } catch {
    return null;
  }
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  // Sniff the real format rather than trusting the stored extension.
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;

  try {
    if (isPng) return await pdf.embedPng(bytes);
    if (isJpg) return await pdf.embedJpg(bytes);
    return null; // HEIC and friends — handled by the caller.
  } catch {
    return null; // A corrupt photo must not take the whole book down.
  }
}

export async function buildSouvenirPdf(
  pages: SouvenirPage[],
  bucket: R2Bucket,
  title = 'BUC Pioneer Batch — Reunion Souvenir',
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safeText(title).text);
  pdf.setCreator('BUC Alumni Portal');

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const sheet = () => {
    const p = pdf.addPage([A5.width, A5.height]);
    p.drawRectangle({ x: 0, y: 0, width: A5.width, height: A5.height, color: PAPER });
    return p;
  };

  /* -- Cover -- */
  const cover = sheet();
  safeDraw(cover, 'BUC', { x: MARGIN, y: A5.height - 170, size: 62, font: bold, color: TERRACOTTA });
  for (const [i, line] of ['Pioneer Batch', 'Reunion Souvenir'].entries()) {
    safeDraw(cover, line, { x: MARGIN, y: A5.height - 215 - i * 26, size: 20, font: bold, color: INK });
  }
  safeDraw(cover, 'Batticaloa University College',
    { x: MARGIN, y: 120, size: 11, font: body, color: SOFT });
  safeDraw(cover, '28-29 August 2026 - Eastern University',
    { x: MARGIN, y: 104, size: 11, font: body, color: SOFT });

  /**
   * What to print in place of, or alongside, words this font cannot set.
   *
   * Two different situations, and saying the wrong one is worse than saying
   * nothing: a whole blurb in Tamil is not the same as an English blurb with
   * one stray character in it.
   */
  const ALL_LOST = 'This page is written in Tamil or Sinhala.'
    + ' It is on the website in full.';
  const SOME_LOST = '(a few characters could not be printed here)';

  /** Roughly: is there anything left worth printing? */
  const readable = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').length >= 3;

  /* -- Every page, in the order the admin chose -- */
  for (const entry of pages.slice(0, MAX_PAGES)) {
    const headingRaw = entry.heading || entry.member_name || 'A member of the batch';
    const heading = safeText(headingRaw);
    const blurb = entry.blurb ? safeText(entry.blurb) : null;

    /* --- A photograph on its own --- */
    if (entry.page_type === 'photo') {
      const page = sheet();
      const img = await embed(pdf, bucket, entry.then_key ?? entry.now_key);
      const boxW = A5.width - MARGIN * 2;
      const boxH = A5.height - MARGIN * 2 - 70;

      if (img) {
        const scale = Math.min(boxW / img.width, boxH / img.height); // whole photo, uncropped
        page.drawImage(img, {
          x: MARGIN + (boxW - img.width * scale) / 2,
          y: A5.height - MARGIN - 30 - img.height * scale,
          width: img.width * scale, height: img.height * scale,
        });
      }
      safeDraw(page, heading.text.slice(0, 60) || 'A photograph',
        { x: MARGIN, y: A5.height - MARGIN - 18, size: 16, font: bold, color: INK });
      if (blurb) {
        const caption = readable(blurb.text) ? blurb.text : (blurb.lost ? ALL_LOST : '');
        let y = MARGIN + 28;
        for (const line of wrap(caption, body, 10, boxW).slice(0, 3)) {
          safeDraw(page, line, { x: MARGIN, y, size: 10, font: body, color: SOFT });
          y -= 13;
        }
      }
      continue;
    }

    /* --- A written piece, flowing over as many sheets as it needs --- */
    if (entry.page_type === 'article') {
      let page = sheet();
      safeDraw(page, heading.text.slice(0, 60), {
        x: MARGIN, y: A5.height - MARGIN - 18, size: 18, font: bold, color: INK,
      });
      if (entry.member_name) {
        safeDraw(page, safeText(entry.member_name).text, {
          x: MARGIN, y: A5.height - MARGIN - 36, size: 10, font: body, color: SOFT,
        });
      }

      let y = A5.height - MARGIN - 62;
      const printable = blurb && readable(blurb.text);
      const lines = printable ? wrap(blurb!.text, body, 10.5, A5.width - MARGIN * 2) : [];
      for (const line of lines) {
        if (y < MARGIN + 14) {
          page = sheet();  // as many sheets as the writing needs
          y = A5.height - MARGIN - 14;
        }
        safeDraw(page, line, { x: MARGIN, y, size: 10.5, font: body, color: INK });
        y -= 15;
      }
      if (blurb?.lost) {
        safeDraw(page, printable ? SOME_LOST : ALL_LOST,
          { x: MARGIN, y: Math.max(y, MARGIN), size: 9, font: body, color: SOFT });
      }
      continue;
    }

    /* --- A member's "then and now" --- */
    const page = sheet();
    safeDraw(page, heading.text.slice(0, 60) || 'A member of the batch', {
      x: MARGIN, y: A5.height - MARGIN - 18, size: 18, font: bold, color: INK,
    });

    const [thenImg, nowImg] = await Promise.all([
      embed(pdf, bucket, entry.then_key),
      embed(pdf, bucket, entry.now_key),
    ]);

    const slotW = (A5.width - MARGIN * 2 - 12) / 2;
    const slotH = slotW * 1.25;
    const imgTop = A5.height - MARGIN - 40;

    const drawSlot = (img: PDFImage | null, x: number, label: string, missing: boolean) => {
      if (img) {
        // Cover-fit: fill the slot and centre the overflow, so portraits and
        // landscapes both sit correctly instead of being stretched.
        const scale = Math.max(slotW / img.width, slotH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: x - (w - slotW) / 2, y: imgTop - slotH - (h - slotH) / 2, width: w, height: h,
        });
      } else {
        page.drawRectangle({
          x, y: imgTop - slotH, width: slotW, height: slotH,
          borderColor: SOFT, borderWidth: 1,
        });
        if (missing) {
          safeDraw(page, 'photo could not be printed',
            { x: x + 8, y: imgTop - slotH / 2, size: 8, font: body, color: SOFT });
        }
      }
      safeDraw(page, label, { x, y: imgTop - slotH - 14, size: 10, font: bold, color: SOFT });
    };

    drawSlot(thenImg, MARGIN, 'THEN', Boolean(entry.then_key));
    drawSlot(nowImg, MARGIN + slotW + 12, 'NOW', Boolean(entry.now_key));

    let y = imgTop - slotH - 38;
    const printable = blurb && readable(blurb.text);
    if (printable) {
      for (const line of wrap(blurb!.text, body, 10.5, A5.width - MARGIN * 2)) {
        if (y < MARGIN + 14) break; // one sheet each; the rest lives on the site
        safeDraw(page, line, { x: MARGIN, y, size: 10.5, font: body, color: INK });
        y -= 15;
      }
    }
    if (blurb?.lost) {
      safeDraw(page, printable ? SOME_LOST : ALL_LOST,
        { x: MARGIN, y: Math.max(y, MARGIN), size: 9, font: body, color: SOFT });
    }
  }

  return pdf.save();
}
