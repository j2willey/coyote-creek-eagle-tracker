import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const UC = require('../apps-script/src/lib/unitCalendar.js');

describe('Unit calendar', () => {
  const now = new Date(2026, 9, 24, 8).getTime();
  const rows = [
    { _key: 'S1', slot_type: 'Pre-Review Call', date: '2026-10-28', time: '7:00 PM', record_id: 'R1', scout_name: 'Scout_1', duration_min: 20 },
    { _key: 'S2', slot_type: 'EBoR', date: '2026-11-04', time: '7:30 PM', record_id: 'R2', scout_name: 'Scout_2', location: 'YMCA', duration_min: 90 },
    { _key: 'S3', slot_type: 'EBoR', date: '2026-11-05', time: '7:30 PM', record_id: 'R9', scout_name: 'Other_unit' },
    { _key: 'S4', slot_type: 'Pre-Review Call', date: '2026-10-29', time: '7:00 PM', duration_min: 20, reps: 'JW' },          // open
    { _key: 'S5', slot_type: 'Proposal Review', date: '2026-10-30', time: '7:00 PM', location: 'YMCA', reps: 'JW' }        // open, not online
  ];
  const units = { R1: { name: 'Scout_1', unitCode: 't251' }, R2: { name: 'Scout_2', unitCode: 't251' }, R9: { name: 'Other_unit', unitCode: 't92' } };
  const cal = UC.build(rows, id => units[id] || null, ['t251'], ['Intake'], now, () => 0);
  it('shows only the unit\'s own Scouts, with type and place', () => {
    expect(cal.booked.map(e => [e.title, e.type, e.where])).toEqual([
      ['Scout_1', 'Pre-Review Call', 'Online (Google Meet)'], ['Scout_2', 'Eagle Board of Review', 'YMCA']]);
    expect(cal.booked[1].end - cal.booked[1].start).toBe(90 * 60000);
  });
  it('open times: only the types booked online, no names', () => {
    expect(cal.open.map(e => [e.title, e.code])).toEqual([['Open Pre-Review Call', 'Intake']]);
  });
});
