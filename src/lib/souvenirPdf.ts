/**
 * Builds the reunion souvenir as a single PDF.
 *
 * pdf-lib is pure JavaScript, so it runs inside a Worker with no native
 * dependency. Two constraints worth knowing:
 *
 *  - It can embed JPEG and PNG only. iPhones shoot HEIC by default, so a
 *    HEIC "then" photo is skipped with a printed note rather than crashing
 *    the whole book two days before the reunion.
 *  - Workers cap at 128 MB of memory. Photos are drawn at print size but the
 *    source bytes are released between pages, and the build is capped at
 *    MAX_PAGES so one enormous run cannot take the export down for everyone.
 */

import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';

const A5 = { width: 420, height: 595 };  // points — half of A4, a keepsake size
const MARGIN = 36;
const MAX_PAGES = 200;

const INK = rgb(0.11, 0.098, 0.09);      // #1C1917
const SOFT = rgb(0.34, 0.33, 0.31);      // #57534E
const TERRACOTTA = rgb(0.60, 0.20, 0.07); // #9A3412
const PAPER = rgb(1, 0.984, 0.92);       // #FFFBEB

export interface SouvenirPage {
  id: string;
  heading: string | null;
  blurb: string | null;
  member_name: string | null;
  then_key: string | null;
  now_key: string | null;
}

/** Wrap text to a width, since pdf-lib draws strings without reflowing them. */
function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
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
  const object = await bucket.get(key);
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
  pdf.setTitle(title);
  pdf.setCreator('BUC Alumni Portal');

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /* -- Cover -- */
  const cover = pdf.addPage([A5.width, A5.height]);
  cover.drawRectangle({ x: 0, y: 0, width: A5.width, height: A5.height, color: PAPER });
  cover.drawText('BUC', {
    x: MARGIN, y: A5.height - 170, size: 62, font: bold, color: TERRACOTTA,
  });
  for (const [i, line] of ['Pioneer Batch', 'Reunion Souvenir'].entries()) {
    cover.drawText(line, {
      x: MARGIN, y: A5.height - 215 - i * 26, size: 20, font: bold, color: INK,
    });
  }
  cover.drawText('Batticaloa University College', {
    x: MARGIN, y: 120, size: 11, font: body, color: SOFT,
  });
  cover.drawText('28-29 August 2026 · Eastern University', {
    x: MARGIN, y: 104, size: 11, font: body, color: SOFT,
  });

  /* -- One page per member -- */
  for (const entry of pages.slice(0, MAX_PAGES)) {
    const page = pdf.addPage([A5.width, A5.height]);
    page.drawRectangle({ x: 0, y: 0, width: A5.width, height: A5.height, color: PAPER });

    const name = entry.heading || entry.member_name || 'A member of the batch';
    page.drawText(name.slice(0, 60), {
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
          page.drawText('photo could not be printed', {
            x: x + 8, y: imgTop - slotH / 2, size: 8, font: body, color: SOFT,
          });
        }
      }
      page.drawText(label, {
        x, y: imgTop - slotH - 14, size: 10, font: bold, color: SOFT,
      });
    };

    drawSlot(thenImg, MARGIN, 'THEN', Boolean(entry.then_key));
    drawSlot(nowImg, MARGIN + slotW + 12, 'NOW', Boolean(entry.now_key));

    if (entry.blurb) {
      let y = imgTop - slotH - 38;
      const lines = wrap(entry.blurb, body, 10.5, A5.width - MARGIN * 2);
      for (const line of lines) {
        if (y < MARGIN + 14) break; // one page each; the rest lives on the site
        page.drawText(line, { x: MARGIN, y, size: 10.5, font: body, color: INK });
        y -= 15;
      }
    }
  }

  return pdf.save();
}
