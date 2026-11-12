import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEN_WIDTH, pressureOf, widthFromPressure, normalizePoint, strokeSegments, hasInk, inkBounds, renderPlan,
  inkAspect, paintInk, scaleInk, fitInkInto, thinInk, serializeInk, parseInk, pixelWidthForBox
} from '../web/js/pdfStrokes.js';

const pt = (x, y, p = 0, t = 0) => ({ x, y, p, t });
const ink = (...strokes) => ({ w: 0.01, strokes: strokes.map(points => ({ points })) });
const sample = () => ink([pt(0.1, 0.05), pt(0.2, 0.1), pt(0.3, 0.05)], [pt(0.15, 0.12)]);

describe('pressure and width (Task 13)', () => {
  it('keeps only a pen pressure', () => {
    expect(pressureOf({ pointerType: 'pen', pressure: 0.4 })).toBe(0.4);
    expect(pressureOf({ pointerType: 'pen', pressure: 0 })).toBe(0);
    expect(pressureOf({ pointerType: 'mouse', pressure: 0.5 })).toBe(0);
    expect(pressureOf({ pointerType: 'touch', pressure: 0.5 })).toBe(0);
    expect(pressureOf({ pointerType: 'pen', pressure: 7 })).toBe(1);
  });
  it('varies with pressure but is constant without it', () => {
    const base = 0.01;
    expect(widthFromPressure(base, 0)).toBe(base);
    expect(widthFromPressure(base, 0.1)).toBeLessThan(widthFromPressure(base, 0.9));
    expect(widthFromPressure(base, 1)).toBeGreaterThan(base);
  });
});

describe('normalising points', () => {
  it('divides by the pad width in both axes and rounds', () => {
    expect(normalizePoint(450, 110, 900, 0.5, 12.4)).toEqual({ x: 0.5, y: 0.12222, p: 0.5, t: 12 });
    expect(normalizePoint(10, 10, 0, 0, -5)).toEqual({ x: 10, y: 10, p: 0, t: 0 });
  });
});

describe('smoothing and path generation', () => {
  it('draws a dot for one point and nothing for none', () => {
    expect(strokeSegments({ points: [] }, 0.01)).toEqual([]);
    expect(strokeSegments({ points: [pt(0.1, 0.1)] }, 0.01)).toEqual([{ kind: 'dot', x: 0.1, y: 0.1, w: 0.01 }]);
  });
  it('curves through midpoints: starts at the first point, ends at the last, controls are the samples', () => {
    const segs = strokeSegments({ points: [pt(0, 0), pt(0.2, 0), pt(0.4, 0.2), pt(0.6, 0.2)] }, 0.01);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ kind: 'curve', x0: 0, y0: 0, cx: 0, cy: 0, x1: 0.1, y1: 0 });
    expect(segs[1].x0).toBeCloseTo(0.1, 9);
    expect(segs[1].cx).toBe(0.2);
    expect(segs[1].x1).toBeCloseTo(0.3, 9);
    expect(segs[1].y1).toBeCloseTo(0.1, 9);
    expect(segs[2]).toMatchObject({ x1: 0.6, y1: 0.2 });
  });
  it('smooths a pressure jump over segments', () => {
    const segs = strokeSegments({ points: [pt(0, 0, 0.1), pt(0.1, 0, 0.1), pt(0.2, 0, 1), pt(0.3, 0, 1)] }, 0.01);
    const ws = segs.map(s => s.w);
    expect(ws[1]).toBeGreaterThan(ws[0]);
    expect(ws[2]).toBeGreaterThan(ws[1]);
    expect(ws[2]).toBeLessThan(widthFromPressure(0.01, 1));
  });
});

describe('bounds, plan and aspect', () => {
  it('has no bounds for empty ink', () => {
    expect(hasInk(ink())).toBe(false);
    expect(hasInk(null)).toBe(false);
    expect(inkBounds(ink([]))).toBeNull();
    expect(renderPlan(ink(), 800)).toBeNull();
    expect(inkAspect(ink())).toBe(0);
  });
  it('bounds the points grown by half a line', () => {
    const b = inkBounds(ink([pt(0.1, 0.2), pt(0.5, 0.3)]));
    expect(b.x).toBeCloseTo(0.095, 6);
    expect(b.y).toBeCloseTo(0.195, 6);
    expect(b.width).toBeCloseTo(0.41, 6);
    expect(b.height).toBeCloseTo(0.11, 6);
  });
  it('plans a crop with margin at the target width', () => {
    const i = ink([pt(0.1, 0.2), pt(0.5, 0.3)]);
    const plan = renderPlan(i, 1000);
    expect(plan.width).toBe(1000);
    expect(plan.offsetX).toBeCloseTo(0.095 - 0.015, 6);
    expect(plan.height).toBe(Math.round(((0.11 + 0.03) / (0.41 + 0.03)) * 1000));
    expect(inkAspect(i)).toBeCloseTo(plan.width / plan.height, 6);
  });
  it('keeps the aspect whatever the size (a true vector scaling)', () => {
    const i = sample();
    const a = renderPlan(i, 500), b = renderPlan(i, 2000);
    expect(b.scale / a.scale).toBeCloseTo(4, 6);
    expect(b.width / b.height).toBeCloseTo(a.width / a.height, 2);
  });
});

