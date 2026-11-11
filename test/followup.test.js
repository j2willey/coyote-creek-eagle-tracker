// Follow-Up / Consult (Jim W., 2026-11-11): committee-made only, never open for booking, on the committee calendar, the
// Scout's page and the unit calendar; no tracking move or date. Fictional data only.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Booking = require('../apps-script/src/lib/booking.js');
const CS = require('../apps-script/src/lib/committeeSchedule.js');
const SA = require('../apps-script/src/lib/stageActions.js');
const UC = require('../apps-script/src/lib/unitCalendar.js');
const OT = require('../apps-script/src/lib/openTimes.js');
const Nudges = require('../apps-script/src/lib/nudges.js');
const SM = require('../apps-script/src/lib/settingsModel.js');
const TC = require('../apps-script/src/lib/templateCatalog.js');
const T = require('../apps-script/src/lib/templates.js');

const NOW = new Date(2026, 10, 11, 12, 0).getTime();
const day = (d, h = 0) => new Date(2026, 10, d, h);
const committee = [{ name: 'Member A', initials: 'MA', email: 'ma@example.org' }, { name: 'Member B', initials: 'MB', email: 'mb@example.org' }];
const settings = { intakeMinutes: 20, reviewMinutes: 60, eborMinutes: 90, followupMinutes: 30, defaultLocation: 'Test Y', defaultAddress: '1 Fake St' };
const fu = (o) => Object.assign({ _key: 'SL_261112_FFF', date: day(12), time: '5:00 PM', slot_type: 'Followup', reps: 'MA', duration_min: 30,
  location: 'Online (Google Meet)', scout_name: 'Scout 1', unit: 'T999', record_id: 'R-1', event_id: 'ev1' }, o);

describe('Follow-Up / Consult: the type', () => {
  it('is labelled Follow-Up / Consult; the old label and "consult" are aliases', () => {
    expect(Booking.label('Followup')).toBe('Follow-Up / Consult');
    ['Followup', 'follow-up', 'Follow up', 'consult', 'Consult', 'Follow-Up / Consult', 'follow-up review'].forEach((c) => expect(Booking.typeCode(c), c).toBe('Followup'));
  });
  it('is committee-only: not bookable by Scouts, but a booked type', () => {
    expect(Booking.BOOKABLE).not.toContain('Followup');
    expect(Booking.BOOKED_TYPES).toContain('Followup');
    expect(Booking.isCommitteeOnly('Followup')).toBe(true);
    expect(['Intake', 'ESSPPR', 'EBoR', 'CCAC'].some((c) => Booking.isCommitteeOnly(c))).toBe(false);
    expect(Booking.parseOnline('all').codes).not.toContain('Followup');
    expect(Booking.parseOnline('Follow-Up / Consult').error).toMatch(/unknown/);
  });
  it('never moves the tracking row or fills a tracking column', () => {
    const r = Booking.rules('Followup');
    expect(r).toMatchObject({ committeeOnly: true, multiple: true });
    expect(r.movesTo).toBeUndefined(); expect(r.dateCol).toBeUndefined(); expect(r.whoCol).toBeUndefined();
    ['app_verified', 'review_booked', 'closed', 'ebor_paused'].forEach((s) => expect(CS.moveOnBook(s, 'Followup'), s).toBeNull());
  });
  it('an unbooked Follow-Up row is never open, except to the booking step itself (a committee member naming the Scout)', () => {
    const rows = [fu({ _key: 'SL_X', scout_name: '', record_id: '', event_id: '' })];
    expect(Booking.openSlots(rows, 'Followup', NOW, 0)).toEqual([]);
    expect(Booking.openSlots(rows, 'Followup', NOW, 0, { noLead: true })).toEqual([]);
    expect(Booking.openSlots(rows, 'Intake', NOW, 0, { committee: true })).toEqual([]);
    expect(Booking.openSlots(rows, 'Followup', NOW, 0, { committee: true }).map((x) => x.key)).toEqual(['SL_X']);
  });
  it('online by its place (Meet), in person otherwise', () => {
    expect(Booking.isVirtual('Followup', { location: 'Online (Google Meet)' })).toBe(true);
    expect(Booking.isVirtual('Followup', { location: 'Test Y' })).toBe(false);
  });
});

