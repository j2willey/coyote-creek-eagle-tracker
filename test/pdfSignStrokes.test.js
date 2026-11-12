import { describe, it, expect } from 'vitest';
import { serializeInk, parseInk } from '../web/js/pdfStrokes.js';
import { loadSavedSignature } from '../web/js/pdfWorkshop.js';

const pt = (x, y, p = 0, t = 0) => ({ x, y, p, t });
const sample = () => ({ w: 0.01, strokes: [{ points: [pt(0.1, 0.05), pt(0.2, 0.1), pt(0.3, 0.05)] }, { points: [pt(0.15, 0.12)] }] });

describe('a remembered signature may be strokes', () => {
  it('loadSavedSignature carries the strokes JSON through, empty when absent', () => {
    const prev = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    try {
      expect(loadSavedSignature('Pat Q').strokes).toBe('');
      const json = serializeInk(sample());
      store.set('ccacSignature_v1', JSON.stringify({ mode: 'draw', pngDataUrl: '', strokes: json, ink: 'purple' }));
      const saved = loadSavedSignature('Pat Q');
      expect(saved.mode).toBe('draw');
      expect(saved.strokes).toBe(json);
      expect(parseInk(saved.strokes).strokes).toHaveLength(2);
      store.set('ccacSignature_v1', JSON.stringify({ mode: 'draw', strokes: 42 }));
      expect(loadSavedSignature('Pat Q').strokes).toBe('');
    } finally {
      globalThis.localStorage = prev;
    }
  });
});
