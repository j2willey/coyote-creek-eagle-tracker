import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Booking = require('../apps-script/src/lib/booking.js');
const CS = require('../apps-script/src/lib/committeeSchedule.js');
const OT = require('../apps-script/src/lib/openTimes.js');
const TemplateCatalog = require('../apps-script/src/lib/templateCatalog.js');

// Fake data only (records about minors).
const NOW = new Date(2026, 9, 31, 8, 0).getTime();          // Sat 10/31 8:00 AM
const at = (d, h, m) => new Date(2026, 9, d, h, m || 0);
const committee = [{ name: 'Member A', initials: 'MA', email: 'ma@example.org' }, { name: 'Member B', initials: 'MB', email: 'mb@example.org' }];
const settings = { intakeMinutes: 20, reviewMinutes: 60, eborMinutes: 90, bookingLeadHours: 48, reviewLeadHours: 48, eborLeadHours: 336 };

describe('Per-session lead time (Lead (h), 2026-10-31)', () => {
  const rows = [
    { _key: 'S1', date: at(31, 0), time: '10:00 AM', slot_type: 'Intake', reps: 'MA' },                    // 2 h away, Settings lead 48
    { _key: 'S2', date: at(31, 0), time: '10:00 AM', slot_type: 'Intake', reps: 'MA', lead_hours: 2 },     // own lead 2 h: just offered
    { _key: 'S3', date: at(31, 0), time: '9:30 AM', slot_type: 'Intake', reps: 'MA', lead_hours: 2 },      // 1.5 h away: inside its 2 h
    { _key: 'S4', date: at(4, 0).setMonth(10) && new Date(2026, 10, 4), time: '7:00 PM', slot_type: 'Intake', reps: 'MB', lead_hours: 96 }, // 4.5 days, own lead 4 days
    { _key: 'S5', date: new Date(2026, 10, 3), time: '7:00 PM', slot_type: 'Intake', reps: 'MB', lead_hours: '' }   // blank = Settings
  ];
  it('leadOf reads the cell; blank or junk = null', () => {
    expect(Booking.leadOf({ lead_hours: 2 })).toBe(2);
    expect(Booking.leadOf({ lead_hours: '0' })).toBe(0);
    expect(Booking.leadOf({ lead_hours: '' })).toBeNull();
    expect(Booking.leadOf({ lead_hours: 'soon' })).toBeNull();
    expect(Booking.leadOf({})).toBeNull();
  });
  it('a session\'s own lead time replaces the Settings value for Scouts', () => {
    expect(Booking.openSlots(rows, 'Intake', NOW, 48).map(s => s.key)).toEqual(['S2', 'S5', 'S4']);
  });
  it('committee views ignore lead times', () => {
    expect(Booking.openSlots(rows, 'Intake', NOW, 48, { noLead: true }).map(s => s.key)).toEqual(['S3', 'S1', 'S2', 'S5', 'S4']);
    expect(Booking.openSlots(rows, 'Intake', NOW, 48, { committee: true }).length).toBe(5);
  });
  it('check: writes Lead (h), validates it, and the online-cutoff warning uses it', () => {
    const base = { type: 'Intake', date: '2026-10-31', time: '10:00', minutes: 20, reps: ['MA'] };
    const plain = CS.check(base, [], committee, NOW, settings);
    expect(plain.cells.lead_hours).toBe('');
    expect(plain.warnings.join(' ')).toMatch(/less than 48 hours away.*shorter lead time/);
    const short = CS.check(Object.assign({}, base, { leadHours: '2' }), [], committee, NOW, settings);
    expect(short.cells.lead_hours).toBe(2);
    expect(short.warnings).toEqual([]);
    expect(CS.check(Object.assign({}, base, { leadHours: -1 }), [], committee, NOW, settings).errors.join(' ')).toMatch(/Lead time/);
  });
  it('entries carry the lead time for the form', () => {
    expect(CS.entries(rows, settings).find(x => x.key === 'S2').leadHours).toBe(2);
    expect(CS.entries(rows, settings).find(x => x.key === 'S5').leadHours).toBeNull();
  });
});

