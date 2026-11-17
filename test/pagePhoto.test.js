import { describe, it, expect } from 'vitest';
import * as PDFLib from 'pdf-lib';
import { normRot, rotatedSize, clampCrop, dragCorner, fitOnPage, replacePageWithImage, MIN_CROP } from '../web/js/pagePhoto.js';

// A minimal JPEG header (SOI + SOF0 for 1×1, one channel + EOI): all pdf-lib reads to embed it.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);

async function twoPages({ rotate2 = 0, withField = false } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const p1 = doc.addPage([612, 792]); p1.drawText('Page one', { x: 50, y: 700 });
  const p2 = doc.addPage([612, 792]); p2.drawText('REQUIREMENT 7', { x: 50, y: 300 });
  if (rotate2) p2.setRotation(PDFLib.degrees(rotate2));
  if (withField) { const f = doc.getForm().createTextField('r7date'); f.setText('11 18 26'); f.addToPage(p2, { x: 400, y: 230, width: 90, height: 16 }); }
  return new Uint8Array(await doc.save());
}

describe('Photo of the signed page (step 2, 2026-11-17)', () => {
  it('turns and crops in fractions, never smaller than MIN_CROP', () => {
    expect(normRot(-90)).toBe(270);
    expect(rotatedSize(4000, 3000, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(4000, 3000, 180)).toEqual({ width: 4000, height: 3000 });
    expect(clampCrop({ x: 0.9, y: -1, w: 0.05, h: 2 })).toEqual({ x: 0.85, y: 0, w: MIN_CROP, h: 1 });
    const c = dragCorner({ x: 0, y: 0, w: 1, h: 1 }, 'nw', { x: 0.1, y: 0.2 });
    expect(c).toEqual({ x: 0.1, y: 0.2, w: 0.9, h: 0.8 });
    expect(dragCorner(c, 'se', { x: 0.12, y: 0.21 })).toEqual({ x: 0.1, y: 0.2, w: MIN_CROP, h: MIN_CROP });
  });
  it('fits the photo on the page, aspect kept, centred', () => {
    expect(fitOnPage(3000, 4000, 612, 792)).toEqual({ x: 9, y: 0, width: 594, height: 792 });
    expect(fitOnPage(4000, 3000, 612, 792)).toMatchObject({ x: 0, width: 612, height: 459 });
  });
  it('replaces only the Requirement 7 page: same page count, same order, Letter size', async () => {
    const out = await replacePageWithImage(PDFLib, await twoPages({ withField: true }), 1, JPEG, 3000, 4000);
    expect(out.pages).toBe(2);
    const doc = await PDFLib.PDFDocument.load(out.pdfBytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getForm().getFields()).toHaveLength(0);                 // flattened first: no field left pointing at the old page
  });
  it('a rotated page is replaced by an upright page of its displayed size', async () => {
    const out = await replacePageWithImage(PDFLib, await twoPages({ rotate2: 90 }), 1, JPEG, 4000, 3000);
    const doc = await PDFLib.PDFDocument.load(out.pdfBytes);
    expect(doc.getPage(1).getSize()).toEqual({ width: 792, height: 612 });
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });
  it('says so when the page does not exist', async () => {
    await expect(replacePageWithImage(PDFLib, await twoPages(), 5, JPEG, 10, 10)).rejects.toThrow(/2 pages: there is no page 6/);
  });
});
