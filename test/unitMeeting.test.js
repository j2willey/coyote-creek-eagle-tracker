import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const UD = require('../apps-script/src/lib/unitDirectory.js');

// Fake units only.
const info = [
  { _row: 2, Unit: 'Troop 910', 'Meeting Day': 'Tuesday', 'Meeting Time': '7:00 PM', 'Meeting location': 'Fake Church Hall', 'meeting  frequency': 'Weekly' },
  { _row: 3, Unit: 'C917', 'Meeting Day': '', 'Meeting Time': '' }
];

describe('Unit meetings (2026-11-01)', () => {
  it('reads the unit\'s row; headers matched without regard to case or spaces', () => {
    const m = UD.meetingFor(info, 't910');
    expect(m.row).toBe(2);
    expect(m.fields).toEqual({ day: 'Tuesday', time: '7:00 PM', frequency: 'Weekly', location: 'Fake Church Hall', address: '', notes: '' });
  });
  it('a unit with no row: row 0, all blank', () => {
    const m = UD.meetingFor(info, 't999');
    expect(m.row).toBe(0);
    expect(Object.values(m.fields).every(v => v === '')).toBe(true);
  });
  it('validate: trims, everything optional, length caps', () => {
    expect(UD.validateMeeting({ day: '  Monday ', notes: '' })).toMatchObject({ ok: true, clean: { day: 'Monday', time: '', notes: '' } });
    const long = UD.validateMeeting({ location: 'x'.repeat(121) });
    expect(long.ok).toBe(false);
    expect(long.errors[0]).toMatch(/Location is too long/);
  });
  it('sameMeeting compares every field', () => {
    const f = UD.meetingFor(info, 't910').fields;
    expect(UD.sameMeeting(f, Object.assign({}, f))).toBe(true);
    expect(UD.sameMeeting(f, Object.assign({}, f, { time: '7:30 PM' }))).toBe(false);
  });
  it('columns to add: only the missing ones, any case counts as present; actual header found', () => {
    const head = ['Unit', 'Under Review', 'Meeting Location', 'Meeting Day', 'Meeting Time', 'Unit Notes', 'Last updated'];
    expect(UD.missingColumns(head)).toEqual(['Meeting Frequency', 'Meeting Address', 'Meeting Notes', 'Eagles to Date', 'Updated By']);
    expect(UD.actualColumn(head, 'Last Updated')).toBe('Last updated');
  });
});

describe('Placeholder Unit Contacts rows (unit only)', () => {
  const rows = [
    { _row: 2, Unit: 'C967', Role: '', Name: '', Email: '', Phone: '', Note: '' },
    { _row: 3, Unit: 'C967', Role: 'Advancement Chair', Name: 'Fake Person', Email: 'fake@example.org', Phone: '', Note: '' },
    { _row: 4, Unit: 'T910', Role: '', Name: '', Email: '', Phone: '', Note: 'call first' }
  ];
  it('are hidden from the panel and listed for removal; a row with anything else stays', () => {
    expect(UD.contactsFor(rows, 'c967').map(x => x.row)).toEqual([3]);
    expect(UD.blankContactRows(rows)).toEqual([2]);
  });
});
