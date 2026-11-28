import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const UnitTables = require('../apps-script/src/lib/unitTables.js');

describe('UnitTables (Units page sheet tabs, 2026-11-28)', () => {
  it('keeps headed columns, leaves out hidden "_" columns, empty rows and a machine-name row', () => {
    const t = UnitTables.table([
      ['Unit', 'Role', '', 'Name', '_key', 'Leader  Address'],
      ['unit', 'role', '', 'name', '_key', 'leader_address'],
      ['T999', 'Unit Leader', 'stray', 'Pat Q', 'k1', '1 Main St'],
      ['', '', '', '', 'k2', ''],
      ['C917', 'Committee Chair', '', 'Sam P', '', '']
    ]);
    expect(t.headers).toEqual(['Unit', 'Role', 'Name', 'Leader Address']);
    expect(t.rows).toEqual([['T999', 'Unit Leader', 'Pat Q', '1 Main St'], ['C917', 'Committee Chair', 'Sam P', '']]);
    expect(t.unitCol).toBe(0);
  });
  it('a real first data row is not taken for machine names', () => {
    expect(UnitTables.isMachineRow(['T999', 'Tuesday', '7:00 PM'])).toBe(false);
    expect(UnitTables.isMachineRow(['unit', 'meeting_day'])).toBe(true);
    expect(UnitTables.table([['Unit', 'Meeting Day'], ['t999', 'tuesday']]).rows).toHaveLength(1);
  });
  it('no grid, or no Unit column', () => {
    expect(UnitTables.table([])).toEqual({ headers: [], rows: [], unitCol: -1 });
    expect(UnitTables.table([['Name'], ['Pat Q']]).unitCol).toBe(-1);
    expect(UnitTables.TABS.map(t => t.tab)).toEqual(['Unit Info', 'Key 3', 'Unit Contacts']);
  });
});
