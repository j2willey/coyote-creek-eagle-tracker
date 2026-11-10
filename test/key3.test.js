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
