import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Stamps = require('../apps-script/src/lib/stamps.js');

describe('Stamps: which Drive files are stamps', () => {
  it('lists PNG files up to 2 MB, sorted by name; other types are ignored; big PNGs are reported as skipped', () => {
    const files = [
      { id: 'b', name: 'Reviewed.png', mime: 'image/png', bytes: 90000 },
      { id: 'a', name: 'approved.PNG', mime: '', bytes: 120000 },
      { id: 'c', name: 'Huge.png', mime: 'image/png', bytes: 3 * 1024 * 1024 },
      { id: 'd', name: 'notes.pdf', mime: 'application/pdf', bytes: 1000 },
      { id: 'e', name: 'photo.jpg', mime: 'image/jpeg', bytes: 1000 },
      { id: 'f', name: 'renamed-no-extension', mime: 'image/png', bytes: 500 },
      { id: '', name: 'ghost.png', mime: 'image/png', bytes: 1 }
    ];
    const out = Stamps.list(files);
    expect(out.stamps).toEqual([
      { id: 'a', name: 'approved.PNG', bytes: 120000 },
      { id: 'f', name: 'renamed-no-extension', bytes: 500 },
      { id: 'b', name: 'Reviewed.png', bytes: 90000 }
    ]);
    expect(out.skipped).toEqual([{ name: 'Huge.png', bytes: 3 * 1024 * 1024 }]);
    expect(Stamps.sizeText(3 * 1024 * 1024)).toBe('3 MB');
  });

  it('exactly 2 MB is allowed; handles empty input', () => {
    expect(Stamps.list([{ id: 'x', name: 's.png', bytes: Stamps.MAX_BYTES }]).stamps).toHaveLength(1);
    expect(Stamps.list(undefined)).toEqual({ stamps: [], skipped: [] });
  });

  it('checks the PNG signature of the bytes', () => {
    const png = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0];
    expect(Stamps.isPngBytes(png)).toBe(true);
    expect(Stamps.isPngBytes([37, 80, 68, 70, 45, 49, 46, 52])).toBe(false);
    expect(Stamps.isPngBytes([])).toBe(false);
    // Apps Script bytes are signed (-119 = 0x89)
    expect(Stamps.isPngBytes([-119, 80, 78, 71, 13, 10, 26, 10])).toBe(true);
  });
});
