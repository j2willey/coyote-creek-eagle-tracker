import { describe, it, expect } from 'vitest';
import B from '../apps-script/src/lib/unitBroadcast.js';

const key3 = [
  { Unit: 'T964', Role: 'Scoutmaster', Email: 'sm@example.org' }, { Unit: 'T964', Role: 'Committee Chair', Email: 'cc@example.org' },
  { Unit: 'T964', Role: 'Chartered Org Rep', Email: 'cor@example.org' }, { Unit: 'Pack 110', Role: 'Cubmaster', Email: 'cm@example.org' },
  { Unit: 'C9', Role: 'Venturing Crew Advisor', Email: 'SM@example.org' }, { Unit: 'C9', Role: 'Committee Chair', Email: 'gone@example.org' }];
const local = [{ Unit: 'T964', Role: 'Advancement Chair', Email: 'ac@example.org' }, { Unit: 'C9', Role: 'Exclude', Email: 'gone@example.org' }];

describe('UnitBroadcast', () => {
  it('troops + crews, chairs + leaders + contacts: unique, no CORs, no packs, Exclude honoured', () => {
    const r = B.recipients(key3, local, { types: ['t', 'c', 's'], chairs: true, leaders: true, contacts: true });
    expect(r.recipients.map(x => x.email)).toEqual(['ac@example.org', 'cc@example.org', 'sm@example.org']);
    expect(r.recipients.find(x => x.email === 'sm@example.org').units).toEqual(['T964', 'C9']);
    expect(r.units).toBe(2);
  });
  it('packs only, leaders only', () => {
    expect(B.recipients(key3, local, { types: ['p'], leaders: true }).recipients.map(x => x.email)).toEqual(['cm@example.org']);
  });
  it('batches of 48', () => {
    const e = Array.from({ length: 89 }, (_, i) => i + '@x.org');
    expect(B.batches(e).map(b => b.length)).toEqual([48, 41]);
  });
});
