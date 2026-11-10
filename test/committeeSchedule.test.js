import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CS = require('../apps-script/src/lib/committeeSchedule.js');

const NOW = new Date(2026, 9, 20, 12, 0).getTime();
const day = (d) => new Date(2026, 9, d);
const committee = [
  { name: 'Member A', initials: 'MA', email: 'ma@example.org' },
  { name: 'Member B', initials: 'MB', email: 'MB@Example.org' }
];
const settings = { intakeMinutes: 20, reviewMinutes: 60, eborMinutes: 90, defaultLocation: 'Test Y', defaultAddress: '1 Fake St',
  defaultStartTime: '19:00', reviewLeadHours: 48 };
const rows = [
  { _row: 3, _key: 'SL_A', date: day(22), time: '7:00 PM', slot_type: 'ESSPPR', reps: 'MA', duration_min: 60 },
  { _row: 4, _key: 'SL_B', date: day(28), time: '7:00 PM', slot_type: 'Intake', reps: 'MB', scout_name: 'Scout 1', record_id: 'R-1' },
  { _row: 5, _key: 'SL_C', date: day(29), time: '6:00 PM', slot_type: 'CCAC', location: 'CCAC meeting', duration_min: 120 },
  { _row: 6, _key: 'SL_D', date: day(30), time: '', slot_type: 'Intake' }
];
const input = (o) => Object.assign({ type: 'ESSPPR', date: '2026-10-27', time: '19:00', minutes: 60, location: 'Test Y', address: '1 Fake St', reps: ['MA'] }, o);

