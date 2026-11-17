// @ts-check
/**
 * EBoR paperwork (Task 12): the pieces of `/committee/ebor-paperwork` that are about the Verified Eagle Application.
 *
 *  - which page of the Verified Eagle Application is Requirement 7,
 *  - the date mark (MM DD YY) and a signature mark fitted into a box.
 * (Filling the Advancement Report was removed 2026-11-17: Council no longer uses it.)
 *
 * The rules (which values, which signers) come from the server (`lib/eborPaperwork.js`); nothing here knows a name.
 */
import { clampItemToPage, SIGNATURE_BASE_WIDTH_PT } from './pdfPlan.js';

/**
 * The page that holds Requirement 7: the first page whose text has "REQUIREMENT 7" (any case and spacing), else page 2
 * of a document with two or more pages, else none (the member picks).
 * @param {string[]} pageTexts
 * @returns {{ index: number, how: 'text' | 'page2' | 'ask' }}
 */
export function findRequirement7Page(pageTexts) {
  const list = pageTexts || [];
  const hit = list.findIndex(t => /requirement\s*7\b/i.test(String(t || '').replace(/\s+/g, ' ')));
  if (hit >= 0) return { index: hit, how: 'text' };
  if (list.length >= 2) return { index: 1, how: 'page2' };
  return { index: -1, how: 'ask' };
}

/** Spaces between month, day and year in the Requirement 7 date (Jim: one text, 3–4 spaces apart). */
export const R7_DATE_GAP = '    ';
/** Where the Requirement 7 date mark starts by default: its left edge and bottom, as fractions of the page (viewer space). */
export const R7_DATE_AT = { x: 0.785, y: 0.295 };
/** Its default font size (Jim W., 2026-11-17: 12 pt; the bar's Auto / − / + still change it). */
export const R7_DATE_FONT_PT = 12;

/**
 * The Requirement 7 date as ONE text mark "MM    DD    YY" (2026-11-11: three separate boxes sat too far apart):
 * drag it onto the form's three boxes, resize it to spread or tighten.
 * @param {{ mm: string, dd: string, yy: string }} date
 * @param {number} pageIndex
 * @param {{ width: number, height: number }} pageSize  viewer size
 * @param {string} ink
 * @returns {Array<import('./pdfView.js').ViewMark>}
 */
export function requirement7DateMarks(date, pageIndex, pageSize, ink) {
  const text = [date.mm, date.dd, date.yy].join(R7_DATE_GAP);
  const w = 88, h = 16;
  // Viewer space has its origin bottom-left. On the January 2026 form (512-728) Requirement 7's three date boxes start
  // about 79% across and sit about 30% up the page (Jim W., 2026-11-17: the old 62% / 42% landed up and to the left,
  // over the unit committee chair's date). Scans vary a little: the member still drags it onto the boxes.
  const x0 = Math.max(0, pageSize.width * R7_DATE_AT.x);
  const y0 = pageSize.height * R7_DATE_AT.y;
  return [clampItemToPage({
    id: 'r7date', kind: /** @type {'text'} */ ('text'), pageIndex, x: x0, y: y0, width: w, height: h,
    label: 'Date (MM DD YY)', text, ink, group: 'r7date', fontSize: R7_DATE_FONT_PT
  }, pageSize)];
}

/**
 * A signature image placed inside a form field's box (or any box): as wide as the box allows with its aspect kept,
 * centered. With no box (a scan with no field), `fallback` is the centre point to drop it at, at the usual width.
 * @param {number} aspect  width / height of the signature PNG
 * @param {{ x: number, y: number, width: number, height: number } | null} box
 * @param {{ x: number, y: number }} fallback
 * @param {{ width: number, height: number }} pageSize
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function fitSignatureToBox(aspect, box, fallback, pageSize) {
  const a = aspect > 0 && Number.isFinite(aspect) ? Math.max(0.5, Math.min(12, aspect)) : 4;
  if (!box) {
    const width = Math.min(SIGNATURE_BASE_WIDTH_PT, pageSize.width * 0.4);
    const height = width / a;
    return clampItemToPage({ x: fallback.x - width / 2, y: fallback.y - height / 2, width, height }, pageSize);
  }
  let width = box.width, height = width / a;
  if (height > box.height) { height = box.height; width = height * a; }
  width = Math.round(width * 10) / 10;
  height = Math.round(height * 10) / 10;
  return { x: Math.round((box.x + (box.width - width) / 2) * 10) / 10, y: Math.round((box.y + (box.height - height) / 2) * 10) / 10, width, height };
}