describe('Follow-Up / Consult: a Scout can have several', () => {
  const rows = [fu({}), fu({ _key: 'SL_B', date: day(20), time: '6:00 PM' }), fu({ _key: 'SL_C', date: day(5), time: '6:00 PM' }),
    fu({ _key: 'SL_D', record_id: 'R-2' }), { _key: 'SL_E', date: day(13), time: '7:00 PM', slot_type: 'Intake', record_id: 'R-1' }];
  it('upcomingBookings lists every upcoming one of the type, soonest first', () => {
    expect(Booking.upcomingBookings(rows, 'R-1', 'Followup', NOW).map((b) => b.key)).toEqual(['SL_261112_FFF', 'SL_B']);
    expect(Booking.upcomingBookings(rows, 'R-1', 'Intake', NOW).map((b) => b.key)).toEqual(['SL_E']);
  });
  it('bookingAt finds the booking in one row, of any booked type', () => {
    expect(Booking.bookingAt(rows, 'R-1', 'SL_B')).toMatchObject({ type: 'Followup', b: { key: 'SL_B', minutes: 30, eventId: 'ev1' } });
    expect(Booking.bookingAt(rows, 'R-2', 'SL_B')).toBeNull();
    expect(Booking.bookingAt([{ _key: 'K', slot_type: 'CCAC', record_id: 'R-1' }], 'R-1', 'K')).toBeNull();
  });
});

describe('Follow-Up / Consult: invitation, emails, log', () => {
  const slot = { location: 'Online (Google Meet)', address: '' };
  it('invitation text names the type, member, time, and the Meet link (online) or the place', () => {
    const t = Booking.inviteText('Followup', 'Scout 1', 'T999', 'Member A', 'Thu 11/12 5:00 PM', slot);
    expect(t.summary).toBe('Follow-Up / Consult: Scout 1 (T999)');
    expect(t.description).toContain('Committee member: Member A');
    expect(t.description).toContain('Google Meet link');
    expect(t.description).toContain('Youth protection');
    expect(Booking.inviteText('Followup', 'Scout 1', 'T999', 'Member A', 'Thu', { location: 'Test Y', address: '1 Fake St' }).description).toContain('Where: Test Y, 1 Fake St');
  });
  it('built-in emails: no cancel link (the Scout can not change it), replies go to the committee', () => {
    const b = Booking.followupBookedEmail('Scout 1', 'Thu 11/12 5:00 PM', 'Member A', 'https://meet.example.org/abc', '');
    expect(b.subject).toBe('Follow-Up / Consult booked: Scout 1, Thu 11/12 5:00 PM');
    expect(b.body).toContain('Join: https://meet.example.org/abc');
    expect(b.body).not.toContain('cancel');
    expect(b.body).not.toContain('Where:');
    expect(Booking.followupCancelledEmail('Scout 1', 'Thu 11/12 5:00 PM').subject).toBe('Follow-Up / Consult cancelled: Scout 1, Thu 11/12 5:00 PM');
  });
  it('log lines', () => {
    expect(Booking.followupLog('booked', 'Thu 11/12 5:00 PM', ['MB'])).toBe('Follow-up / consult booked Thu 11/12 5:00 PM with MB');
    expect(Booking.followupLog('booked', 'Thu 11/12 5:00 PM', ['MB', 'MA'], 'a@example.org')).toBe('Follow-up / consult booked Thu 11/12 5:00 PM with MB/MA (by a@example.org)');
    expect(Booking.followupLog('moved', 'Fri 11/13 5:00 PM', ['MB'])).toBe('Follow-up / consult moved to Fri 11/13 5:00 PM with MB');
    expect(Booking.followupLog('cancelled', 'Thu 11/12 5:00 PM', [], 'MB')).toBe('Follow-up / consult cancelled Thu 11/12 5:00 PM (by MB)');
  });
});