describe('CommitteeSchedule', () => {
  it('finds the signed-in member by email (any case)', () => {
    expect(CS.memberFor(committee, 'mb@example.org').initials).toBe('MB');
    expect(CS.memberFor(committee, 'x@example.org')).toBeNull();
    expect(CS.memberFor(committee, '')).toBeNull();
  });

  it('formats times both ways', () => {
    expect(CS.timeText('19:00')).toBe('7:00 PM');
    expect(CS.timeText('12:30')).toBe('12:30 PM');
    expect(CS.time24('7:30 PM')).toBe('19:30');
    expect(CS.defaultStart({ defaultStartTime: '7:00 PM' })).toBe('19:00');
    expect(CS.defaultStart({})).toBe('19:00');
  });

  it('type defaults come from Settings', () => {
    const t = CS.typeDefaults(settings);
    expect(t.map(x => x.minutes)).toEqual([20, 60, 90, 120]);
    expect(t[3]).toMatchObject({ code: 'CCAC', label: 'Blocked', block: true });
    expect(t[0]).toMatchObject({ code: 'Intake', virtual: true, location: '' });
    expect(t[1]).toMatchObject({ code: 'ESSPPR', location: 'Test Y', address: '1 Fake St' });
  });

  it('turns rows into calendar entries (open/booked, blank length uses the default, unreadable skipped)', () => {
    const e = CS.entries(rows, settings);
    expect(e.map(x => x.key)).toEqual(['SL_A', 'SL_B', 'SL_C']);
    expect(e[0]).toMatchObject({ booked: false, minutes: 60, editable: true, reps: ['MA'] });
    expect(e[1]).toMatchObject({ booked: true, scoutName: 'Scout 1', minutes: 20 });
    expect(e[2]).toMatchObject({ type: 'CCAC', editable: true, minutes: 120, allDay: false });
  });

  it('accepts a good slot and builds the cells', () => {
    const r = CS.check(input(), rows, committee, NOW, settings);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.cells).toMatchObject({ day: 'Tue', time: '7:00 PM', reps: 'MA', slot_type: 'ESSPPR', duration_min: 60, location: 'Test Y' });
  });

  it('blocks the past, no member, unknown initials, missing location', () => {
    expect(CS.check(input({ date: '2026-10-19' }), rows, committee, NOW, settings).errors).toContain('That time is in the past.');
    const noRep = CS.check(input({ reps: [] }), rows, committee, NOW, settings);   // allowed: not bookable until a member signs up
    expect(noRep.errors).toEqual([]);
    expect(noRep.warnings.join(' ')).toMatch(/No committee member/);
    expect(CS.check(input({ reps: [], recordId: 'R1' }), rows, committee, NOW, settings).errors)
      .toContain('Add a committee member before booking a Scout into this slot.');
    expect(CS.check(input({ reps: ['ZZ'] }), rows, committee, NOW, settings).errors[0]).toMatch(/ZZ/);
    expect(CS.check(input({ location: '' }), rows, committee, NOW, settings).errors).toContain('Enter a location.');
  });

  it('Pre-Review Calls need no location (online)', () => {
    const r = CS.check(input({ type: 'Intake', minutes: 20, location: '' }), rows, committee, NOW, settings);
    expect(r.errors).toEqual([]);
    expect(r.cells.location).toBe('');
  });

  it('warns about the same member twice, a committee block, and the online cutoff; not about other members', () => {
    expect(CS.check(input({ date: '2026-10-22', time: '19:30' }), rows, committee, NOW, settings).warnings.join(' ')).toMatch(/MA already has/);
    expect(CS.check(input({ date: '2026-10-22', time: '19:30', reps: ['MB'] }), rows, committee, NOW, settings).warnings
      .filter(w => /already/.test(w))).toEqual([]);
    expect(CS.check(input({ date: '2026-10-29', time: '19:00' }), rows, committee, NOW, settings).warnings[0]).toMatch(/Overlaps "CCAC meeting"/);
    expect(CS.check(input({ date: '2026-10-21', time: '19:00' }), rows, committee, NOW, settings).warnings.join(' ')).toMatch(/can't book this online/);
  });

  it('editing a slot does not warn about itself', () => {
    expect(CS.check(input({ key: 'SL_A', date: '2026-10-22' }), rows, committee, NOW, settings).warnings).toEqual([]);
  });

  it('new rows go in date order', () => {
    expect(CS.insertBefore(rows, new Date(2026, 9, 25, 19).getTime())).toBe(4);
    expect(CS.insertBefore(rows, new Date(2026, 9, 21, 19).getTime())).toBe(3);
    expect(CS.insertBefore(rows, new Date(2026, 10, 25, 19).getTime())).toBe(0);
    expect(CS.insertBefore(rows, new Date(2026, 9, 21, 19).getTime(), 'SL_A')).toBe(4);
  });

  it('offers the right Scouts per type, the booking stage first', () => {
    const recs = [
      { recordId: 'R-1', scout_name: 'Zed', unit: 'T1', section: 'intake_to_book' },
      { recordId: 'R-2', scout_name: 'Abe', unit: 'T2', section: 'proposal_received' },
      { recordId: 'R-3', scout_name: 'Cal', unit: 'T3', section: 'proposal_approved' },
      { recordId: 'R-4', scout_name: 'Dan', unit: 'T4', section: 'ebor_paused' },
      { recordId: 'R-5', scout_name: 'Eve', unit: 'T5', section: 'app_verified' }
    ];
    const c = CS.scoutChoices(recs, k => 'L:' + k, (id, t) => id === 'R-1' && t === 'Intake' ? 'Wed 10/28 7:00 PM' : '');
    expect(c.Intake.map(x => x.recordId)).toEqual(['R-1', 'R-2']);
    expect(c.Intake[0]).toMatchObject({ stage: 'L:intake_to_book', booked: 'Wed 10/28 7:00 PM' });
    expect(c.EBoR.map(x => x.recordId)).toEqual(['R-5', 'R-4']);
  });

  it('booking moves the row only from the stages before "Booked"', () => {
    expect(CS.moveOnBook('proposal_received', 'Intake')).toBe('intake_booked');
    expect(CS.moveOnBook('intake_booked', 'Intake')).toBeNull();
    expect(CS.moveOnBook('ebor_paused', 'EBoR')).toBe('ebor_booked');
    expect(CS.moveOnBook('review_to_book', 'ESSPPR')).toBe('review_booked');
    expect(CS.moveOnBook('proposal_revisions', 'ESSPPR')).toBeNull();
  });

  it('a slot booked for a Scout gets no "online cutoff" warning', () => {
    expect(CS.check(input({ date: '2026-10-21', recordId: 'R-1' }), rows, committee, NOW, settings).warnings).toEqual([]);
  });

  it('Blocked: description required, no member needed, whole day when no time', () => {
    const blk = (o) => Object.assign({ type: 'CCAC', date: '2026-10-26', time: '', minutes: 0, location: 'Thanksgiving', reps: [] }, o);
    const r = CS.check(blk(), rows, committee, NOW, settings);
    expect(r.errors).toEqual([]);
    expect(r.allDay).toBe(true);
    expect(r.cells).toMatchObject({ slot_type: 'Blocked', time: '', duration_min: '', location: 'Thanksgiving', reps: '' });
    expect(CS.check(blk({ location: '' }), rows, committee, NOW, settings).errors[0]).toMatch(/description/);
    expect(CS.check(blk({ date: '2026-10-20' }), rows, committee, NOW, settings).errors).toEqual([]);   // today still counts
    expect(CS.check(blk({ date: '2026-10-19' }), rows, committee, NOW, settings).errors).toContain('That time is in the past.');
  });

  it('Blocked warns about sessions it covers', () => {
    const w = CS.check({ type: 'CCAC', date: '2026-10-28', time: '', location: 'Closed', reps: [] }, rows, committee, NOW, settings).warnings;
    expect(w.join(' ')).toMatch(/Scout 1's Pre-Review Call is booked/);
    const w2 = CS.check({ type: 'CCAC', date: '2026-10-22', time: '18:00', minutes: 120, location: 'Mtg', reps: [] }, rows, committee, NOW, settings).warnings;
    expect(w2.join(' ')).toMatch(/1 open session overlaps/);
  });

  it('a whole-day block shows as all-day and blocks sessions that day', () => {
    const r2 = rows.concat([{ _row: 7, _key: 'SL_E', date: day(27), time: '', slot_type: 'Blocked', location: 'Holiday' }]);
    const e = CS.entries(r2, settings).find(x => x.key === 'SL_E');
    expect(e).toMatchObject({ allDay: true, start: new Date(2026, 9, 27).getTime(), end: new Date(2026, 9, 28).getTime(), label: 'Blocked' });
    expect(CS.check(input(), r2, committee, NOW, settings).warnings[0]).toMatch(/Overlaps "Holiday" \(10\/27\)/);
  });

  it('marks shadow bookings and shadow types (not booked online yet)', () => {
    const r2 = rows.concat([{ _row: 8, _key: 'SL_S', date: day(26), time: '7:00 PM', slot_type: 'ESSPPR', reps: 'MA', scout_name: 'Scout 2', record_id: 'R-2', event_id: 'shadow' }]);
    expect(CS.entries(r2, settings).find(x => x.key === 'SL_S')).toMatchObject({ booked: true, shadow: true });
    expect(CS.entries(r2, settings).find(x => x.key === 'SL_B').shadow).toBe(false);
    const t = CS.typeDefaults(Object.assign({}, settings, { onlineBooking: 'Pre-Review Call' }));
    expect(t.map(x => x.shadow)).toEqual([false, true, true, undefined]);
  });
});


describe('Reserved slots + staffed before bookable (reserved-slots-design.md)', () => {
  const R = [
    { _key: 'K1', date: day(22), time: '7:00 PM', slot_type: 'EBoR', reps: 'MA', reserved: true, unit: 'T945', location: 'Mt. Olive' },
    { _key: 'K2', date: day(23), time: '7:00 PM', slot_type: 'EBoR', reps: '' },
    { _key: 'K3', date: day(24), time: '7:00 PM', slot_type: 'EBoR', reps: '', scout_name: 'Scout 3', record_id: 'R-3', unit: 'T92' },
    { _key: 'K4', date: day(25), time: '7:00 PM', slot_type: 'EBoR', reps: '', reserved: 'TRUE' },
    { _key: 'K5', date: day(26), time: '7:00 PM', slot_type: 'CCAC', location: 'Meeting' },
    { _key: 'K6', date: new Date(2026, 11, 20), time: '7:00 PM', slot_type: 'EBoR', reps: '' }   // beyond 30 days
  ];
  it('entries mark reserved (with the unit) and unstaffed; Blocked is never unstaffed', () => {
    const e = CS.entries(R, settings);
    const by = Object.fromEntries(e.map(x => [x.key, x]));
    expect(by.K1).toMatchObject({ reserved: true, unstaffed: false, unit: 'T945', booked: false });
    expect(by.K2).toMatchObject({ reserved: false, unstaffed: true });
    expect(by.K3).toMatchObject({ booked: true, reserved: false, unstaffed: true });
    expect(by.K5.unstaffed).toBe(false);
  });
  it('check writes Reserved + unit (unit only when reserved); no lead-time warning on a reserved slot', () => {
    const r = CS.check(input({ type: 'EBoR', reserved: true, unit: 'T945', date: '2026-10-21' }), [], committee, NOW, { ...settings, eborLeadHours: 336 });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.cells).toMatchObject({ reserved: true, unit: 'T945' });
    expect(CS.check(input({ unit: 'T945' }), [], committee, NOW, settings).cells).toMatchObject({ reserved: '', unit: '' });
  });
  it('booking a Scout leaves Reserved/unit to the booking, and warns on another unit', () => {
    const r = CS.check(input({ type: 'EBoR', recordId: 'R-9', reserved: true, unit: 'T945', scoutUnit: 'Troop 92' }), [], committee, NOW, settings);
    expect(r.cells.reserved).toBeUndefined();
    expect(r.cells.unit).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/reserved for T945/);
    expect(CS.check(input({ type: 'EBoR', recordId: 'R-9', reserved: true, unit: 'T945', scoutUnit: 'Troop 945' }), [], committee, NOW, settings).warnings).toEqual([]);
  });
  it('a Blocked entry is never reserved', () => {
    expect(CS.check(input({ type: 'CCAC', location: 'Meeting', reserved: true, unit: 'T1' }), [], committee, NOW, settings).cells).toMatchObject({ reserved: '', unit: '' });
  });
  it('attention: unstaffed within 30 days (booked, then reserved, then open); reserved with no Scout within 14 days', () => {
    const a = CS.attention(R, NOW, settings);
    expect(a.unstaffed.map(x => x.key)).toEqual(['K3', 'K4', 'K2']);
    expect(a.reserved.map(x => x.key)).toEqual(['K1', 'K4']);
  });
});

