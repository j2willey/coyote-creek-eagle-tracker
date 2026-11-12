import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Units = require('../apps-script/src/lib/units.js');
const Key3 = require('../apps-script/src/lib/key3.js');

// All names and addresses fake.
describe('Key3.parse', () => {
  const csv = [
    ['Key 3 report', '', '', '', ''],
    ['Unit Number', 'Position', 'Name', 'Email', 'Phone'],
    ['T1111', 'Scoutmaster', 'Pat Fake', 'PAT@x.org', '408-555-0100'],
    ['T1111', 'Committee Chair', 'Lee Fake', 'lee@x.org', ''],
    ['T1111', 'Chartered Organization Rep.', 'Cor Fake', 'cor@x.org', ''],
    ['P1111', 'Cubmaster', 'Cub Fake', 'cub@x.org', ''],
    ['Crew 917', 'Crew Advisor', 'Ada Fake', 'ada@x.org', ''],
    ['', '', '', '', ''],
    ['T-92', 'Scoutmaster', 'No Mail', '', ''],
    ['S5', 'Skipper', 'Sal Fake', 'sal@x.org', '']
  ];
  const p = Key3.parse(csv);

  it('finds the header below a title row and keeps troops, crews, ships', () => {
    expect(p.error).toBeUndefined();
    expect(p.rows.map(r => [r.unit, r.role])).toEqual([
      ['C917', 'Unit Leader'], ['S5', 'Unit Leader'], ['T1111', 'Committee Chair'], ['T1111', 'Unit Leader']]);
    expect(p.rows.find(r => r.role === 'Unit Leader' && r.unit === 'T1111')).toMatchObject({ name: 'Pat Fake', email: 'pat@x.org', position: 'Scoutmaster' });
  });

  it('drops COR, packs and rows without an email', () => {
    expect(p.skipped).toMatchObject({ 'Chartered Org Rep': 1, 'packs / other unit types': 1, 'no email': 1 });
  });

  it('reads unit type + number and first + last name', () => {
    const q = Key3.parse([['Unit Type', 'Unit', 'Title', 'First Name', 'Last Name', 'E-mail'], ['Troop', '0910', 'Scoutmaster', 'A', 'Fake', 'a@x.org']]);
    expect(q.rows[0]).toMatchObject({ unit: 'T910', role: 'Unit Leader', name: 'A Fake' });
  });

  it('says so when there is no usable header', () => {
    expect(Key3.parse([['a', 'b']]).error).toMatch(/header/);
  });

  it('diffs against the previous import', () => {
    const old = [{ Unit: 'T1111', Role: 'Unit Leader', Email: 'old@x.org' }, { Unit: 'T1111', Role: 'Committee Chair', Email: 'lee@x.org' }];
    const d = Key3.diff(old, p.rows);
    expect(d.removed).toEqual(['T1111 | Unit Leader | old@x.org']);
    expect(d.added).toContain('T1111 | Unit Leader | pat@x.org');
    expect(d.added).not.toContain('T1111 | Committee Chair | lee@x.org');
  });
});

describe('Units.combine', () => {
  const info = [{ 'Unit': 'T1111', 'Under Review': true, 'Meeting Location': 'Church hall', 'Meeting Day': 'Tue', 'Meeting Time': '7 PM', 'Unit Notes': 'x' }];
  const key3 = [
    { Unit: 'T1111', Role: 'Unit Leader', Email: 'pat@x.org' },
    { Unit: 'T1111', Role: 'Committee Chair', Email: 'lee@x.org' },
    { Unit: 'T1111', Role: 'Treasurer', Email: 'money@x.org' },
    { Unit: 'C917', Role: 'Unit Leader', Email: 'stale@x.org' }
  ];
  const local = [
    { Unit: 'T1111', Role: 'EBoR Coordinator', Email: 'ebc@x.org' },
    { Unit: 'Crew 917', Role: 'Exclude', Email: 'stale@x.org' },
    { Unit: 'C917', Role: 'Advancement Chair', Email: 'adv@x.org' },
    { Unit: '', Role: 'Exclude', Email: 'lee@x.org' }
  ];
  const units = Units.combine(info, key3, local);

  it('merges Key 3 leader/chair with local contacts, minus Exclude', () => {
    const t = Units.find(units, 'Troop 1111');
    expect(t.contacts.sort()).toEqual(['ebc@x.org', 'pat@x.org']);
    expect(t.underReview).toBe(true);
    expect(t.meeting).toEqual({ location: 'Church hall', day: 'Tue', time: '7 PM', frequency: '', address: '', notes: '' });
    expect(Units.find(units, 'C917').contacts).toEqual(['adv@x.org']);
  });

  it('sign-in works across units', () => {
    expect(Units.forEmail(units, 'ADV@x.org').map(u => u.unit)).toEqual(['C917']);
  });

  it('converts the old Unit Info layout', () => {
    const rows = Units.legacyContacts([{ 'Unit': 'Troop 910', 'Unit Leader Email': 'sm@x.org', 'Other Contacts': 'a@x.org; b@x.org' }]);
    expect(rows).toEqual([
      { unit: 'T910', role: 'Unit Leader', email: 'sm@x.org' },
      { unit: 'T910', role: 'Other', email: 'a@x.org' }, { unit: 'T910', role: 'Other', email: 'b@x.org' }]);
  });
});

