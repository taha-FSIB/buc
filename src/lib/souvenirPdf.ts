/**
 * Builds the reunion souvenir as a single PDF.
 *
 * pdf-lib is pure JavaScript, so it runs inside a Worker with no native
 * dependency. Constraints worth knowing:
 *
 *  - The standard PDF fonts are WinAnsi-encoded, so they cannot set a word of
 *    Tamil or Sinhala. This book is for a Sri Lankan batch and roughly a third
 *    of it writes in one of those two, so until now their pages printed an
 *    apology instead of their words. Noto Sans Tamil and Noto Sans Sinhala are
 *    now embedded from public/fonts and chosen per run of text — see
 *    `fontFor` and `SCRIPT_RUN` below.
 *  - It can embed JPEG and PNG only. iPhones shoot HEIC by default, so a HEIC
 *    photo is skipped with a printed note rather than crashing the book two
 *    days before the reunion.
 *  - Workers cap at 128 MB of memory. Photos are drawn at print size but the
 *    source bytes are released between pages, and the build is capped at
 *    MAX_PAGES so one enormous run cannot take the export down for everyone.
 *
 * The overriding rule here: this function must never throw. A souvenir with
 * one apologetic page beats no souvenir at all on the morning of the reunion.
 *
 * WHY THE REGENERATOR IMPORT IS THE FIRST LINE:
 * fontkit carries a full OpenType layout engine, and it needs it — Tamil is
 * not a font problem, it is a reordering problem. In நான், the vowel sign is
 * typed after its consonant and drawn before it, and only a shaper knows that.
 * fontkit's Indic shaper drives a state machine compiled through Babel's
 * regenerator transform, and @pdf-lib/fontkit's UMD build ships that code
 * without the runtime it depends on. Latin never reaches it, so the gap is
 * invisible until the first Tamil character arrives and throws
 * "regeneratorRuntime is not defined" — mid-book, in production. Importing it
 * here puts the global in place before fontkit is ever loaded.
 */

import 'regenerator-runtime/runtime.js';

import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

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

/* -- Choosing a font for each stretch of text ------------------------------ */

/** Typographic characters the standard Latin font cannot set. */
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
  '•': '-', '­': '',
};

const FOLDABLE = /[‘’‚‛“”„–—−‐‑…   •­]/g;

/**
 * Tidy a string without ever discarding a letter.
 *
 * This used to strip everything WinAnsi could not encode and report what it
 * had thrown away, because throwing it away was the only option available.
 * Now the only job is folding curly quotes and dashes down to shapes the
 * Latin font actually has. Nothing is lost, so `lost` is always false — it is
 * kept so the callers and their honest "we could not print this" notes did
 * not all have to change on the same day.
 */
export function safeText(input: string): { text: string; lost: boolean } {
  return { text: input.replace(FOLDABLE, (c) => FOLD[c] ?? c), lost: false };
}

type Script = 'ta' | 'si' | 'latin';

/**
 * Which script a character belongs to.
 *
 * Tamil is U+0B80–U+0BFF and Sinhala U+0D80–U+0DFF. Everything else — Latin,
 * digits, punctuation — is 'latin' and stays with the Latin font.
 */
function scriptOf(code: number): Script {
  if (code >= 0x0b80 && code <= 0x0bff) return 'ta';
  if (code >= 0x0d80 && code <= 0x0dff) return 'si';
  return 'latin';
}

export interface FontSet {
  latin: PDFFont; latinBold: PDFFont;
  ta: PDFFont; taBold: PDFFont;
  si: PDFFont; siBold: PDFFont;
}

/**
 * Split a string into runs of a single script.
 *
 * Necessary rather than tidy: Noto Sans Tamil has 244 glyphs and not one of
 * them is a Latin letter — digits and punctuation, but no A–Z. Setting a mixed
 * line in it would silently swallow the English words, and setting the same
 * line in Helvetica would swallow the Tamil. "Kandy, 1975 — நான் ஆசிரியை" has
 * to be drawn as separate runs, and measured as separate runs.
 *
 * Sinhala's Noto does include Latin, but goes down the same path so there is
 * one behaviour to reason about rather than two.
 */