describe('painting', () => {
  const fakeCtx = () => {
    const calls = [];
    const rec = name => (...a) => calls.push([name, ...a]);
    return { calls, beginPath: rec('begin'), arc: rec('arc'), fill: rec('fill'), moveTo: rec('move'), quadraticCurveTo: rec('quad'), stroke: rec('stroke'),
      lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: '', lineJoin: '' };
  };
  it('paints in the colour given and scales widths with the plan', () => {
    const i = sample();
    const c1 = fakeCtx(), c2 = fakeCtx();
    const p1 = renderPlan(i, 500), p2 = renderPlan(i, 1000);
    paintInk(c1, i, p1, '#112233');
    paintInk(c2, i, p2, '#aa0000');
    expect(c1.strokeStyle).toBe('#112233');
    expect(c2.fillStyle).toBe('#aa0000');
    expect(c1.calls.filter(c => c[0] === 'quad')).toHaveLength(2);
    expect(c1.calls.filter(c => c[0] === 'arc')).toHaveLength(1);
    const move1 = c1.calls.find(c => c[0] === 'move'), move2 = c2.calls.find(c => c[0] === 'move');
    expect(move2[1] / move1[1]).toBeCloseTo(2, 6);
    const arc1 = c1.calls.find(c => c[0] === 'arc'), arc2 = c2.calls.find(c => c[0] === 'arc');
    expect(arc2[3] / arc1[3]).toBeCloseTo(2, 6);
  });
});

describe('scaling and fitting', () => {
  it('scales points and line width together', () => {
    const s = scaleInk(sample(), 0.5);
    expect(s.w).toBeCloseTo(0.005, 9);
    expect(s.strokes[0].points[1]).toMatchObject({ x: 0.1, y: 0.05 });
  });
  it('fits a big signature into a small pad, centred, never enlarging', () => {
    const big = ink([pt(0.1, 0.1), pt(0.9, 0.5)]);
    const f = fitInkInto(big, 1, 0.244);
    const b = inkBounds(f);
    expect(b.height).toBeLessThanOrEqual(0.244 + 1e-4);
    expect(b.x + b.width / 2).toBeCloseTo(0.5, 3);
    expect(b.y + b.height / 2).toBeCloseTo(0.122, 3);
    const small = ink([pt(0.4, 0.1), pt(0.5, 0.12)]);
    expect(fitInkInto(small, 1, 0.244).w).toBe(small.w);
    expect(fitInkInto(ink(), 1, 1).strokes).toEqual([]);
  });
});

describe('storing strokes (Remember my signature)', () => {
  it('round-trips', () => {
    const i = sample();
    const back = parseInk(serializeInk(i));
    expect(back.w).toBe(i.w);
    expect(back.strokes).toHaveLength(2);
    expect(back.strokes[0].points[1]).toEqual(i.strokes[0].points[1]);
  });
  it('is empty for empty ink and thins a big one to fit the cap', () => {
    expect(serializeInk(ink())).toBe('');
    const pts = Array.from({ length: 3000 }, (_, k) => pt(k / 3000, Math.sin(k / 40) * 0.05 + 0.1, 0.5, k * 7));
    const big = ink(pts);
    const json = serializeInk(big);
    expect(json.length).toBeGreaterThan(0);
    expect(json.length).toBeLessThanOrEqual(50000);
    expect(parseInk(json).strokes[0].points.length).toBeLessThan(3000);
    expect(thinInk(big).strokes[0].points.at(-1)).toEqual(pts.at(-1));
  });
  it('gives up when even thinning cannot fit', () => {
    expect(serializeInk(sample(), 10)).toBe('');
  });
  it('rejects anything malformed', () => {
    for (const bad of ['', 'nope', '{}', '{"v":2,"w":0.01,"s":[]}', '{"v":1,"w":0,"s":[[[0,0,0,0]]]}', '{"v":1,"w":0.01,"s":[[["a",0,0,0]]]}',
      '{"v":1,"w":0.01,"s":[[[1e9,0,0,0]]]}', '{"v":1,"w":0.01,"s":[]}', '{"v":1,"w":0.01,"s":[5]}']) {
      expect(parseInk(bad)).toBeNull();
    }
  });
});

describe('render resolution', () => {
  it('is 3x the box in points, within limits', () => {
    expect(pixelWidthForBox(126)).toBe(600);
    expect(pixelWidthForBox(300)).toBe(900);
    expect(pixelWidthForBox(5000)).toBe(3000);
    expect(pixelWidthForBox(NaN)).toBe(600);
  });
  it('has a sensible default pen width', () => {
    expect(DEFAULT_PEN_WIDTH).toBeGreaterThan(0.002);
    expect(DEFAULT_PEN_WIDTH).toBeLessThan(0.02);
  });
});
