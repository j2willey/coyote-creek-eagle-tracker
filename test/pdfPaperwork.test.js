import { describe, it, expect } from 'vitest';
import * as PDFLib from 'pdf-lib';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { findRequirement7Page, requirement7DateMarks, fitSignatureToBox } from '../web/js/pdfPaperwork.js';
import { applyMarksAndFlatten } from '../web/js/pdfEngine.js';

/** A small fillable form (once a stand-in for form 34403, dropped 2026-11-17): a fixture for flattening. */
async function standInReport({ withSigFields = true, rotate = 0 } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([612, 792]);
  if (rotate) page.setRotation(PDFLib.degrees(rotate));
  const form = doc.getForm();
  const text = (name, x, y, w = 120) => { const f = form.createTextField(name); f.addToPage(page, { x, y, width: w, height: 14 }); };
  text('No', 100, 700, 50); text('District', 200, 700); text('Leader', 100, 680); text('Address', 100, 660); text('City', 100, 640);
  text('State', 250, 640, 30); text('Zip', 300, 640, 50);
  text('Date this report forwarded to council service center', 100, 600, 100); text('Title', 300, 600);
  text('Board of Review Date', 100, 580, 100);
  text('#1', 59, 342, 132); text('Date Award Earned1', 200, 342, 80); text('Badge of Rank Merit Badge or Award1', 290, 342, 120);
  const radio = form.createRadioGroup('Group16');
  ['Pack', 'Troop', 'Crew', 'Ship'].forEach((opt, i) => radio.addOptionToPage(opt, page, { x: 54 + i * 33.5, y: 736, width: 9, height: 9 }));
  if (withSigFields) {
    // /Sig fields: pdf-lib has no creator, so add them by hand like a real form has them.
    ['Signature1', 'Signature2', 'Signature3'].forEach((n, i) => {
      const dict = doc.context.obj({
        Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFLib.PDFString.of(n), Rect: [60, 200 - i * 40, 220, 225 - i * 40], F: 4, P: page.ref
      });
      const ref = doc.context.register(dict);
      page.node.addAnnot(ref);
      form.acroForm.addField(ref);
    });
  }
  return new Uint8Array(await doc.save());
}

const TINY_PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

describe('findRequirement7Page', () => {
  it('finds the page with REQUIREMENT 7, any case and spacing', () => {
    expect(findRequirement7Page(['Page one', 'Eagle  Scout REQUIREMENT   7 ...', 'x'])).toEqual({ index: 1, how: 'text' });
    expect(findRequirement7Page(['requirement 7', 'requirement 7'])).toEqual({ index: 0, how: 'text' });
  });
  it('is not fooled by requirement 70 or 17', () => {
    expect(findRequirement7Page(['requirement 70', 'x', 'requirement 17'])).toEqual({ index: 1, how: 'page2' });
  });
  it('falls back to page 2, else asks', () => {
    expect(findRequirement7Page(['', ''])).toEqual({ index: 1, how: 'page2' });   // a scan: no text at all
    expect(findRequirement7Page([''])).toEqual({ index: -1, how: 'ask' });
    expect(findRequirement7Page([])).toEqual({ index: -1, how: 'ask' });
  });
});

describe('Requirement 7 date marks and signature fitting', () => {
  it('gives ONE text mark "MM    DD    YY" inside the page', () => {
    const marks = requirement7DateMarks({ mm: '03', dd: '07', yy: '26' }, 1, { width: 612, height: 792 }, 'black');
    expect(marks).toHaveLength(1);
    expect(marks[0].text).toBe('03    07    26');
    expect(marks[0].pageIndex === 1 && marks[0].x >= 0 && marks[0].x + marks[0].width <= 612).toBe(true);
    // 2026-11-17: on Requirement 7's boxes (right, lower third), 12 pt
    expect(marks[0].x).toBeCloseTo(612 * 0.797, 0);
    expect(marks[0].y).toBeCloseTo(792 * 0.295, 0);
    expect(marks[0].fontSize).toBe(12);
  });
  it('fits a signature inside a field box, aspect kept, centered', () => {
    const r = fitSignatureToBox(4, { x: 60, y: 200, width: 160, height: 25 }, { x: 0, y: 0 }, { width: 612, height: 792 });
    expect(r.width / r.height).toBeCloseTo(4, 1);
    expect(r.height).toBeLessThanOrEqual(25);
    expect(r.x).toBeGreaterThanOrEqual(60);
    expect(r.x + r.width).toBeLessThanOrEqual(220.1);
    const wide = fitSignatureToBox(1, { x: 60, y: 200, width: 160, height: 25 }, { x: 0, y: 0 }, { width: 612, height: 792 });
    expect(wide.height).toBe(25);
  });
  it('drops it at the point when there is no box, inside the page', () => {
    const r = fitSignatureToBox(4, null, { x: 2, y: 2 }, { width: 612, height: 792 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.width).toBeGreaterThan(30);
  });
});

describe('applyMarksAndFlatten', () => {
  it('flattens the filled form and draws signature images and text, nothing left fillable on that page', async () => {
    const form = await PDFLib.PDFDocument.load(await standInReport());
    form.getForm().getTextField('#1').setText('Theodore Sample');
    const filled = { pdfBytes: new Uint8Array(await form.save()) };
    const marks = [
      { id: 'a', kind: 'image', pageIndex: 0, x: 62, y: 202, width: 100, height: 20, png: TINY_PNG },
      { id: 'b', kind: 'text', pageIndex: 0, x: 300, y: 300, width: 30, height: 16, text: '03', ink: 'darkblue' }
    ];
    const res = await applyMarksAndFlatten(PDFLib, { pdfBytes: filled.pdfBytes, marks });
    expect(res.flattenedPages).toEqual([0]);
    const doc = await PDFLib.PDFDocument.load(res.pdfBytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(res.pdfBytes), verbosity: 0 }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    const text = tc.items.map(i => i.str).join(' ');
    expect(text).toContain('Theodore Sample');       // the filled value survives as page content
    expect(text).toContain('03');
  });
  it('refuses an image mark with no image and a mark on a missing page', async () => {
    const bytes = await standInReport();
    await expect(applyMarksAndFlatten(PDFLib, { pdfBytes: bytes, marks: [{ id: 'a', kind: 'image', pageIndex: 0, x: 0, y: 0, width: 10, height: 10 }] })).rejects.toThrow(/no image/);
    await expect(applyMarksAndFlatten(PDFLib, { pdfBytes: bytes, marks: [{ id: 'a', kind: 'text', pageIndex: 4, x: 0, y: 0, width: 10, height: 10, text: 'x' }] })).rejects.toThrow(/page that does not exist/);
  });
  it('draws a scan page upside down or rotated upright (viewer-space marks)', async () => {
    const doc = await PDFLib.PDFDocument.create();
    const p = doc.addPage([612, 792]);
    p.setRotation(PDFLib.degrees(90));
    const bytes = new Uint8Array(await doc.save());
    const res = await applyMarksAndFlatten(PDFLib, { pdfBytes: bytes, marks: [{ id: 'a', kind: 'text', pageIndex: 0, x: 100, y: 100, width: 60, height: 16, text: 'MARK' }] });
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(res.pdfBytes), verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    const item = tc.items.find(i => i.str === 'MARK');
    expect(item).toBeTruthy();
    const vp = page.getViewport({ scale: 1 });
    const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
    expect(x).toBeGreaterThan(95); expect(x).toBeLessThan(110);
    expect(vp.height - y).toBeGreaterThan(95); expect(vp.height - y).toBeLessThan(125);
  });
});
