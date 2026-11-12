import { describe, it, expect } from 'vitest';
import * as PDFLib from 'pdf-lib';
import {
  INK_COLORS, DEFAULT_INK, normalizeInk, inkHex, inkRgb,
  acceptPadPointer, strokeWidth, PALM_CONTACT_PX, PEN_PALM_WINDOW_MS
} from '../web/js/pdfPlan.js';
import { applyPlacedItemsAndFlatten } from '../web/js/pdfEngine.js';
import { loadSavedSignature } from '../web/js/pdfWorkshop.js';

describe('ink palette (Task 12)', () => {
  it('has the eight colours, black first and the default', () => {
    expect(INK_COLORS.map(c => c.key)).toEqual(['black', 'darkblue', 'blue', 'purple', 'darkgreen', 'brown', 'rust', 'darkred']);
    expect(DEFAULT_INK).toBe('black');
    expect(INK_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
  });
  it('makes any stored value valid', () => {
    expect(normalizeInk('Rust')).toBe('rust');
    expect(normalizeInk('#ff0000')).toBe('black');
    expect(normalizeInk(undefined)).toBe('black');
    expect(inkHex('nope')).toBe(inkHex('black'));
  });
  it('gives pdf-lib components in 0..1', () => {
    const [r, g, b] = inkRgb('darkred');
    expect(r).toBeGreaterThan(g);
    expect([r, g, b].every(v => v >= 0 && v <= 1)).toBe(true);
    expect(inkRgb('black').every(v => v < 0.2)).toBe(true);
  });
  it('is remembered with the signature settings, defaulting to black', () => {
    const store = new Map();
    const prev = globalThis.localStorage;
    globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    try {
      expect(loadSavedSignature('Pat Q').ink).toBe('black');
      store.set('ccacSignature_v1', JSON.stringify({ mode: 'type', typedText: 'Pat Q', ink: 'purple' }));
      expect(loadSavedSignature('Pat Q').ink).toBe('purple');
      store.set('ccacSignature_v1', JSON.stringify({ mode: 'type', typedText: 'Pat Q' }));
      expect(loadSavedSignature('Pat Q').ink).toBe('black');
    } finally { globalThis.localStorage = prev; }
  });
});

describe('draw pad pointer rules (Task 12)', () => {
  const idle = { activePointerId: null, lastPenMs: 0, nowMs: 10000 };
  it('lets a mouse, a pen and a finger start a stroke', () => {
    expect(acceptPadPointer({ pointerType: 'mouse', button: 0, isPrimary: true }, idle)).toBe(true);
    expect(acceptPadPointer({ pointerType: 'pen', isPrimary: true }, idle)).toBe(true);
    expect(acceptPadPointer({ pointerType: 'touch', isPrimary: true, width: 10, height: 10 }, idle)).toBe(true);
  });
  it('ignores a second pointer while one is drawing (multi-touch)', () => {
    expect(acceptPadPointer({ pointerType: 'touch', isPrimary: true }, { ...idle, activePointerId: 3 })).toBe(false);
  });
  it('ignores a non-primary pointer and a right mouse button', () => {
    expect(acceptPadPointer({ pointerType: 'touch', isPrimary: false }, idle)).toBe(false);
    expect(acceptPadPointer({ pointerType: 'mouse', button: 2 }, idle)).toBe(false);
  });
  it('ignores a palm: a big contact, or a touch just after the pen', () => {
    expect(acceptPadPointer({ pointerType: 'touch', width: PALM_CONTACT_PX, height: 10 }, idle)).toBe(false);
    expect(acceptPadPointer({ pointerType: 'touch', width: 10, height: 10 }, { ...idle, lastPenMs: 9500 })).toBe(false);
    expect(acceptPadPointer({ pointerType: 'touch', width: 10, height: 10 }, { ...idle, lastPenMs: 10000 - PEN_PALM_WINDOW_MS - 1 })).toBe(true);
    expect(acceptPadPointer({ pointerType: 'pen' }, { ...idle, lastPenMs: 9990 })).toBe(true);
  });
  it('thickens a pen stroke with pressure and keeps finger and mouse strokes constant', () => {
    expect(strokeWidth(4, 0.5, 'mouse')).toBe(4);
    expect(strokeWidth(4, 0, 'touch')).toBe(4);
    expect(strokeWidth(4, 0, 'pen')).toBe(4);
    expect(strokeWidth(4, 1, 'pen')).toBeGreaterThan(strokeWidth(4, 0.2, 'pen'));
    expect(strokeWidth(4, 5, 'pen')).toBe(strokeWidth(4, 1, 'pen'));
  });
});

describe('placed text takes the ink colour (Task 12)', () => {
  it('draws the printed name in the chosen colour', async () => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = new Uint8Array(await doc.save());
    const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const analysis = { edition: 'unknown', pages: [{ pageIndex: 0, pageNumber: 1, role: 'proposal', forbidden: false, afterNotOurs: false, notOursSection: '', lockedLabel: '', scanCandidate: false, isApprovalLandmark: false }],
      approvalPageIndices: [], scanCandidatePageIndices: [], defaultTargetPageIndex: -1, firstNotOursPageIndex: 1, proposalEndPageIndex: 0, insertBeforePageIndex: 0 };
    const items = [
      { id: 'a', kind: 'signature', pageIndex: 0, x: 100, y: 100, width: 60, height: 20 },
      { id: 'b', kind: 'name', pageIndex: 0, x: 100, y: 200, width: 170, height: 14 }
    ];
    const run = async ink => {
      const r = await applyPlacedItemsAndFlatten(PDFLib, { pdfBytes: bytes, analysis, items, signaturePngBytes: tiny, printedName: 'Pat Q', dateStr: '', ink });
      const out = await PDFLib.PDFDocument.load(r.pdfBytes);
      const content = out.getPage(0).node.Contents();
      const parts = content instanceof PDFLib.PDFArray ? content.asArray() : [content];
      return parts.map(ref => { const st = out.context.lookup(ref); return Buffer.from(PDFLib.decodePDFRawStream(st).decode()).toString('latin1'); }).join('\n');
    };
    expect(await run('darkred')).toMatch(/0\.4\d* 0\.1\d* 0\.1\d* rg/);
    expect(await run(undefined)).toMatch(/0\.0\d+ 0\.0\d+ 0\.0\d+ rg/);
  });
});
