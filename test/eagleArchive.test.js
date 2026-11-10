import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EA = require('../apps-script/src/lib/eagleArchive.js');

const TRACK = ['_key', 'action', 'scout_name', 'unit', 'age', 'approved_date', 'ebor_date', 'notes', '_folder_id', '_closed'];

describe('mapColumns', () => {
  it('matches by machine name regardless of order, case and spacing', () => {
    const arch = ['Notes', 'EBoR_Date', 'scout_name ', '_key', 'unit', 'Age', 'action', 'Approved_Date', '_folder_id', 'old_col'];
    const m = EA.mapColumns(TRACK, arch);
    const at = n => m.pairs.find(p => p.name === n);
    expect(at('scout_name')).toMatchObject({ from: 2, to: 2 });
    expect(at('ebor_date')).toMatchObject({ from: 6, to: 1 });
    expect(at('notes')).toMatchObject({ from: 7, to: 0 });
    expect(m.keyFrom).toBe(0); expect(m.keyTo).toBe(3);
  });
  it('lists tracking-only columns as added at the right end, in tracking order, and archive-only columns', () => {
    const arch = ['_key', 'scout_name', 'unit', 'old_col', 'notes'];
    const m = EA.mapColumns(TRACK, arch);
    expect(m.added).toEqual(['age', 'approved_date', 'ebor_date', '_folder_id', '_closed']);
    expect(m.pairs.filter(p => p.added).map(p => p.to)).toEqual([5, 6, 7, 8, 9]);
    expect(m.archiveOnly).toEqual(['old_col']);
    expect(m.archiveWidth).toBe(10);
  });
  it('never copies the Action column, and does not add it when the archive lacks it', () => {
    const m = EA.mapColumns(TRACK, ['_key', 'scout_name', 'action']);
    expect(m.pairs.some(p => p.name === 'action')).toBe(false);
    expect(m.added).not.toContain('action');
    expect(m.archiveOnly).toEqual([]);
  });
  it('needs _key on both sides and unique names', () => {
    expect(() => EA.mapColumns(TRACK, ['scout_name'])).toThrow(/archive tab has no _key/);
    expect(() => EA.mapColumns(['scout_name'], ['_key'])).toThrow(/tracking tab has no _key/);
    expect(() => EA.mapColumns(TRACK, ['_key', 'Unit', 'unit'])).toThrow(/twice/);
  });
});

describe('year labels and placement', () => {
  it('reads both the S:eagles_<year> key and the text of an older label row', () => {
    expect(EA.yearOfLabel('S:eagles_2025', '')).toBe('2025');
    expect(EA.yearOfLabel('', '2024 Eagles')).toBe('2024');
    expect(EA.yearOfLabel('S:eagle_earned', '2023 Eagles')).toBe('2023');
    expect(EA.yearOfLabel('R-2610111530-K7Q', '2023 Eagles')).toBeNull();
    expect(EA.yearOfLabel('', 'Eagle Earned')).toBeNull();
    expect(EA.labelText(2025)).toBe('2025 Eagles');
    expect(EA.labelKey(2025)).toBe('S:eagles_2025');
  });
  const keys = ['', '_key', '', '', '', 'S:eagles_2025', 'R-1', 'R-2', '', '', 'R-3', 'S:eagles_2020', 'R-4'];
  const texts = ['', '', '', '', '', '2025 Eagles', 'a', 'b', '', '2024 Eagles', 'c', '2020 Eagles', 'd'];
  it('puts a new year above the newest older label (below the header and filter rows)', () => {
    const p = EA.placement(keys, texts, 4, 2026);
    expect(p).toMatchObject({ existing: -1, insertAt: 5 });
    expect(EA.placement(keys, texts, 4, 2022).insertAt).toBe(11);
  });
  it('joins an existing year section under its label', () => {
    expect(EA.placement(keys, texts, 4, 2024)).toMatchObject({ existing: 9, insertAt: 10 });
  });
  it('goes to the end when there is no older year, and below the header rows on an empty tab', () => {
    expect(EA.placement(keys, texts, 4, 2019).insertAt).toBe(keys.length);
    expect(EA.placement(['', '_key', '', ''], ['', '', '', ''], 4, 2025).insertAt).toBe(4);
  });
  it('ignores label-looking rows above the first free row', () => {
    expect(EA.placement(['S:eagles_2030', '_key'], ['', ''], 4, 2025).labels).toHaveLength(0);
  });
});

describe('ids, order, runs', () => {
  it('splits ids already on the archive from those to add (idempotent)', () => {
    const s = EA.split(['', 'S:eagles_2025', 'R-1', 'R-3'], ['R-1', 'R-2', 'R-3']);
    expect(s.present).toEqual(['R-1', 'R-3']); expect(s.todo).toEqual(['R-2']);
    expect(EA.missing(['R-1', 'R-2'], ['R-1', 'R-2'])).toEqual([]);
    expect(EA.missing(['R-1'], ['R-1', 'R-2'])).toEqual(['R-2']);
  });
  it('orders by EBoR date, latest first, no date last, ties keep their order', () => {
    expect(EA.order([{ id: 'a', ebor: '2025-03-01' }, { id: 'b', ebor: '2025-11-02' }, { id: 'c', ebor: '' },
      { id: 'd', ebor: '2025-03-01' }, { id: 'e', ebor: '2025-06-30' }])).toEqual(['b', 'e', 'a', 'd', 'c']);
  });
  it('makes runs of consecutive source rows', () => {
    expect(EA.runs([10, 11, 12, 5, 6, 20])).toEqual([{ from: 10, offset: 0, len: 3 }, { from: 5, offset: 3, len: 2 }, { from: 20, offset: 5, len: 1 }]);
    expect(EA.runs([])).toEqual([]);
  });
  it('reports for the dry run', () => {
    const m = EA.mapColumns(TRACK, ['_key', 'scout_name', 'old']);
    const r = EA.report(2025, ['A (T999)'], m, true, EA.split([], ['R-1']));
    expect(r).toMatchObject({ year: '2025', label: '2025 Eagles', tab: true, alreadyThere: 0, archiveOnly: ['old'] });
    expect(r.added).toContain('ebor_date');
    expect(EA.tabName('')).toBe('Eagle Archive'); expect(EA.tabName(' Old Eagles ')).toBe('Old Eagles');
  });
});
