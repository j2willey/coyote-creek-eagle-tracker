import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Units = require('../apps-script/src/lib/units.js');
const Intake = require('../apps-script/src/lib/intake.js');
const UnitCalendar = require('../apps-script/src/lib/unitCalendar.js');
const CS = require('../apps-script/src/lib/committeeSchedule.js');
const Stats = require('../apps-script/src/lib/stats.js');

describe('A Scout in several units (primary first, 2026-11-01)', () => {
  it('reads every unit, primary first, whatever the separator', () => {
    expect(Units.codes('C967 T911')).toEqual(['c967', 't911']);
    expect(Units.codes('T910 / C917')).toEqual(['t910', 'c917']);
    expect(Units.codes('Troop 910, Crew 917')).toEqual(['t910', 'c917']);
    expect(Units.codes('C967\nT911')).toEqual(['c967', 't911']);
    expect(Units.codes('Troop 910')).toEqual(['t910']);
    expect(Units.codes('T92')).toEqual(['t92']);
    expect(Units.codes('')).toEqual([]);
    expect(Units.codes('C967 T911 S905')).toEqual(['c967', 't911', 's905']);   // three (or more) units
    expect(Units.primary('C967 T911 S905')).toBe('c967');
  });
  it('primary = the first; single units unchanged', () => {
    expect(Units.primary('C967 T911')).toBe('c967');
    expect(Units.primary('Troop 0116')).toBe('t116');
    expect(Units.primaryText('C967 T911')).toBe('C967');
    expect(Units.primaryText('Troop 910')).toBe('Troop 910');
  });
  it('find() (EBoR emails, under review) uses the primary unit', () => {
    const units = [{ code: 'c967', unit: 'C967', contacts: ['a@example.org'] }, { code: 't911', unit: 'T911', contacts: ['b@example.org'] }];
    expect(Units.find(units, 'C967 T911').unit).toBe('C967');
    expect(Units.find(units, 'T911').unit).toBe('T911');
  });
  it('files and folders use the primary unit', () => {
    expect(Intake.unitPart('C967 T911')).toBe('C967');
    expect(Intake.unitPart('Troop 910')).toBe('Troop910');
    expect(Intake.folderName('Scout Fake', 'C967 T911')).toBe('Scout Fake - C967');
  });
  it('unit page calendar: every listed unit sees the Scout', () => {
    const rows = [{ _key: 'K1', record_id: 'R-1', scout_name: 'Scout Fake', slot_type: 'EBoR', date: new Date(2026, 11, 2), time: '7:00 PM', reps: 'MA' }];
    const who = () => ({ name: 'Scout Fake', unitCodes: ['c967', 't911'] });
    const now = new Date(2026, 10, 1).getTime();
    expect(UnitCalendar.build(rows, who, ['t911'], [], now).booked.length).toBe(1);
    expect(UnitCalendar.build(rows, who, ['t41'], [], now).booked.length).toBe(0);
  });
  it('a slot reserved for any of the Scout\'s units gives no "other unit" warning', () => {
    const committee = [{ name: 'Member A', initials: 'MA', email: 'ma@example.org' }];
    const base = { type: 'EBoR', date: '2026-12-02', time: '19:00', minutes: 90, location: 'Test Y', reps: ['MA'], recordId: 'R-1', reserved: true };
    const now = new Date(2026, 10, 1).getTime();
    expect(CS.check(Object.assign({}, base, { unit: 'T911', scoutUnit: 'C967 T911' }), [], committee, now, {}).warnings.join(' ')).not.toMatch(/reserved for/);
    expect(CS.check(Object.assign({}, base, { unit: 'T41', scoutUnit: 'C967 T911' }), [], committee, now, {}).warnings.join(' ')).toMatch(/reserved for T41/);
  });
});
