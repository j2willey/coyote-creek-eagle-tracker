// @ts-check
/**
 * Pen strokes as data, for signatures (Task 13). Pure functions only (no DOM), so they are unit tested.
 *
 * A signature is an `Ink`: `{ w, strokes }`. Each stroke is `{ points: [{ x, y, p, t }] }`. Coordinates are
 * normalised to the pad: x and y are both measured in units of the pad's WIDTH (so a 900 x 220 pad spans x 0..1 and
 * y 0..0.244, and the shape does not stretch when the pad is resized). `w` is the base line width in the same units.
 * `p` is the pen pressure (0 < p <= 1) or 0 when the device reports none (mouse, finger), and `t` is milliseconds
 * since the stroke began. The signature is drawn from this data at any size and colour (`renderPlan` + `paintInk`),
 * so recolouring or resizing re-renders sharply instead of tinting or scaling a bitmap.
 *
 * @typedef {{ x: number, y: number, p: number, t: number }} InkPoint
 * @typedef {{ points: InkPoint[] }} InkStroke
 * @typedef {{ w: number, strokes: InkStroke[] }} Ink
 * @typedef {{ width: number, height: number, scale: number, offsetX: number, offsetY: number }} RenderPlan
 */

/** Base line width on a fresh pad, in pad-width units (about 1/170 of the pad's width). */
export const DEFAULT_PEN_WIDTH = 0.006;
/** A saved signature's strokes must fit in this many bytes of JSON. */
export const MAX_STORED_INK_BYTES = 50000;
const MAX_STROKES = 60;
const MAX_POINTS = 4000;

const round = (/** @type {number} */ n, /** @type {number} */ d) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };

/**
 * The pressure to keep for a pointer event: the pen's pressure, else 0 (mouse and touch report 0 or a fixed 0.5,
 * which must not make the line vary).
 * @param {{ pointerType?: string, pressure?: number }} ev
 */
export function pressureOf(ev) {
  const p = Number(ev.pressure);
  return ev.pointerType === 'pen' && p > 0 ? Math.min(1, p) : 0;
}

/** Line width for a point: the base, thickened or thinned by pen pressure (constant when `p` is 0). */
export function widthFromPressure(/** @type {number} */ base, /** @type {number} */ p) {
  return p > 0 ? base * (0.55 + 0.9 * Math.min(1, p)) : base; // the same curve as pdfPlan.strokeWidth, unrounded (units are tiny)
}

/**
 * A point in pad-width units from a pad-pixel position.
 * @param {number} px @param {number} py  pixels on the pad
 * @param {number} padWidthPx
 * @param {number} p pressure from `pressureOf`
 * @param {number} t ms since the stroke began
 * @returns {InkPoint}
 */
export function normalizePoint(px, py, padWidthPx, p, t) {
  const d = Math.max(1, padWidthPx);
  return { x: round(px / d, 5), y: round(py / d, 5), p: round(p, 3), t: Math.max(0, Math.round(t)) };
}

/**
 * Draw instructions for one stroke: a dot for a single point, else quadratic curves through the midpoints of the
 * points (the control point is the sample, the ends are midpoints), with a width per segment that follows pressure
 * and is smoothed so a jump does not show as a step.
 * @param {InkStroke} stroke @param {number} base base width
 * @returns {Array<{ kind: 'dot', x: number, y: number, w: number } | { kind: 'curve', x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number }>}
 */
