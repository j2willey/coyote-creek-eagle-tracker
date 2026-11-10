import { describe, it, expect } from 'vitest';
import { sortRows, unitKey } from '../web/js/boardSort.js';

const rows = [
  { name: 'A', unit: 'T251', age: 17.9, ebor: '2026-12-07' },
  { name: 'B', unit: 'T41', age: 16.2, ebor: '' },
  { name: 'C', unit: 'C917', age: null, ebor: '2026-10-29' },
  { name: 'D', unit: 'T2019', age: 17.3, ebor: '2026-11-02' },
  { name: 'E', unit: 'T41', age: 17.3, ebor: '2026-11-02' }
];
const names = (l) => l.map(r => r.name).join('');

describe('dashboard sorting (inside a stage)', () => {
  it('arrival: sheet order, or reversed', () => {
    expect(names(sortRows(rows))).toBe('ABCDE');
    expect(names(sortRows(rows, 'arrival', -1))).toBe('EDCBA');
  });
  it('unit: by type, then number (T41 before T251 before T2019)', () => {
    expect(unitKey('T 041')).toEqual(['T', 41]);
    expect(names(sortRows(rows, 'unit', 1))).toBe('CBEAD');
    expect(names(sortRows(rows, 'unit', -1))).toBe('DABEC');   // ties keep sheet order
  });
  it('age: numeric, empty ages last either way', () => {
    expect(names(sortRows(rows, 'age', 1))).toBe('BDEAC');
    expect(names(sortRows(rows, 'age', -1))).toBe('ADEBC');
  });
  it('dates: empty last either way', () => {
    expect(names(sortRows(rows, 'ebor', 1))).toBe('CDEAB');
    expect(names(sortRows(rows, 'ebor', -1))).toBe('ADECB');
  });
  it('does not change the input', () => {
    const copy = rows.slice();
    sortRows(rows, 'age', -1);
    expect(rows).toEqual(copy);
  });
});

describe('dashboard sorting by session', () => {
  it('earliest session first; rows without one last', () => {
    const r = [{ name: 'A', session: { start: 300 } }, { name: 'B', session: null }, { name: 'C', session: { start: 100 } }];
    expect(names(sortRows(r, 'session', 1))).toBe('CAB');
    expect(names(sortRows(r, 'session', -1))).toBe('ACB');
  });
});

describe('dashboard default order per stage (2026-11-04)', () => {
  const r = [{ name: 'A', session: { start: 300 } }, { name: 'B', session: null }, { name: 'C', session: { start: 100 } }];
  it('Booked stages: soonest session first; others: sheet order; a heading click overrides', async () => {
    const { stageRows } = await import('../web/js/boardSort.js');
    expect(names(stageRows(r, 'review_booked'))).toBe('CAB');
    expect(names(stageRows(r, 'intake_booked'))).toBe('CAB');
    expect(names(stageRows(r, 'proposal_incomplete'))).toBe('ABC');
    expect(names(stageRows(r, 'review_booked', 'arrival', -1))).toBe('CBA');
  });
});
