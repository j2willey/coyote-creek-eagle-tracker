import { describe, it, expect } from 'vitest';
import { encodeWithin, PHOTO_STEPS, PHOTO_MAX_BYTES, MAX_PHOTOS } from '../web/js/photos.js';

// A fake encoder: a data URL whose payload decodes to `size(edge, quality)` bytes.
const fake = (size) => async (edge, quality) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(size(edge, quality) * 4 / 3));

describe('EBoR photo size (2026-11-17: 12 photos must stay well under the 8 MB group limit)', () => {
  it('12 photos at the cap, base64-encoded in an email, stay under ~5.5 MB', () => {
    expect(MAX_PHOTOS).toBe(12);
    expect(MAX_PHOTOS * PHOTO_MAX_BYTES * 4 / 3).toBeLessThan(5.5 * 1024 * 1024);
  });
  it('takes the first step that fits', async () => {
    const r = await encodeWithin(fake(() => 250 * 1024));
    expect(r).toMatchObject({ edge: 1600, quality: 0.8 });
    expect(r.bytes).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
  });
  it('steps quality down, then size', async () => {
    const tried = [];
    const r = await encodeWithin(async (e, q) => { tried.push([e, q]); return fake(() => (e === 1600 ? 500 : q >= 0.7 ? 300 : 200) * 1024)(e, q); });
    expect(r).toMatchObject({ edge: 1280, quality: 0.7 });
    expect(tried).toEqual([[1600, 0.8], [1600, 0.7], [1280, 0.7]]);
  });
  it('a photo that never fits uses the smallest step', async () => {
    const r = await encodeWithin(fake(() => 900 * 1024));
    const last = PHOTO_STEPS[PHOTO_STEPS.length - 1];
    expect(r).toMatchObject({ edge: last.edge, quality: last.quality });
  });
});