function runsOf(text: string): { text: string; script: Script }[] {
  const runs: { text: string; script: Script }[] = [];
  for (const ch of text) {
    const s = scriptOf(ch.codePointAt(0)!);
    const last = runs[runs.length - 1];
    // Whitespace stays in whichever run it lands in, so one space between two
    // Tamil words does not split the line into three.
    if (last && (last.script === s || /\s/.test(ch))) last.text += ch;
    else runs.push({ text: ch, script: s });
  }
  return runs;
}

function fontFor(fonts: FontSet, script: Script, bold: boolean): PDFFont {
  if (script === 'ta') return bold ? fonts.taBold : fonts.ta;
  if (script === 'si') return bold ? fonts.siBold : fonts.si;
  return bold ? fonts.latinBold : fonts.latin;
}

/** Width of a string once every run is measured in its own font. */
function widthOf(text: string, fonts: FontSet, size: number, bold: boolean): number {
  let w = 0;
  for (const run of runsOf(text)) {
    try {
      w += fontFor(fonts, run.script, bold).widthOfTextAtSize(run.text, size);
    } catch {
      w += run.text.length * size * 0.5; // rough, but never throws
    }
  }
  return w;
}

/**
 * Draw a line run by run, advancing x by each run's own width.
 *
 * Never throws. One missing line is survivable; an exception forty pages into
 * a sixty-page build, on the morning of the reunion, is not.
 */
function safeDraw(
  page: PDFPage,
  text: string,
  opts: {
    x: number; y: number; size: number; fonts: FontSet;
    color: ReturnType<typeof rgb>; bold?: boolean;
  },
) {
  let x = opts.x;
  for (const run of runsOf(text)) {
    const font = fontFor(opts.fonts, run.script, opts.bold ?? false);
    try {
      page.drawText(run.text, { x, y: opts.y, size: opts.size, font, color: opts.color });
      x += font.widthOfTextAtSize(run.text, opts.size);
    } catch {
      x += run.text.length * opts.size * 0.5;
    }
  }
}