export function strokeSegments(stroke, base) {
  const pts = stroke.points;
  if (!pts.length) return [];
  if (pts.length === 1) return [{ kind: 'dot', x: pts[0].x, y: pts[0].y, w: widthFromPressure(base, pts[0].p) }];
  const mid = (/** @type {InkPoint} */ a, /** @type {InkPoint} */ b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  /** @type {ReturnType<typeof strokeSegments>} */
  const out = [];
  let prevW = widthFromPressure(base, pts[0].p);
  for (let i = 1; i < pts.length; i++) {
    const a = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
    const b = i === pts.length - 1 ? pts[i] : mid(pts[i - 1], pts[i]);
    const w = round((prevW + widthFromPressure(base, pts[i].p)) / 2, 6);
    prevW = w;
    out.push({ kind: /** @type {'curve'} */ ('curve'), x0: a.x, y0: a.y, cx: pts[i - 1].x, cy: pts[i - 1].y, x1: b.x, y1: b.y, w });
  }
  return out;
}

/** True when the ink has at least one point. */
export function hasInk(/** @type {Ink | null | undefined} */ ink) {
  return !!ink && ink.strokes.some(s => s.points.length > 0);
}

/**
 * Bounding box of the ink in pad-width units, grown by half the widest line so thick strokes are not clipped.
 * Null for an empty ink.
 * @param {Ink} ink
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function inkBounds(ink) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxP = 0;
  for (const s of ink.strokes) for (const q of s.points) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
    if (q.p > maxP) maxP = q.p;
  }
  if (!Number.isFinite(minX)) return null;
  const half = widthFromPressure(ink.w, maxP) / 2;
  return { x: minX - half, y: minY - half, width: maxX - minX + 2 * half, height: maxY - minY + 2 * half };
}

/**
 * How to render the ink cropped to its bounding box plus a margin, `targetWidthPx` wide. Null for an empty ink.
 * @param {Ink} ink @param {number} targetWidthPx @param {{ marginRatio?: number }} [opts] margin as a multiple of the base width (default 1.5)
 * @returns {RenderPlan | null}
 */
export function renderPlan(ink, targetWidthPx, opts = {}) {
  const b = inkBounds(ink);
  if (!b) return null;
  const m = ink.w * (opts.marginRatio === undefined ? 1.5 : opts.marginRatio);
  const wUnits = Math.max(1e-6, b.width + 2 * m);
  const hUnits = Math.max(1e-6, b.height + 2 * m);
  const width = Math.max(1, Math.round(targetWidthPx));
  const scale = width / wUnits;
  return { width, height: Math.max(1, Math.round(hUnits * scale)), scale, offsetX: b.x - m, offsetY: b.y - m };
}

/** Width / height of the cropped signature (0 for an empty ink). */
export function inkAspect(/** @type {Ink} */ ink) {
  const plan = renderPlan(ink, 1000);
  return plan ? plan.width / plan.height : 0;
}

/**
 * Paint the ink on a 2D context with a plan from `renderPlan` (or one made for a whole pad: scale = canvas width,
 * offsets 0). Line widths scale with the plan, so the picture is a true vector scaling.
 * @param {{ beginPath: Function, arc: Function, fill: Function, moveTo: Function, quadraticCurveTo: Function, stroke: Function, lineWidth: number, strokeStyle: any, fillStyle: any, lineCap: string, lineJoin: string }} ctx
 * @param {Ink} ink @param {RenderPlan} plan @param {string} color  CSS colour
 */
export function paintInk(ctx, ink, plan, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const X = (/** @type {number} */ x) => (x - plan.offsetX) * plan.scale;
  const Y = (/** @type {number} */ y) => (y - plan.offsetY) * plan.scale;
  for (const s of ink.strokes) {
    for (const g of strokeSegments(s, ink.w)) {
      if (g.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(X(g.x), Y(g.y), (g.w * plan.scale) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = g.w * plan.scale;
        ctx.beginPath();
        ctx.moveTo(X(g.x0), Y(g.y0));
        ctx.quadraticCurveTo(X(g.cx), Y(g.cy), X(g.x1), Y(g.y1));
        ctx.stroke();
      }
    }
  }
}

/**
 * The ink scaled by `f` about the origin (line width included).
 * @param {Ink} ink @param {number} f @returns {Ink}
 */
export function scaleInk(ink, f) {
  return { w: ink.w * f, strokes: ink.strokes.map(s => ({ points: s.points.map(q => ({ ...q, x: round(q.x * f, 5), y: round(q.y * f, 5) })) })) };
}

/**
 * The ink scaled down (never up) and moved so it sits centred in a `maxW` x `maxH` area (pad-width units); used to put
 * a signature made on a big pad onto a small one. Empty ink is returned as is.
 * @param {Ink} ink @param {number} maxW @param {number} maxH @returns {Ink}
 */
export function fitInkInto(ink, maxW, maxH) {
  const b = inkBounds(ink);
  if (!b) return ink;
  const f = Math.min(1, maxW / b.width, maxH / b.height);
  const s = f < 1 ? scaleInk(ink, f) : ink;
  const sb = inkBounds(s);
  if (!sb) return s;
  const dx = (maxW - sb.width) / 2 - sb.x, dy = (maxH - sb.height) / 2 - sb.y;
  return { w: s.w, strokes: s.strokes.map(st => ({ points: st.points.map(q => ({ ...q, x: round(q.x + dx, 5), y: round(q.y + dy, 5) })) })) };
}

/**
 * Drop every other interior point of every stroke (ends kept): the way a too-big signature is thinned for storage.
 * @param {Ink} ink @returns {Ink}
 */
export function thinInk(ink) {
  return { w: ink.w, strokes: ink.strokes.map(s => ({ points: s.points.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 2 === 0) })) };
}

/**
 * JSON for "Remember my signature". Thins the points until it fits `maxBytes`; '' when empty or still too big.
 * @param {Ink | null | undefined} ink @param {number} [maxBytes]
 * @returns {string}
 */
export function serializeInk(ink, maxBytes = MAX_STORED_INK_BYTES) {
  if (!hasInk(ink)) return '';
  let cur = /** @type {Ink} */ (ink);
  for (let i = 0; i < 6; i++) {
    const json = JSON.stringify({ v: 1, w: cur.w, s: cur.strokes.map(s => s.points.map(q => [q.x, q.y, q.p, q.t])) });
    if (json.length <= maxBytes) return json;
    cur = thinInk(cur);
  }
  return '';
}

/**
 * Read `serializeInk` output (or anything from storage): a valid `Ink`, or null for anything malformed.
 * @param {unknown} raw  JSON text
 * @returns {Ink | null}
 */
export function parseInk(raw) {
  try {
    const o = JSON.parse(String(raw || ''));
    if (!o || o.v !== 1 || !Array.isArray(o.s) || !(Number(o.w) > 0) || o.s.length > MAX_STROKES) return null;
    let total = 0;
    /** @type {InkStroke[]} */
    const strokes = [];
    for (const s of o.s) {
      if (!Array.isArray(s)) return null;
      /** @type {InkPoint[]} */
      const points = [];
      for (const q of s) {
        if (!Array.isArray(q)) return null;
        const [x, y, p, t] = q.map(Number);
        if (![x, y].every(Number.isFinite) || Math.abs(x) > 100 || Math.abs(y) > 100) return null;
        points.push({ x, y, p: p > 0 && p <= 1 ? p : 0, t: Number.isFinite(t) && t > 0 ? t : 0 });
      }
      total += points.length;
      if (total > MAX_POINTS) return null;
      if (points.length) strokes.push({ points });
    }
    const ink = { w: Number(o.w), strokes };
    return hasInk(ink) ? ink : null;
  } catch { return null; }
}

/**
 * The pixel width to render a signature at for a placed box: `ratio` x the box in PDF points (3x gives a sharp
 * image on screen and in the PDF), kept between `min` and `max`.
 * @param {number} boxWidthPt @param {{ ratio?: number, min?: number, max?: number }} [opts]
 */
export function pixelWidthForBox(boxWidthPt, opts = {}) {
  const { ratio = 3, min = 600, max = 3000 } = opts;
  const w = Number(boxWidthPt);
  return Math.round(Math.max(min, Math.min(max, (Number.isFinite(w) && w > 0 ? w : 0) * ratio)));
}
