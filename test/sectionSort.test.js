import { describe, it, expect } from 'vitest';
import S from '../apps-script/src/lib/sectionSort.js';

describe('SectionSort (EBoR Booked by EBoR Date)', () => {
  const rows = [{ key: 'A', date: new Date(2026, 10, 2) }, { key: 'B', date: '' }, { key: 'C', date: new Date(2027, 0, 11) },
    { key: 'D', date: '12/07/26' }, { key: '#9', date: '', blank: true }, { key: 'E', date: new Date(2026, 9, 26) }];
  it('no date first, then latest to earliest, empty rows last', () => {
    expect(S.latestFirst(rows)).toEqual(['B', 'C', 'D', 'A', 'E', '#9']);
  });
  it('moves reproduce the wanted order like Sheet.moveRows', () => {
    const cur = rows.map(r => r.key), want = S.latestFirst(rows);
    const sim = cur.slice();
    S.moves(cur, want).forEach(m => { expect(sim.indexOf(m.key)).toBe(m.from); sim.splice(m.from, 1); sim.splice(m.to, 0, m.key); });
    expect(sim).toEqual(want);
    expect(S.moves(want, want)).toEqual([]);
  });
});
