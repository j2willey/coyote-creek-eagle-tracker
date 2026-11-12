import { describe, it, expect } from 'vitest';
import { clampZoom, stepZoom, zoomLabel, ZOOM_MIN, ZOOM_MAX } from '../web/js/pdfZoom.js';

describe('pdfZoom', () => {
  it('clamps to the range and rounds', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(1.333)).toBe(1.33);
    expect(clampZoom(NaN)).toBe(1);
  });
  it('steps to the next step up or down, also from between steps', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(stepZoom(1.4, 1)).toBe(1.5);
    expect(stepZoom(1.4, -1)).toBe(1.25);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
  it('labels as a percentage', () => {
    expect(zoomLabel(1.5)).toBe('150%');
  });
});
