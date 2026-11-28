import { describe, it, expect } from 'vitest';
import { sortTable, filterRows, cellKey, unitCode } from '../web/js/tableSort.js';

const col = (rows, i = 0) => rows.map(r => r[i]);

describe('tableSort (Units page sheet tables, 2026-11-28)', () => {
  it('dates in date order, with times; empty last both ways', () => {
    const rows = [['11/23/2026 14:05:00'], [''], ['1/4/2027'], ['11/23/2026 9:30:00'], ['2026-10-01']];
    expect(col(sortTable(rows, 0, 1))).toEqual(['2026-10-01', '11/23/2026 9:30:00', '11/23/2026 14:05:00', '1/4/2027', '']);
    expect(col(sortTable(rows, 0, -1))).toEqual(['1/4/2027', '11/23/2026 14:05:00', '11/23/2026 9:30:00', '2026-10-01', '']);
  });
  it('times of day, weekdays and numbers in their own order', () => {
    expect(col(sortTable([['7:30 PM'], ['10:00 AM'], ['7:00 PM'], ['19:15']], 0))).toEqual(['10:00 AM', '7:00 PM', '19:15', '7:30 PM']);
    expect(col(sortTable([['Sunday'], ['Monday'], ['Thursday'], ['Tuesdays']], 0))).toEqual(['Monday', 'Tuesdays', 'Thursday', 'Sunday']);
    expect(col(sortTable([['110'], ['9'], ['1,200']], 0))).toEqual(['9', '110', '1,200']);
  });
  it('units: T41 before T964; text ignores case; ties keep sheet order', () => {
    expect(col(sortTable([['T964'], ['T41'], ['C917'], ['T41']], 0, 1, true))).toEqual(['C917', 'T41', 'T41', 'T964']);
    const rows = [['b', 1], ['A', 2], ['a', 3]];
    expect(sortTable(rows, 0).map(r => r[1])).toEqual([2, 3, 1]);
    expect(cellKey('  ')).toBeNull();
  });
  it('filter: every word, any cell, case ignored', () => {
    const rows = [['T999', 'Tuesday', 'Fellowship Hall'], ['C917', 'Tuesday', 'Library']];
    expect(filterRows(rows, 'tuesday hall')).toEqual([rows[0]]);
    expect(filterRows(rows, ' ')).toEqual(rows);
  });
  it('unit codes match the server (Units.code)', () => {
    expect(['Troop 0999', 'T999', 'c 917', 'Crew 917', 'Pack 1', 'x'].map(unitCode)).toEqual(['t999', 't999', 'c917', 'c917', 'p1', '']);
  });
});