describe('Several sessions at once (checkBatch)', () => {
  const shared = { type: 'Intake', minutes: 20, reps: ['MA'], leadHours: 2 };
  it('one set of cells per time, sorted; shared fields identical', () => {
    const r = CS.checkBatch(shared, [{ date: '2026-11-01', time: '14:00' }, { date: '2026-10-31', time: '13:00' }, { date: '2026-10-31', time: '13:20' }],
      [], committee, NOW, settings);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);                                   // back to back is not an overlap
    expect(r.items.map(i => i.cells.time)).toEqual(['1:00 PM', '1:20 PM', '2:00 PM']);
    expect(r.items.every(i => i.cells.reps === 'MA' && i.cells.lead_hours === 2 && i.cells.slot_type === 'Intake')).toBe(true);
  });
  it('the times are checked against each other; a time twice is an error', () => {
    const over = CS.checkBatch(shared, [{ date: '2026-10-31', time: '13:00' }, { date: '2026-10-31', time: '13:10' }], [], committee, NOW, settings);
    expect(over.warnings).toEqual(['10/31 1:10 PM: MA already has a Pre-Review Call at 10/31 1:00 PM.']);
    const dup = CS.checkBatch(shared, [{ date: '2026-10-31', time: '13:00' }, { date: '2026-10-31', time: '13:00' }], [], committee, NOW, settings);
    expect(dup.errors.join(' ')).toMatch(/listed twice/);
  });
  it('a message about every time is listed once; one about some times names them', () => {
    const r = CS.checkBatch({ type: 'Intake', minutes: 20, reps: [] }, [{ date: '2026-10-31', time: '13:00' }, { date: '2026-10-30', time: '13:00' }],
      [], committee, NOW, settings);
    expect(r.errors).toEqual(['10/30 1:00 PM: That time is in the past.']);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/^No committee member/);   // applies to both times: listed once, no prefix
  });
  it('limits: at least one time, at most BATCH_MAX, Blocked one at a time', () => {
    expect(CS.checkBatch(shared, [], [], committee, NOW, settings).errors[0]).toMatch(/at least one/);
    const many = Array.from({ length: CS.BATCH_MAX + 1 }, (_, i) => ({ date: '2026-11-02', time: String(8 + Math.floor(i / 3)).padStart(2, '0') + ':' + ['00', '20', '40'][i % 3] }));
    expect(CS.checkBatch(shared, many, [], committee, NOW, settings).errors[0]).toMatch(/At most/);
    expect(CS.checkBatch({ type: 'CCAC', location: 'x' }, [{ date: '2026-11-02', time: '' }, { date: '2026-11-03', time: '' }], [], committee, NOW, settings).errors[0]).toMatch(/one at a time/);
  });
});

describe('Open times email (OpenTimes)', () => {
  const records = [
    { recordId: 'R-1', section: 'intake_to_book', scout_name: 'Scout Bravo', unit: 'T1', scout_email: 'bravo@example.org', parent_email: 'p.bravo@example.org; p2.bravo@example.org' },
    { recordId: 'R-2', section: 'intake_to_book', scout_name: 'Scout Alpha', unit: 'T2', scout_email: 'Alpha@Example.org', parent_email: '' },
    { recordId: 'R-3', section: 'intake_to_book', scout_name: 'Scout Charlie', unit: 'T3', scout_email: '', parent_email: 'p.charlie@example.org' },
    { recordId: 'R-4', section: 'intake_to_book', scout_name: 'Scout Delta', unit: 'T4', scout_email: 'delta@example.org', parent_email: '' },   // already booked
    { recordId: 'R-5', section: 'review_to_book', scout_name: 'Scout Echo', unit: 'T5', scout_email: 'echo@example.org', parent_email: '' }
  ];
  const rows = [{ _key: 'B1', date: new Date(2026, 10, 2), time: '7:00 PM', slot_type: 'Intake', reps: 'MA', record_id: 'R-4', scout_name: 'Scout Delta' }];
  it('Scouts ready to book the type, by name, without a booking', () => {
    const r = OT.recipients(records, 'Intake', rows, NOW);
    expect(r.map(x => x.recordId)).toEqual(['R-2', 'R-1', 'R-3']);
    expect(OT.recipients(records, 'ESSPPR', rows, NOW).map(x => x.recordId)).toEqual(['R-5']);
    expect(OT.sectionFor('EBoR')).toBe('app_verified');
  });
  it('one email: To the Scouts (parent when the Scout has no email), Cc the other parents + committee group', () => {
    const a = OT.addresses(OT.recipients(records, 'Intake', rows, NOW), 'group@example.org');
    expect(a.to).toEqual(['alpha@example.org', 'bravo@example.org', 'p.charlie@example.org']);
    expect(a.cc).toEqual(['p.bravo@example.org', 'p2.bravo@example.org', 'group@example.org']);
  });
  it('names and times', () => {
    expect(OT.namesText(['Alpha'])).toBe('Alpha');
    expect(OT.namesText(['Alpha', 'Bravo', 'Charlie'])).toBe('Alpha, Bravo and Charlie');
    const when = (ms) => new Date(ms).getHours() + ':00';
    expect(OT.timesList([{ start: at(31, 14).getTime() }, { start: at(31, 13).getTime() }], 'Intake', when)).toEqual(['13:00', '14:00']);
    expect(OT.timesList([{ start: at(31, 19).getTime(), location: 'Test Y' }, { start: at(31, 20).getTime(), location: 'Online (Google Meet)' }], 'ESSPPR', when, x => x.location))
      .toEqual(['19:00 at Test Y', '20:00 (online)']);
  });
  it('lists only the new sessions offered now; the rest are reported as held', () => {
    const open = [{ key: 'N1', start: 1 }, { key: 'OLD', start: 2 }];
    expect(OT.pick(open, ['N1', 'N2'], false)).toEqual({ list: [{ key: 'N1', start: 1 }], held: ['N2'] });
    expect(OT.pick(open, ['N1'], true).list.length).toBe(2);
  });
  it('a template tab per type, drafted for review, Cc the committee', () => {
    ['Intake', 'ESSPPR', 'EBoR'].forEach(t => {
      const x = TemplateCatalog.get(OT.TEMPLATE[t]);
      expect(x, t).toBeTruthy();
      expect(x.mode).toBe('review');
      expect(x.cc).toBe('group');
      expect(x.vars).toContain('times');
    });
  });
});
