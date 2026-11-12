// @ts-check
/**
 * The signature draw pad, shared by the Sign Workshop and the EBoR paperwork page (Task 12).
 *
 * Built for a cheap tablet as well as a mouse: pointer events with `touch-action: none` (the page does not scroll or
 * zoom under the pen), one pointer draws at a time (a second finger or a resting palm is ignored, see
 * `acceptPadPointer`), strokes are smoothed (quadratic curves through the midpoints, coalesced events when the browser
 * has them), a stylus's pressure thickens the line, and Undo / Clear work stroke by stroke. Strokes are kept as points
 * and redrawn, so changing the ink colour recolours what is already drawn.
 */
import { acceptPadPointer, strokeWidth, inkHex, DEFAULT_INK } from './pdfPlan.js';
import { canvasToTrimmedPngDataUrl } from './pdfInk.js';

/**
 * @typedef {Object} PadPoint
 * @property {number} x
 * @property {number} y
 * @property {number} w  line width at this point (canvas px)
 *
 * @typedef {Object} DrawPad
 * @property {() => void} clear
 * @property {() => void} undo
 * @property {() => boolean} hasInk
 * @property {() => string} toPngDataUrl  trimmed to the ink; '' when empty
 * @property {() => void} redraw  after the ink colour changed
 * @property {() => void} destroy
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ getInk?: () => string, lineWidth?: number, onChange?: () => void }} [opts]
 * @returns {DrawPad}
 */
export function createDrawPad(canvas, opts = {}) {
  const getInk = opts.getInk || (() => DEFAULT_INK);
  const baseWidth = opts.lineWidth || Math.max(2.5, canvas.width / 170);
  const ctx = canvas.getContext('2d');
  /** @type {PadPoint[][]} */
  let strokes = [];
  /** @type {PadPoint[] | null} */
  let current = null;
  /** @type {number | null} */
  let activeId = null;
  let lastPenMs = 0;

  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.setProperty('-webkit-user-select', 'none');
  canvas.style.setProperty('-webkit-touch-callout', 'none');

  const mid = (/** @type {PadPoint} */ a, /** @type {PadPoint} */ b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  /** Draw one stroke: dots for a tap, else quadratic curves through the midpoints (width per segment). */
  function paintStroke(/** @type {PadPoint[]} */ pts) {
    if (!ctx || !pts.length) return;
    ctx.strokeStyle = inkHex(getInk());
    ctx.fillStyle = inkHex(getInk());
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
      const b = i === pts.length - 1 ? pts[i] : mid(pts[i - 1], pts[i]);
      ctx.lineWidth = pts[i].w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, b.x, b.y);
      ctx.stroke();
    }
  }

  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) paintStroke(s);
    if (current) paintStroke(current);
  }

  function changed() { if (opts.onChange) opts.onChange(); }

  function coords(/** @type {PointerEvent} */ ev, /** @type {string} */ type) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / Math.max(1, r.width)) * canvas.width,
      y: ((ev.clientY - r.top) / Math.max(1, r.height)) * canvas.height,
      w: strokeWidth(baseWidth, ev.pressure, type)
    };
  }

  function addPoint(/** @type {PointerEvent} */ ev) {
    if (!current) return;
    const pt = coords(ev, ev.pointerType);
    const last = current[current.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.8) return;
    // Light smoothing of the width so a pressure jump does not show as a step.
    if (last) pt.w = Math.round((last.w * 0.5 + pt.w * 0.5) * 100) / 100;
    current.push(pt);
  }

  const onDown = (/** @type {PointerEvent} */ ev) => {
    if (ev.pointerType === 'pen') lastPenMs = Date.now();
    if (!acceptPadPointer(ev, { activePointerId: activeId, lastPenMs, nowMs: Date.now() })) { ev.preventDefault(); return; }
    ev.preventDefault();
    activeId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not capturable: fine */ }
    current = [coords(ev, ev.pointerType)];
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
    if (current && current.length) { strokes.push(current); }
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
    toPngDataUrl: () => (strokes.length ? canvasToTrimmedPngDataUrl(canvas) : ''),
    redraw,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
      canvas.removeEventListener('contextmenu', noMenu);
    }
  };
}
