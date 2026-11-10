import { describe, it, expect } from 'vitest';
import D from '../apps-script/src/lib/unitDirectory.js';
import U from '../apps-script/src/lib/units.js';

const key3 = [{ _row: 2, Unit: 'T964', Role: 'Unit Leader', Position: 'Scoutmaster', Name: 'Pat Leader', Email: 'PL@example.org', Phone: '' },
  { _row: 3, Unit: 'Troop 964', Role: 'Committee Chair', Position: '', Name: 'Cam Chair', Email: 'cc@example.org', Phone: '' },
  { _row: 4, Unit: 'T964', Role: 'Chartered Org Rep', Name: 'X', Email: 'x@example.org' },
  { _row: 5, Unit: 'C9', Role: 'Unit Leader', Name: 'Crew Advisor', Email: '' }];
const local = [{ _row: 2, Unit: 'T964', Role: 'EBoR Coordinator', Name: 'Eb Co', Email: 'eb@example.org', Phone: '408', Note: '', Updated: '' },
  { _row: 3, Unit: 'T964', Role: 'Exclude', Name: '', Email: 'old@example.org' }];

describe('UnitDirectory', () => {
  it('Key 3 rows: Unit Leader then Committee Chair only; unit contacts listed', () => {
    expect(D.key3For(key3, 't964').map(x => x.role)).toEqual(['Unit Leader', 'Committee Chair']);
    expect(D.key3For(key3, 't964')[0].email).toBe('pl@example.org');
    expect(D.contactsFor(local, 't964').map(x => x.role)).toEqual(['EBoR Coordinator', 'Exclude']);
  });
  it('directory: counts, missing roles, sorted', () => {
    const units = U.combine([], key3, local);
    const d = D.directory(units, key3, local);
    expect(d.map(x => x.code)).toEqual(['c9', 't964']);
    expect(d.find(x => x.code === 'c9').missing).toEqual(['Unit Leader', 'Committee Chair']);
    expect(d.find(x => x.code === 't964')).toMatchObject({ key3: 2, contacts: 1, missing: [] });
  });
  it('validate and same-row check', () => {
    expect(D.validate({ role: 'Advancement Chair', name: 'A B', email: 'ab@example.org' }).ok).toBe(true);
    expect(D.validate({ role: '', name: 'A', email: 'bad' }).errors.length).toBe(2);
    expect(D.validate({ name: 'A', email: 'a@example.org' }, 'key3').ok).toBe(true);
    expect(D.same(key3[0], 't964', { email: 'pl@example.org', name: 'Pat Leader' })).toBe(true);
    expect(D.same(key3[0], 't964', { email: 'other@example.org', name: 'Pat Leader' })).toBe(false);
  });
  it('sorts the Unit Contacts tab: natural unit order, then role, Exclude last', () => {
    const rows = [['T964', 'Other', 'Zed'], ['T41', 'Exclude', ''], ['C9', 'EBoR Coordinator', 'A'], ['T41', 'Advancement Chair', 'B'], ['', 'Other', 'X'], ['T964', 'Advancement Chair', 'Y']];
    expect(D.sortRows(rows, 0, 1, 2).map(r => r[0] + ':' + r[1])).toEqual(
      ['C9:EBoR Coordinator', 'T41:Advancement Chair', 'T41:Exclude', 'T964:Advancement Chair', 'T964:Other', ':Other']);
  });
});