/** Wrap text to a width, since pdf-lib draws strings without reflowing them. */
function wrap(
  text: string, fonts: FontSet, size: number, maxWidth: number, bold = false,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, fonts, size, bold) > maxWidth && line) {
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

/**
 * Load the four Noto files out of the assets bundle and embed them.
 *
 * They live in public/fonts and are fetched rather than bundled into the
 * Worker script, which keeps half a megabyte of font data out of the code.
 * Subset embedding means only the glyphs this particular book actually uses
 * travel inside the PDF.
 *
 * If a font cannot be fetched the book still builds, falling back to Latin for
 * that script. That is precisely the old behaviour, and a souvenir with some
 * unprintable pages beats an exception.
 */
async function loadFonts(
  pdf: PDFDocument, assets: Fetcher | undefined,
): Promise<FontSet> {
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  const latinBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const set: FontSet = {
    latin, latinBold, ta: latin, taBold: latinBold, si: latin, siBold: latinBold,
  };
  if (!assets) return set;

  pdf.registerFontkit(fontkit);
  const want: [keyof FontSet, string][] = [
    ['ta', 'NotoSansTamil-Regular.ttf'],
    ['taBold', 'NotoSansTamil-Bold.ttf'],
    ['si', 'NotoSansSinhala-Regular.ttf'],
    ['siBold', 'NotoSansSinhala-Bold.ttf'],
  ];

  for (const [slot, file] of want) {
    try {
      const res = await assets.fetch(new Request(`https://assets.local/fonts/${file}`));
      if (!res.ok) continue;
      set[slot] = await pdf.embedFont(await res.arrayBuffer(), { subset: true });
    } catch {
      // Keep the Latin fallback for this one and carry on.
    }
  }
  return set;
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
  assets?: Fetcher,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safeText(title).text);
  pdf.setCreator('BUC Alumni Portal');

  const fonts = await loadFonts(pdf, assets);

  const sheet = () => {
    const p = pdf.addPage([A5.width, A5.height]);
    p.drawRectangle({ x: 0, y: 0, width: A5.width, height: A5.height, color: PAPER });
    return p;
  };

  /* -- Cover -- */
  const cover = sheet();
  safeDraw(cover, 'BUC', { x: MARGIN, y: A5.height - 170, size: 62, fonts, bold: true, color: TERRACOTTA });
  for (const [i, line] of ['Pioneer Batch', 'Reunion Souvenir'].entries()) {
    safeDraw(cover, line, { x: MARGIN, y: A5.height - 215 - i * 26, size: 20, fonts, bold: true, color: INK });
  }
  safeDraw(cover, 'Batticaloa University College',
    { x: MARGIN, y: 120, size: 11, fonts, color: SOFT });
  safeDraw(cover, '28-29 August 2026 - Eastern University',
    { x: MARGIN, y: 104, size: 11, fonts, color: SOFT });

  /**
   * Is there anything here worth printing at all?
   *
   * This used to ask "is there anything LATIN left", because Tamil and Sinhala
   * had already been stripped out by then and the page had to apologise for
   * them. Now they set properly, so the only question is whether the member
   * wrote anything.
   */
  const readable = (s: string) => s.trim().length > 0;

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
        { x: MARGIN, y: A5.height - MARGIN - 18, size: 16, fonts, bold: true, color: INK });
      if (blurb) {
        const caption = readable(blurb.text) ? blurb.text : '';
        let y = MARGIN + 28;
        for (const line of wrap(caption, fonts, 10, boxW).slice(0, 3)) {
          safeDraw(page, line, { x: MARGIN, y, size: 10, fonts, color: SOFT });
          y -= 13;
        }
      }
      continue;
    }

    /* --- A written piece, flowing over as many sheets as it needs --- */
    if (entry.page_type === 'article') {
      let page = sheet();
      safeDraw(page, heading.text.slice(0, 60), {
        x: MARGIN, y: A5.height - MARGIN - 18, size: 18, fonts, bold: true, color: INK,
      });
      if (entry.member_name) {
        safeDraw(page, safeText(entry.member_name).text, {
          x: MARGIN, y: A5.height - MARGIN - 36, size: 10, fonts, color: SOFT,
        });
      }

      let y = A5.height - MARGIN - 62;
      const printable = blurb && readable(blurb.text);
      const lines = printable ? wrap(blurb!.text, fonts, 10.5, A5.width - MARGIN * 2) : [];
      for (const line of lines) {
        if (y < MARGIN + 14) {
          page = sheet();  // as many sheets as the writing needs
          y = A5.height - MARGIN - 14;
        }
        safeDraw(page, line, { x: MARGIN, y, size: 10.5, fonts, color: INK });
        y -= 15;
      }
      continue;
    }

    /* --- A member's "then and now" --- */
    const page = sheet();
    safeDraw(page, heading.text.slice(0, 60) || 'A member of the batch', {
      x: MARGIN, y: A5.height - MARGIN - 18, size: 18, fonts, bold: true, color: INK,
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
            { x: x + 8, y: imgTop - slotH / 2, size: 8, fonts, color: SOFT });
        }
      }
      safeDraw(page, label, { x, y: imgTop - slotH - 14, size: 10, fonts, bold: true, color: SOFT });
    };

    drawSlot(thenImg, MARGIN, 'THEN', Boolean(entry.then_key));
    drawSlot(nowImg, MARGIN + slotW + 12, 'NOW', Boolean(entry.now_key));

    let y = imgTop - slotH - 38;
    const printable = blurb && readable(blurb.text);
    if (printable) {
      for (const line of wrap(blurb!.text, fonts, 10.5, A5.width - MARGIN * 2)) {
        if (y < MARGIN + 14) break; // one sheet each; the rest lives on the site
        safeDraw(page, line, { x: MARGIN, y, size: 10.5, fonts, color: INK });
        y -= 15;
      }
    }
  }

  return pdf.save();
}
