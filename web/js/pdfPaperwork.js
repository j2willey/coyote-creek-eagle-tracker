// @ts-check
/**
 * EBoR paperwork (Task 12): the pieces of `/committee/ebor-paperwork` that are about the two PDFs.
 *
 *  - which page of the Verified Eagle Application is Requirement 7,
 *  - the three date marks (MM, DD, YY) and a signature mark fitted into a form field's box,
 *  - filling the Advancement Report (form 34403) with pdf-lib: text fields by name, the unit type chosen by the
 *    position of its widget, and the rectangles of the three signature fields (as viewer-space boxes).
 *
 * The rules (which values, which signers) come from the server (`lib/eborPaperwork.js`); nothing here knows a name.
 */
import { loadPdfWithDecrypt } from './pdfEngine.js';
import { normalizeRotation, userRectToViewer, clampItemToPage, SIGNATURE_BASE_WIDTH_PT } from './pdfPlan.js';

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

/**
 * Three text marks MM, DD, YY side by side (one group: they drag together onto the form's three boxes).
 * @param {{ mm: string, dd: string, yy: string }} date
 * @param {number} pageIndex
 * @param {{ width: number, height: number }} pageSize  viewer size
 * @param {string} ink
 * @returns {Array<import('./pdfView.js').ViewMark>}
 */
export function requirement7DateMarks(date, pageIndex, pageSize, ink) {
  const w = 30, h = 16, gap = 22;
  const total = w * 3 + gap * 2;
  const x0 = Math.max(0, pageSize.width * 0.62 - total / 2);
  const y0 = pageSize.height * 0.42;
  return [['mm', date.mm, 'MM'], ['dd', date.dd, 'DD'], ['yy', date.yy, 'YY']].map(([id, text, label], i) =>
    clampItemToPage({
      id: `r7date-${id}`, kind: /** @type {'text'} */ ('text'), pageIndex, x: x0 + i * (w + gap), y: y0, width: w, height: h,
      label: `Date ${label}`, text, ink, group: 'r7date'
    }, pageSize));
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

/**
 * Choose one widget of a radio group by its position (left to right), not by its export value.
 * @param {any} PDFLib
 * @param {any} form
 * @param {string} groupName
 * @param {number} index
 */
export function selectRadioByPosition(PDFLib, form, groupName, index) {
  const { PDFName } = PDFLib;
  const group = form.getRadioGroup(groupName);
  const widgets = group.acroField.getWidgets().map((/** @type {any} */ w) => ({ w, x: w.getRectangle().x }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.x - b.x);
  const target = widgets[index];
  if (!target) throw new Error(`${groupName} has no widget number ${index + 1}`);
  const on = target.w.getOnValue();
  if (!on) throw new Error(`${groupName}: that widget has no "on" appearance`);
  group.acroField.dict.set(PDFName.of('V'), on);
  for (const { w } of widgets) w.setAppearanceState(w === target.w ? on : PDFName.of('Off'));
}

/**
 * Fill the Advancement Report. fill: {text: {field: value}, radio: {group, index} | null} from the server.
 * A field the form doesn't have is reported in `missing`, never fatal. `sigRects` are the three signature fields'
 * boxes in VIEWER space (null when the form has no such field).
 *
 * @param {any} PDFLib
 * @param {Uint8Array} pdfBytes
 * @param {{ text: Record<string, string>, radio: { group: string, index: number } | null }} fill
 * @param {string[]} signatureFields
 * @returns {Promise<{ pdfBytes: Uint8Array, missing: string[], sigRects: Record<string, { pageIndex: number, x: number, y: number, width: number, height: number } | null> }>}
 */
export async function fillAdvancementReport(PDFLib, pdfBytes, fill, signatureFields) {
  const pdfDoc = await loadPdfWithDecrypt(PDFLib, pdfBytes);
  const form = pdfDoc.getForm();
  /** @type {string[]} */
  const missing = [];
  for (const [name, value] of Object.entries(fill.text || {})) {
    try { form.getTextField(name).setText(String(value)); } catch { missing.push(name); }
  }
  if (fill.radio) {
    try { selectRadioByPosition(PDFLib, form, fill.radio.group, fill.radio.index); } catch { missing.push(fill.radio.group); }
  }
  const pages = pdfDoc.getPages();
  /** @type {Record<string, { pageIndex: number, x: number, y: number, width: number, height: number } | null>} */
  const sigRects = {};
  for (const name of signatureFields || []) {
    sigRects[name] = null;
    try {
      const widget = form.getField(name).acroField.getWidgets()[0];
      const page = form.findWidgetPage(widget);
      const idx = pages.findIndex((/** @type {any} */ p) => p.ref === page.ref);
      if (idx < 0) continue;
      const cb = typeof page.getCropBox === 'function' ? page.getCropBox() : page.getSize();
      const r = widget.getRectangle();
      const v = userRectToViewer({ x: r.x, y: r.y, width: r.width, height: r.height }, { width: cb.width, height: cb.height },
        normalizeRotation(page.getRotation ? page.getRotation().angle : 0), { x: Number(cb.x) || 0, y: Number(cb.y) || 0 });
      sigRects[name] = { pageIndex: idx, x: v.x, y: v.y, width: v.width, height: v.height };
    } catch { /* no such signature field: the member places it by hand */ }
  }
  const saved = await pdfDoc.save();
  return { pdfBytes: saved instanceof Uint8Array ? saved : new Uint8Array(saved), missing, sigRects };
}