describe('Follow-Up / Consult: the committee schedule page', () => {
  const input = (o) => Object.assign({ type: 'Followup', date: '2026-11-13', time: '17:00', minutes: 30, location: 'Online (Google Meet)', address: '', reps: ['MA'], recordId: 'R-1' }, o);
  it('type defaults: 30 minutes (Settings followupMinutes), online by default with the in-person place kept for unticking', () => {
    const t = CS.typeDefaults(settings).find((x) => x.code === 'Followup');
    expect(t).toMatchObject({ label: 'Follow-Up / Consult', minutes: 30, virtual: false, canBeOnline: true, defaultOnline: true, committeeOnly: true,
      location: 'Online (Google Meet)', inPersonLocation: 'Test Y', inPersonAddress: '1 Fake St', shadow: false, leadHours: 0 });
    expect(CS.typeDefaults({ followupMinutes: 45 }).find((x) => x.code === 'Followup').minutes).toBe(45);
    expect(CS.typeDefaults({}).find((x) => x.code === 'Followup').minutes).toBe(30);
    expect(CS.typeDefaults(settings).map((x) => x.code)).toEqual(['Intake', 'ESSPPR', 'EBoR', 'Followup', 'CCAC']);
  });
  it('Settings has followupMinutes, default 30', () => {
    expect(SM.DEFAULT_VALUES.followupMinutes).toBe(30);
  });
  it('check: a Scout and a member are required (no unbooked follow-ups); online needs no place, in person needs one', () => {
    expect(CS.check(input(), [], committee, NOW, settings).errors).toEqual([]);
    expect(CS.check(input({ recordId: '' }), [], committee, NOW, settings).errors.join(' ')).toMatch(/Pick a Scout/);
    expect(CS.check(input({ reps: [] }), [], committee, NOW, settings).errors.join(' ')).toMatch(/committee member/);
    expect(CS.check(input({ location: '' }), [], committee, NOW, settings).errors).toEqual(['Enter a location.']);
    const inPerson = CS.check(input({ location: 'Test Y', address: '1 Fake St' }), [], committee, NOW, settings);
    expect(inPerson.errors).toEqual([]);
    expect(inPerson.cells).toMatchObject({ slot_type: 'Followup', location: 'Test Y', address: '1 Fake St', duration_min: 30, time: '5:00 PM' });
  });
  it('check: never reserved, no lead time, still warns about overlaps', () => {
    const c = CS.check(input({ reserved: true, unit: 'T999', leadHours: 5 }), [], committee, NOW, settings);
    expect(c.errors).toEqual([]);
    expect(c.cells.reserved).toBeUndefined();            // booking writes unit and clears Reserved itself
    expect(c.cells.lead_hours).toBe('');
    const rows = [{ _row: 3, _key: 'SL_O', date: day(13), time: '5:10 PM', slot_type: 'ESSPPR', reps: 'MA', duration_min: 60 }];
    expect(CS.check(input(), rows, committee, NOW, settings).warnings.join(' ')).toMatch(/MA already has a Proposal Review/);
  });
  it('check: an existing booked follow-up can be moved (key set); the time can not be in the past', () => {
    expect(CS.check(input({ key: 'SL_261112_FFF' }), [], committee, NOW, settings).errors).toEqual([]);
    expect(CS.check(input({ date: '2026-11-10' }), [], committee, NOW, settings).errors).toEqual(['That time is in the past.']);
  });
  it('several times at once is for open sessions only, never a follow-up', () => {
    const r = CS.checkBatch(input({ recordId: '' }), [{ date: '2026-11-13', time: '17:00' }, { date: '2026-11-14', time: '17:00' }], [], committee, NOW, settings);
    expect(r.errors.join(' ')).toMatch(/one at a time/);
  });
  it('Scouts to pick from: every stage but Eagle Earned, including the side sections and Closed', () => {
    const keys = SM.DEFAULT_SECTIONS.map((s) => s.key).filter((k) => k !== 'eagle_earned');
    expect(CS.FOLLOWUP_SECTIONS.slice().sort()).toEqual(keys.slice().sort());
    const records = SM.DEFAULT_SECTIONS.map((s) => ({ recordId: 'R-' + s.key, scout_name: 'Scout ' + s.key, unit: 'T999', section: s.key }));
    const list = CS.scoutChoices(records, (k) => k, () => 'booked').Followup;
    expect(list.map((x) => x.recordId)).not.toContain('R-eagle_earned');
    expect(list.map((x) => x.recordId)).toContain('R-closed');
    expect(list).toHaveLength(keys.length);
    expect(CS.SCOUT_SECTIONS.Followup).toBe(CS.FOLLOWUP_SECTIONS);
    expect(CS.SCOUT_SECTIONS.Intake).not.toContain('closed');   // the other types are unchanged
  });
  it('calendar entries: a booked follow-up is editable (move / members), has its own type, and is never flagged unstaffed or reserved', () => {
    const e = CS.entries([fu({}), fu({ _key: 'SL_U', reps: '' })], settings);
    expect(e[0]).toMatchObject({ type: 'Followup', label: 'Follow-Up / Consult', booked: true, editable: true, minutes: 30, reserved: false, scoutName: 'Scout 1' });
    expect(e[1].unstaffed).toBe(false);
    expect(CS.FORM_TYPES).toContain('Followup');
    expect(CS.CREATE_TYPES).not.toContain('Followup');
  });
  it('moving a booked follow-up uses the same check as other booked sessions', () => {
    const row = fu({});
    expect(CS.checkMove(row, { type: 'Followup' }, new Date(2026, 10, 14, 17).getTime(), NOW, settings).errors).toEqual([]);
    expect(CS.checkMove(row, { type: 'ESSPPR' }, new Date(2026, 10, 14, 17).getTime(), NOW, settings).errors[0]).toMatch(/can't change type/);
  });
  it('is not part of "attention" (unstaffed / reserved) lists', () => {
    const a = CS.attention([fu({ reps: '' })], NOW, settings);
    expect(a.unstaffed).toEqual([]);
    expect(a.reserved).toEqual([]);
  });
});

describe('Follow-Up / Consult: the dashboard row action', () => {
  it('is offered on every stage except Eagle Earned, and opens the schedule page prefilled for a follow-up', () => {
    SM.DEFAULT_SECTIONS.forEach((s) => {
      const a = SA.forSection(s.key).find((x) => x.key === 'followup');
      if (s.key === 'eagle_earned') expect(a, s.key).toBeUndefined();
      else expect(a, s.key).toMatchObject({ label: 'Schedule a follow-up / consult…', page: '/committee/schedule', pageQuery: 'new=Followup' });
    });
  });
  it('covers the same stages as the schedule page list', () => {
    const stages = SM.DEFAULT_SECTIONS.map((s) => s.key).filter((k) => SA.forSection(k).some((a) => a.key === 'followup'));
    expect(stages.slice().sort()).toEqual(CS.FOLLOWUP_SECTIONS.slice().sort());
  });
  it('is a page action: no plan to run on the server', () => {
    expect(SA.plan({ action: 'followup', section: 'review_booked' }).errors).toEqual(['Unknown action.']);
  });
  it('is last in the Action menu', () => {
    expect(SA.forSection('ebor_booked').map((a) => a.key).pop()).toBe('followup');
  });
});

describe('Follow-Up / Consult: never open to youth, never counted as Pre-Review / Proposal Review / EBoR', () => {
  const rows = [fu({}), fu({ _key: 'SL_O', scout_name: '', record_id: '', event_id: '', reps: 'MA' }),
    { _key: 'SL_I', slot_type: 'Pre-Review Call', date: day(14), time: '7:00 PM', duration_min: 20, reps: 'MA' }];
  it('unit calendar: the unit sees its Scout\'s follow-up like other sessions; other units do not; never as an open time', () => {
    const units = { 'R-1': { name: 'Scout_1', unitCode: 't999' } };
    const cal = UC.build(rows, (id) => units[id] || null, ['t999'], ['Intake'], NOW, () => 0);
    expect(cal.booked.map((e) => [e.title, e.type, e.where])).toEqual([['Scout_1', 'Follow-Up / Consult', 'Online (Google Meet)']]);
    expect(UC.build(rows, (id) => units[id] || null, ['t92'], ['Intake'], NOW, () => 0).booked).toEqual([]);
    expect(UC.build(rows, () => null, ['t999'], ['Intake', 'Followup'], NOW, () => 0).open.map((e) => e.code)).toEqual(['Intake']);
  });
  it('open times email: no section books it, nobody is "ready to book" it', () => {
    expect(OT.sectionFor('Followup')).toBeNull();
    expect(OT.recipients([{ recordId: 'R-1', section: 'review_to_book', scout_name: 'Scout 1' }], 'Followup', rows, NOW)).toEqual([]);
    expect(OT.TEMPLATE.Followup).toBeUndefined();
  });
  it('Scouts waiting to book / please-book: Follow-Up is not a To Book type', () => {
    expect(Object.values(Nudges.TO_BOOK)).not.toContain('Followup');
    expect(Nudges.pleaseBook([{ recordId: 'A', section: 'review_booked', days: 30 }], ['Intake', 'ESSPPR', 'EBoR'], {})).toEqual([]);
    expect(Nudges.parseBookDays('Followup 7').errors[0]).toMatch(/unknown session type/);
  });
  it('"Reviews with no outcome yet" ignores a held follow-up', () => {
    expect(Nudges.reviewsDue([fu({ date: day(9), time: '5:00 PM' })], () => 'review_booked', NOW)).toEqual([]);
  });
  it('the dashboard Session column (next Pre-Review / Proposal Review / EBoR) leaves it out', () => {
    const Board = require('../apps-script/src/lib/board.js');
    expect(Board.nextSessions([fu({})], NOW)).toEqual({});
  });
  it('Stats "sessions held" lists only the three review types', () => {
    const Stats = require('../apps-script/src/lib/stats.js');
    const w = Stats.workload([{ type: 'Followup', start: NOW - 86400000, who: ['MA'], booked: true }], 2026, NOW);
    expect(JSON.stringify(w)).not.toContain('MA');
  });
});

describe('Follow-Up / Consult: digest and briefing', () => {
  it('Next 7 days lists a follow-up (with its Scout and members); later ones are left out; reserved slots still show', () => {
    const rows = [fu({}), fu({ _key: 'SL_L', date: day(25) }), fu({ _key: 'SL_R', scout_name: '', record_id: '', slot_type: 'Intake', reserved: 'TRUE', unit: 'T999' })];
    const list = Nudges.upcomingSessions(rows, NOW, 7);
    expect(list.map((x) => [x.type, x.recordId, x.reps, x.reserved])).toEqual([['Followup', 'R-1', 'MA', false], ['Intake', '', 'MA', true]]);
  });
  it('an unbooked, reserved Follow-Up row is not listed as a reserved slot', () => {
    expect(Nudges.upcomingSessions([fu({ scout_name: '', record_id: '', reserved: 'TRUE' })], NOW, 7)).toEqual([]);
  });
  it('the day-before Session briefing includes a follow-up with members on it', () => {
    const slots = [{ key: 'K1', recordId: 'R-1', start: NOW + 5 * 3600e3, reps: 'MA', type: 'Followup' }, { key: 'K2', recordId: 'R-2', start: NOW + 5 * 3600e3, reps: '', type: 'Followup' }];
    expect(Nudges.briefings(slots, NOW, {}).map((x) => x.key)).toEqual(['K1']);
  });
});

describe('Follow-Up / Consult: email templates (6.2.d / e / f)', () => {
  const tab = (lines) => T.parseTab(T.linesToParas(lines));
  const ids = { 'Booked: Follow-Up / Consult': '6.2.d', 'Moved: Follow-Up / Consult': '6.2.e', 'Cancelled: Follow-Up / Consult': '6.2.f' };
  it('are in the catalog with the next free IDs, Mode Review, Cc the group', () => {
    Object.keys(ids).forEach((k) => {
      const x = TC.get(k);
      expect(x, k).toBeTruthy();
      expect([x.id, x.mode, x.cc, x.cls]).toEqual([ids[k], 'review', 'group', 'B']);
      expect(TC.phaseOf(x.id)).toBe('Committee / misc');
      expect(TC.get(ids[k])).toBe(x);
    });
  });
  it('the mail key the booking code builds from the label finds the template', () => {
    ['Booked: ', 'Moved: ', 'Cancelled: '].forEach((p) => expect(TC.get(p + Booking.label('Followup')), p).toBeTruthy());
  });
  it('booked: online shows Join and no Where; in person the reverse; no cancel link', () => {
    const b = TC.get('Booked: Follow-Up / Consult');
    const vars = { scout: 'Scout 1', type: 'Follow-Up / Consult', when: 'Thu 11/12 5:00 PM', with: 'Member A', pageLink: 'https://x/signin' };
    const on = T.render(tab(TC.seedLines(b)), Object.assign({ where: '', meetLink: 'https://meet.example.org/abc' }, vars));
    expect(on.errors).toEqual([]);
    expect(on.subject).toBe('Follow-Up / Consult booked: Scout 1, Thu 11/12 5:00 PM');
    expect(on.text).toContain('Join: https://meet.example.org/abc');
    expect(on.text).not.toContain('Where:');
    expect(on.text).not.toMatch(/cancel/i);
    const off = T.render(tab(TC.seedLines(b)), Object.assign({ where: 'Test Y, 1 Fake St', meetLink: '' }, vars));
    expect(off.text).toContain('Where: Test Y, 1 Fake St');
    expect(off.text).not.toContain('Join:');
  });
  it('moved and cancelled fill their variables', () => {
    const v = { scout: 'Scout 1', type: 'Follow-Up / Consult', when: 'Fri 11/13 5:00 PM', where: '', pageLink: 'https://x/signin' };
    expect(T.render(tab(TC.seedLines(TC.get('Moved: Follow-Up / Consult'))), v).subject).toBe('Follow-Up / Consult changed: Scout 1, now Fri 11/13 5:00 PM');
    expect(T.render(tab(TC.seedLines(TC.get('Cancelled: Follow-Up / Consult'))), v).errors).toEqual([]);
  });
  it('the catalog map lists them', () => {
    const rows = TC.catalogRows(() => null);
    expect(['6.2.d', '6.2.e', '6.2.f'].map((id) => rows.find((r) => r.id === id).name)).toEqual(Object.keys(ids));
  });
});
