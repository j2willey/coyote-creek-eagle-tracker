// @ts-check
/**
 * The pen pad engine, shared by the signing overlay (`pdfSignPad.js`), the Sign Workshop's small Draw tab and the
 * EBoR paperwork page's dialog (Task 12, reworked in Task 13).
 *
 * Built for a cheap tablet as well as a mouse: pointer events with `touch-action: none` (the page does not scroll or
 * zoom under the pen), one pointer draws at a time (a second finger or a resting palm is ignored, see
 * `acceptPadPointer`), coalesced events give smooth curves, a pen's pressure varies the line, and Undo / Clear work
 * stroke by stroke. What is drawn is kept as DATA (`Ink` in `pdfStrokes.js`: points normalised to the pad width) and
 * painted from it, so a new ink colour, a new canvas size or a different output size all re-render sharply.
 */
import { acceptPadPointer, inkHex, DEFAULT_INK } from './pdfPlan.js';
import { inkToPngDataUrl } from './pdfInk.js';
import { DEFAULT_PEN_WIDTH, hasInk as inkHasInk, normalizePoint, pressureOf, paintInk } from './pdfStrokes.js';

/**
 * @typedef {import('./pdfStrokes.js').Ink} Ink
 * @typedef {import('./pdfStrokes.js').InkPoint} InkPoint
 *
 * @typedef {Object} DrawPad
 * @property {() => void} clear
 * @property {() => void} undo
 * @property {() => boolean} hasInk
 * @property {() => Ink | null} getInk  a copy of the strokes; null when empty
 * @property {(ink: Ink | null) => void} setInk  replace the strokes (e.g. a signature made on a bigger pad)
 * @property {() => string} toPngDataUrl  trimmed to the ink, as wide as the canvas; '' when empty
 * @property {() => void} redraw  after the ink colour changed
 * @property {() => void} fit  after the canvas's CSS size changed: match the pixel size to it (x device pixel ratio)
 * @property {() => void} destroy
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ getInk?: () => string, penWidth?: number, onChange?: () => void }} [opts]
 *   `getInk` returns the ink colour key; `penWidth` is the base line width in pad-width units.
 * @returns {DrawPad}
 */
export function createDrawPad(canvas, opts = {}) {
  const getInk = opts.getInk || (() => DEFAULT_INK);
  let base = opts.penWidth || DEFAULT_PEN_WIDTH;
  const ctx = canvas.getContext('2d');
  /** @type {InkPoint[][]} */
  let strokes = [];
  /** @type {InkPoint[] | null} */
  let current = null;
  let startMs = 0;
  /** @type {number | null} */
  let activeId = null;
  let lastPenMs = 0;

  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.setProperty('-webkit-user-select', 'none');
  canvas.style.setProperty('-webkit-touch-callout', 'none');

  const asInk = (/** @type {InkPoint[][]} */ list) => ({ w: base, strokes: list.map(points => ({ points })) });

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = current ? [...strokes, current] : strokes;
    if (!all.length) return;
    paintInk(ctx, asInk(all), { width: canvas.width, height: canvas.height, scale: canvas.width, offsetX: 0, offsetY: 0 }, inkHex(getInk()));
  }

  function changed() { if (opts.onChange) opts.onChange(); }

  function pointOf(/** @type {PointerEvent} */ ev) {
    const r = canvas.getBoundingClientRect();
    return normalizePoint(ev.clientX - r.left, ev.clientY - r.top, r.width, pressureOf(ev), ev.timeStamp - startMs);
  }

  function addPoint(/** @type {PointerEvent} */ ev) {
    if (!current) return;
    const pt = pointOf(ev);
    const last = current[current.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.0008) return;
    current.push(pt);
  }

  const onDown = (/** @type {PointerEvent} */ ev) => {
    if (ev.pointerType === 'pen') lastPenMs = Date.now();
    if (!acceptPadPointer(ev, { activePointerId: activeId, lastPenMs, nowMs: Date.now() })) { ev.preventDefault(); return; }
    ev.preventDefault();
    activeId = ev.pointerId;
    startMs = ev.timeStamp;
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not capturable: fine */ }
    current = [pointOf(ev)];
    redraw();
  };
  const onMove = (/** @type {PointerEvent} */ ev) => {
    if (ev.pointerId !== activeId || !current) return;
    ev.preventDefault();
    const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    if (list && list.length) list.forEach(addPoint); else addPoint(ev);
    redraw();
  };
  const onEnd = (/** @type {PointerEvent} */ ev) => {
    if (ev.pointerId !== activeId) return;
    activeId = null;
    if (current && current.length) strokes.push(current);
    current = null;
    redraw();
    changed();
  };
  const noMenu = (/** @type {Event} */ ev) => ev.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  canvas.addEventListener('contextmenu', noMenu);

  return {
    clear() { strokes = []; current = null; activeId = null; redraw(); changed(); },
    undo() { if (!strokes.length) return; strokes.pop(); redraw(); changed(); },
    hasInk: () => strokes.length > 0,
    getInk: () => (strokes.length ? JSON.parse(JSON.stringify(asInk(strokes))) : null),
    setInk(ink) {
      current = null; activeId = null;
      strokes = ink && inkHasInk(ink) ? ink.strokes.map(s => s.points.map(q => ({ ...q }))) : [];
      if (ink && inkHasInk(ink)) base = ink.w;
      redraw();
    },
    toPngDataUrl: () => (strokes.length ? inkToPngDataUrl(asInk(strokes), getInk(), canvas.width) : ''),
    redraw,
    fit() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      if (r.width < 2 || r.height < 2) return;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      redraw();
    },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
      canvas.removeEventListener('contextmenu', noMenu);
    }
  };
}