// Leader address columns (Task 12). All names and addresses fake.
describe('Key3 leader address', () => {
  const head = ['Unit', 'Role', 'Position', 'Name', 'Email', 'Phone', 'Leader Address', 'Leader City', 'Leader State', 'Leader Zip'];

  it('finds the four columns by header text, ignoring case, spaces and underscores', () => {
    const grid = [['Unit', 'Role', 'Name', 'leader  address', 'LEADER_CITY', 'Leader State', ' leader zip ']];
    expect(Key3.addressColumns(grid)).toEqual({ address: 3, city: 4, state: 5, zip: 6 });
  });

  it('prefers the machine-name row when there is one', () => {
    const grid = [
      ['Unit', 'Street', 'Town', 'ST', 'Postal'],
      ['unit', 'leader_address', 'leader_city', 'leader_state', 'leader_zip']
    ];
    expect(Key3.hasMachineRow(grid)).toBe(true);
    expect(Key3.addressColumns(grid)).toEqual({ address: 1, city: 2, state: 3, zip: 4 });
  });

  it('finds nothing when the tab has no such columns', () => {
    expect(Key3.addressColumns([['Unit', 'Role', 'Name']])).toEqual({});
    expect(Key3.hasMachineRow([['Unit'], ['T999']])).toBe(false);
  });

  it('reads the tab as rows, skipping a machine-name row', () => {
    const grid = [
      ['Unit', 'Role', 'Name', 'Street', 'City'],
      ['unit', 'role', 'name', 'leader_address', 'leader_city'],
      ['T999', 'Unit Leader', 'Pat Fake', '12 Elm St', 'Springfield']
    ];
    const rows = Key3.readGrid(grid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _row: 3, Unit: 'T999', Name: 'Pat Fake', address: '12 Elm St', city: 'Springfield', state: '', zip: '' });
  });

  const oldRows = Key3.readGrid([head,
    ['T999', 'Unit Leader', 'Scoutmaster', 'Pat Fake', 'pat@example.org', '', '12 Elm St', 'Springfield', 'CA', '95000'],
    ['T999', 'Committee Chair', 'Committee Chair', 'Lee Fake', 'lee@example.org', '', '', '', '', ''],
    ['C917', 'Unit Leader', 'Crew Advisor', 'Ada Fake', 'ada@example.org', '', '5 Oak Ave', 'Shelbyville', 'CA', '95001']]);

  it('carries the address forward for the same unit and the same leader name', () => {
    const fresh = Key3.parse([
      ['Unit', 'Position', 'Name', 'Email'],
      ['T999', 'Scoutmaster', 'PAT  fake', 'pat@example.org'],
      ['T999', 'Committee Chair', 'Lee Fake', 'lee@example.org'],
      ['C917', 'Crew Advisor', 'New Person', 'new@example.org']
    ]).rows;
    const out = Key3.carryForward(oldRows, fresh);
    expect(out.carried).toBe(1);
    const t999 = out.rows.find(r => r.unit === 'T999' && r.role === 'Unit Leader');
    expect(t999).toMatchObject({ address: '12 Elm St', city: 'Springfield', state: 'CA', zip: '95000' });
    expect(out.rows.find(r => r.unit === 'C917')).toMatchObject({ name: 'New Person' });
    expect(out.rows.find(r => r.unit === 'C917').address || '').toBe('');
    expect(out.rows.find(r => r.role === 'Committee Chair').address || '').toBe('');
  });

  it('uses the export\'s own address columns when it has them, over the old values', () => {
    const fresh = Key3.parse([
      ['Unit', 'Position', 'Name', 'Email', 'Address', 'City', 'State', 'Zip Code'],
      ['T999', 'Scoutmaster', 'Pat Fake', 'pat@example.org', '99 New Rd', 'Capital City', 'CA', '95111'],
      ['T999', 'Committee Chair', 'Lee Fake', 'lee@example.org', '1 Chair Ln', 'Elsewhere', 'CA', '95222']
    ]).rows;
    const out = Key3.carryForward(oldRows, fresh);
    expect(out.carried).toBe(0);
    expect(out.rows.find(r => r.role === 'Unit Leader')).toMatchObject({ address: '99 New Rd', city: 'Capital City', zip: '95111' });
    expect(out.rows.find(r => r.role === 'Committee Chair').address).toBe('');   // only the leader's row keeps an address
  });
});
