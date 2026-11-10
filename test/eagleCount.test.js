import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EC = require('../apps-script/src/lib/eagleCount.js');
const UD = require('../apps-script/src/lib/unitDirectory.js');

describe('Eagles to Date (2026-11-01)', () => {
  it('blank is unknown, 0 is a count', () => {
    expect(EC.parseCount('')).toBeNull();
    expect(EC.parseCount('0')).toBe(0);
    expect(EC.parseCount('1,204')).toBe(1204);
    expect(EC.parseCount('about 100')).toBeNull();
    expect(UD.validateEagles('')).toEqual({ ok: true, clean: '' });
    expect(UD.validateEagles('0110')).toEqual({ ok: true, clean: '110' });
    expect(UD.validateEagles('lots').ok).toBe(false);
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 101, 102, 103, 110, 111, 112, 113].map(EC.ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '101st', '102nd', '103rd', '110th', '111th', '112th', '113th']);
  });
  it('email line: one unit, several units, no count', () => {
    expect(EC.emailLine([{ code: 't910', n: 110 }])).toBe('You are the 110th Eagle Scout of Troop 910!');
    expect(EC.emailLine([{ code: 'c967', n: 12 }, { code: 't911', n: 41 }])).toBe('You are the 12th Eagle Scout of Crew 967 and the 41st of Troop 911!');
    expect(EC.emailLine([])).toBe('');
    expect(EC.emailLine([{ code: 'c967', n: 12 }, { code: 't911', n: 41 }, { code: 's905', n: 3 }]))
      .toBe('You are the 12th Eagle Scout of Crew 967, the 41st of Troop 911 and the 3rd of Ship 905!');
  });
  it('forecast: count + 1, then + 1 per earlier pending board of the same unit; unknown counts skipped', () => {
    const pending = [
      { recordId: 'R-2', unit: 'T910', start: 2000 },
      { recordId: 'R-1', unit: 'T910', start: 1000 },
      { recordId: 'R-3', unit: 'C967 T911', start: 1500 },
      { recordId: 'R-4', unit: 'T41', start: 1000 }];
    const f = EC.forecast(pending, { t910: 109, c967: 11, t911: null });
    expect(f['R-1']).toEqual([{ code: 't910', n: 110, guess: true }]);
    expect(f['R-2']).toEqual([{ code: 't910', n: 111, guess: true }]);
    expect(f['R-3']).toEqual([{ code: 'c967', n: 12, guess: false }]);
    expect(f['R-4']).toEqual([]);
    expect(EC.announce(f['R-3'])).toBe('12th Eagle Scout of Crew 967');
    expect(EC.announce(f['R-2'])).toMatch(/^111th Eagle Scout of Troop 910 \(best guess: another Troop 910 board is pending/);
  });
  it('this calendar year, per unit (every listed unit)', () => {
    const recs = [{ section: 'eagle_earned', unit: 'T910', ebor: '2026-03-01' }, { section: 'eagle_earned', unit: 'C967 T910', ebor: '2026-10-01' },
      { section: 'eagle_earned', unit: 'T910', ebor: '2025-12-01' }, { section: 'ebor_booked', unit: 'T910', ebor: '2026-11-20' }];
    expect(EC.yearCounts(recs, 2026)).toEqual({ t910: 2, c967: 1 });
  });
});