describe('Moving a booked session (checkMove, 2026-10-29)', () => {
  const booked = rows[1];   // Intake, 10/28 7:00 PM, Scout 1
  const at = (d, h) => new Date(2026, 9, d, h, 0).getTime();
  it('keeps the type; the old session must still be ahead', () => {
    expect(CS.checkMove(booked, { type: 'Intake' }, at(29, 19), NOW, settings).errors).toEqual([]);
    expect(CS.checkMove(booked, { type: 'ESSPPR' }, at(29, 19), NOW, settings).errors[0]).toMatch(/can't change type/);
    expect(CS.checkMove(booked, { type: 'Intake' }, at(29, 19), at(28, 20), settings).errors[0]).toMatch(/already started/);
  });
  it('warns when the new time is less than 24 hours away (unit named for an EBoR)', () => {
    expect(CS.checkMove(booked, { type: 'Intake' }, at(21, 8), NOW, settings).warnings[0]).toMatch(/less than 24 hours.*Scout and family/);
    const ebor = Object.assign({}, booked, { slot_type: 'EBoR' });
    expect(CS.checkMove(ebor, { type: 'EBoR' }, at(21, 8), NOW, settings).warnings[0]).toMatch(/family and unit/);
    expect(CS.checkMove(booked, { type: 'Intake' }, at(23, 19), NOW, settings).warnings).toEqual([]);
  });
  it('check() on the moved booking: its own row is ignored, a member double-booked is flagged', () => {
    const mv = input({ key: 'SL_B', type: 'Intake', recordId: 'R-1', date: '2026-10-22', time: '19:00', reps: ['MA'] });
    const r = CS.check(mv, rows, committee, NOW, settings);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/MA already has a Proposal Review/);
    expect(r.cells.reserved).toBeUndefined();   // a booking: Reserved / unit cells are never written
  });
});
