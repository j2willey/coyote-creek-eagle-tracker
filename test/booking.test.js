import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Booking = require('../apps-script/src/lib/booking.js');

const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const day = (d) => new Date(2026, 9, d);
const rows = [
  { _key: 'SL_261012_AAA', date: day(12), time: '7:00 PM', slot_type: 'Intake', reps: 'MA', duration_min: 20 },
  { _key: 'SL_261014_BBB', date: day(14), time: '7:30 PM', slot_type: 'Intake', reps: 'MB/MC' },
  { _key: 'SL_261013_CCC', date: day(13), time: '7:00 PM', slot_type: 'Intake', scout_name: 'Scout 11' },
  { _key: 'SL_261013_DDD', date: day(13), time: '7:00 PM', slot_type: 'ESSPPR', reps: 'MA' },
  { _key: 'SL_261011_EEE', date: day(11), time: '7:00 PM', slot_type: 'Pre-Review Call' },
  { _key: 'SL_261015_FFF', date: '10/15/2026', time: '7 pm', slot_type: 'Intake', record_id: 'R-9' },
  { date: day(16), time: '7:00 PM', slot_type: 'Intake' },
  { _key: 'SL_261019_GGG', date: day(19), time: '6:30 PM', slot_type: 'CCAC', duration_min: 90 },
  { _key: 'SL_261019_HHH', date: day(19), time: '7:00 PM', slot_type: 'intake', reps: 'MA' },
  { _key: 'SL_261019_JJJ', date: day(19), time: '8:00 PM', slot_type: 'Intake', reps: 'MA' }
];

describe('Booking times and types', () => {
  it('parses the time formats in the sheet', () => {
    expect(Booking.parseTime('7:00 PM')).toEqual({ h: 19, m: 0 });
    expect(Booking.parseTime('7 pm')).toEqual({ h: 19, m: 0 });
    expect(Booking.parseTime('12:15 AM')).toEqual({ h: 0, m: 15 });
    expect(Booking.parseTime('19:30')).toEqual({ h: 19, m: 30 });
    expect(Booking.parseTime('evening')).toBeNull();
    expect(Booking.slotStart('10/15/2026', '7 pm')).toBe(new Date(2026, 9, 15, 19).getTime());
  });

  it('reads short slot type codes and old long names', () => {
    expect(Booking.typeCode('Intake')).toBe('Intake');
    expect(Booking.typeCode('pre-review call')).toBe('Intake');
    expect(Booking.typeCode('ESSPPR')).toBe('ESSPPR');
    expect(Booking.typeCode('Proposal Review')).toBe('ESSPPR');
    expect(Booking.typeCode('ebor')).toBe('EBoR');
    expect(Booking.typeCode('No EBORs')).toBe('');
    expect(Booking.label('Intake')).toBe('Pre-Review Call');
  });

  it('splits multivalued Who cells on , / ;', () => {
    expect(Booking.splitWho('JW/AB, CD ; EF')).toEqual(['JW', 'AB', 'CD', 'EF']);
    expect(Booking.splitWho('')).toEqual([]);
  });
});

describe('Booking slot keys', () => {
  it('SL_yymmdd_XXX from the slot date, unique', () => {
    const k = Booking.makeSlotKey(day(14).getTime(), [], () => 0);
    expect(k).toBe('SL_261014_AAA');
    expect(Booking.makeSlotKey(day(14).getTime(), [k], () => 0.5)).not.toBe(k);
  });

  it('keys only dated rows without a key', () => {
    const m = Booking.missingKeys([{ _key: 'SL_1' }, { date: day(16), time: '7:00 PM' }, { time: '7:00 PM' }, {}], () => 0);
    expect(m).toEqual([{ index: 1, key: 'SL_261016_AAA' }]);
  });
});

describe('Booking slots', () => {
  it('lists open future slots of the type, past the lead time, soonest first', () => {
    const open = Booking.openSlots(rows, 'Intake', NOW, 12);
    expect(open.map(s => s.key)).toEqual(['SL_261014_BBB', 'SL_261019_JJJ']);   // HHH is inside the CCAC meeting
    expect(open[0].who).toEqual(['MB', 'MC']);
    expect(Booking.openSlots(rows, 'Intake', NOW, 0)[0].key).toBe('SL_261012_AAA');
  });

  it('finds the record’s upcoming booking', () => {
    const b = Booking.currentBooking(rows, 'R-9', 'Intake', NOW);
    expect(b.key).toBe('SL_261015_FFF');
    expect(Booking.currentBooking(rows, 'R-9', 'Intake', new Date(2026, 9, 20).getTime())).toBeNull();
  });

  it('cancel cutoff and stage gate', () => {
    expect(Booking.canCancel(NOW + 25 * 3600e3, NOW, 24)).toBe(true);
    expect(Booking.canCancel(NOW + 23 * 3600e3, NOW, 24)).toBe(false);
    expect(Booking.bookableType('intake_to_book')).toBe('Intake');
    expect(Booking.bookableType('proposal_incomplete')).toBeNull();
  });

  it('resolves initials (or names) to committee members', () => {
    const c = [{ name: 'Member A', initials: 'MA', email: 'Pat.Tester+Member_A@example.com' }, { name: 'Member B', initials: 'MB', email: '' }];
    const r = Booking.resolveWho(['ma', 'Member B', 'ZZ'], c);
    expect(r.emails).toEqual(['pat.tester+member_a@example.com']);
    expect(r.names).toEqual(['Member A', 'Member B', 'ZZ']);
    expect(r.unknown).toEqual(['ZZ']);
  });

  it('event text carries the adult-21+ reminder', () => {
    const t = Booking.eventText('Pre-Review Call', 'Scout Nine', 'T109', 'Member B', 'Wed 10/14 7:30 PM');
    expect(t.summary).toBe('Pre-Review Call: Scout Nine (T109)');
    expect(t.description).toContain('21 or older');
  });
});

describe('Proposal Review (S1)', () => {
  it('opens from Pending Review Date, with its own rules', () => {
    expect(Booking.bookableType('review_to_book')).toBe('ESSPPR');
    const r = Booking.rules('ESSPPR');
    expect(r).toMatchObject({ virtual: false, showWho: false, adult: true, movesTo: 'review_booked', cancelBackTo: 'review_to_book' });
    expect(Booking.rules('EBoR').adult).toBe(false);
    expect(Booking.rules('Intake')).toMatchObject({ virtual: true, showWho: true, adult: true, movesTo: 'intake_booked', cancelBackTo: 'intake_to_book' });
  });

  it('lists ESSPPR slots with their place', () => {
    const open = Booking.openSlots(rows, 'ESSPPR', NOW, 0);
    expect(open.map(s => s.key)).toEqual(['SL_261013_DDD']);
  });

  it('invite text: in person, where, no panel names', () => {
    const t = Booking.inviteText('ESSPPR', 'Scout Nine', 'T109', 'Member A', 'Tue 10/13 7:00 PM',
      { location: 'East Valley YMCA', address: '1 Fake St' });
    expect(t.summary).toBe('Proposal Review: Scout Nine (T109)');
    expect(t.description).toContain('Where: East Valley YMCA, 1 Fake St');
    expect(t.description).not.toContain('Member A');
  });

  it('finds guests to add when reps sign up later', () => {
    expect(Booking.missingGuests(['A@x.org', 'b@x.org', 'b@x.org'], ['a@x.org'])).toEqual(['b@x.org']);
  });

  it('booking-link email per stage', () => {
    expect(Booking.bookingLinkEmail('ESSPPR', 'Scout Nine', 'https://x/signin').subject).toMatch(/Proposal Review/);
    expect(Booking.bookingLinkEmail('Intake', 'Scout Nine', 'https://x/signin').subject).toMatch(/Pre-Review Call/);
  });
});

describe('phased online booking (Settings → onlineBooking)', () => {
  const Booking = require('../apps-script/src/lib/booking.js');
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  const s = (v) => ({ onlineBooking: v });

  it('Phase 1 default: only the Pre-Review Call is booked online', () => {
    const d = SettingsModel.parse([]);
    expect(d.onlineBooking).toBe('Pre-Review Call');
    expect(Booking.onlineType('intake_to_book', d)).toBe('Intake');
    expect(Booking.onlineType('review_to_book', d)).toBeNull();
    expect(Booking.onlineType('app_verified', d)).toBeNull();
    expect(Booking.committeeType('review_to_book', d)).toBe('ESSPPR');
    expect(Booking.committeeType('intake_to_book', d)).toBeNull();
    expect(Booking.committeeType('proposal_approved', d)).toBeNull();          // nothing to schedule there
  });

  it('reads lists, codes, all and none', () => {
    expect(Booking.parseOnline('Pre-Review Call, Proposal Review').codes).toEqual(['Intake', 'ESSPPR']);
    expect(Booking.parseOnline('intake; ESSPPR; EBoR').codes).toEqual(['Intake', 'ESSPPR', 'EBoR']);
    expect(Booking.parseOnline('All').codes).toEqual(['Intake', 'ESSPPR', 'EBoR']);
    expect(Booking.parseOnline('').codes).toEqual([]);
    expect(Booking.parseOnline('none').codes).toEqual([]);
    expect(Booking.onlineType('app_verified', s('all'))).toBe('EBoR');
  });

  it('an unknown name is reported and never turns anything on', () => {
    const p = Booking.parseOnline('Pre-Review Call, Board');
    expect(p.codes).toEqual(['Intake']);
    expect(p.error).toMatch(/Board/);
    expect(Booking.parseOnline('Committee Meeting').codes).toEqual([]);   // a slot type, but not bookable
  });

  it('status the Scout sees while the committee schedules', () => {
    expect(Booking.committeeStatus('ESSPPR')).toBe('Proposal Review: the committee will contact you to schedule it');
  });
});

describe('Booking.matchScout (committee types a name into a schedule slot)', () => {
  const Booking = require('../apps-script/src/lib/booking.js');
  const Units = require('../apps-script/src/lib/units.js');
  const recs = [
    { recordId: 'R-1', scout_name: 'Pat Fake', unit: 'T910' },
    { recordId: 'R-2', scout_name: 'Lee Fake', unit: 'T92' },
    { recordId: 'R-3', scout_name: 'Lee Fake', unit: 'C917' }];
  it('finds one Scout by name, ignoring case and spacing', () => {
    expect(Booking.matchScout(recs, '  pat   FAKE ', '', Units.code)).toEqual({ recordId: 'R-1' });
  });
  it('same name twice: needs the unit, which may be spelled any way', () => {
    expect(Booking.matchScout(recs, 'Lee Fake', '', Units.code).error).toMatch(/2 Scouts.*unit/);
    expect(Booking.matchScout(recs, 'Lee Fake', 'Troop 0092', Units.code)).toEqual({ recordId: 'R-2' });
  });
  it('explains a miss', () => {
    expect(Booking.matchScout(recs, 'Pat Fox', '', Units.code).error).toMatch(/No Scout named/);
    expect(Booking.matchScout(recs, 'Pat Fake', 'T92', Units.code).error).toMatch(/not in unit T92/);
  });
});

describe('Booking.matchScout: short names and several units', () => {
  const Booking = require('../apps-script/src/lib/booking.js');
  const Units = require('../apps-script/src/lib/units.js');
  const recs = [{ recordId: 'R-1', scout_name: 'Margaret Ann Holloway', unit: 'C967' },
                { recordId: 'R-2', scout_name: 'Margaret Stone', unit: 'T92' }];
  it('accepts unambiguous short forms, first name in full', () => {
    expect(Booking.matchScout(recs, 'Margaret Ann H', '', Units.code)).toEqual({ recordId: 'R-1' });
    expect(Booking.matchScout(recs, 'Margaret Holloway', '', Units.code)).toEqual({ recordId: 'R-1' });
    expect(Booking.matchScout(recs, 'Jess Holloway', '', Units.code).error).toMatch(/No Scout/);
    expect(Booking.matchScout(recs, 'Margaret', '', Units.code).error).toMatch(/2 Scouts/);
  });
  it('a Unit cell with two units matches either', () => {
    expect(Booking.matchScout(recs, 'Margaret Ann H', 'C967 T911', Units.code)).toEqual({ recordId: 'R-1' });
    expect(Booking.matchScout(recs, 'Margaret Ann H', 'T911', Units.code).error).toMatch(/not in unit/);
  });
});

describe('Booking.statusEmail', () => {
  const Booking = require('../apps-script/src/lib/booking.js');
  it('status + booking, links to the sign-in page (no credential in it)', () => {
    const m = Booking.statusEmail('Scout Nine', 'Proposal Review booked', 'Your Proposal Review: Tue 10/27 7:00 PM at YMCA.', 'https://x/signin');
    expect(m.subject).toBe('Your Eagle Project status (Scout Nine)');
    expect(m.body).toContain("Scout Nine's Eagle Project stands: Proposal Review booked.");
    expect(m.body).toContain('Tue 10/27 7:00 PM at YMCA');
    expect(m.body).toContain('https://x/signin');
    expect(Booking.statusEmail('A', 'Proposal approved', '', 'u').body).not.toMatch(/\n\n\n/);
  });
});

describe('Booking.guestChanges', () => {
  it('adds new reps and removes only committee members no longer on the slot', () => {
    const r = Booking.guestChanges(['ma@x.org', 'scout@x.org', 'parent@x.org'],
      ['MB@x.org', 'scout@x.org', 'parent@x.org', 'board@x.org'], ['ma@x.org', 'mb@x.org']);
    expect(r).toEqual({ add: ['ma@x.org'], remove: ['mb@x.org'] });
  });
  it('a committee member who is also the parent stays', () => {
    expect(Booking.guestChanges(['parent@x.org'], ['parent@x.org'], ['parent@x.org']).remove).toEqual([]);
  });
});

describe('Whole-day Blocked rows', () => {
  it('hide every open slot that day from Scouts', () => {
    const r = [
      { _key: 'SL_1', date: new Date(2026, 10, 3), time: '7:00 PM', slot_type: 'Intake', reps: 'MA' },
      { _key: 'SL_2', date: new Date(2026, 10, 4), time: '7:00 PM', slot_type: 'Intake', reps: 'MA' },
      { _key: 'SL_3', date: new Date(2026, 10, 3), time: '', slot_type: 'Blocked', location: 'Holiday' }
    ];
    expect(Booking.openSlots(r, 'Intake', new Date(2026, 9, 20).getTime(), 0).map(s => s.key)).toEqual(['SL_2']);
  });
});

describe('Shadow bookings', () => {
  it('types not booked online are shadow; the marker is read case-insensitively', () => {
    const st = { onlineBooking: 'Pre-Review Call' };
    expect(Booking.isShadowType('Intake', st)).toBe(false);
    expect(Booking.isShadowType('ESSPPR', st)).toBe(true);
    expect(Booking.isShadowType('EBoR', { onlineBooking: 'all' })).toBe(false);
    expect(Booking.isShadowType('CCAC', st)).toBe(false);
    expect(Booking.isShadow('Shadow')).toBe(true);
    expect(Booking.isShadow('abc123')).toBe(false);
  });
});

describe('Booking: In-Person Review / EBoR held online', () => {
  const Bk = require('../apps-script/src/lib/booking.js');
  it('online when the type is virtual or the place is "Online …"', () => {
    expect(Bk.isVirtual('Intake', { location: '' })).toBe(true);
    expect(Bk.isVirtual('ESSPPR', { location: 'East Valley YMCA' })).toBe(false);
    expect(Bk.isVirtual('ESSPPR', { location: 'Online (Google Meet)' })).toBe(true);
    expect(Bk.isVirtual('EBoR', { location: ' online' })).toBe(true);
  });
  it('the invitation says online and uses the online adult rule', () => {
    const t = Bk.inviteText('ESSPPR', 'Scout_1', 'T1', '', 'Tue 11/3 7:00 PM', { location: 'Online (Google Meet)', address: '' });
    expect(t.description).toMatch(/Google Meet link in this invitation/);
    expect(t.description).toContain(Bk.ADULT);
    expect(t.description).not.toContain(Bk.ADULT_IN_PERSON);
  });
  it('a booked online slot is not "moved" because it has no place', () => {
    const row = { date: '2026-11-03', time: '7:00 PM', location: 'Online (Google Meet)' };
    expect(Bk.slotChanges(row, { startMs: Bk.slotStart('2026-11-03', '7:00 PM'), location: '' }, 'ESSPPR').placeChanged).toBe(false);
  });
});

describe('Reserved slots + staffed before bookable (reserved-slots-design.md)', () => {
  const now = new Date(2026, 9, 20).getTime();
  const r = [
    { _key: 'A', date: new Date(2026, 10, 3), time: '7:00 PM', slot_type: 'EBoR', reps: 'JW' },                       // open
    { _key: 'B', date: new Date(2026, 10, 4), time: '7:00 PM', slot_type: 'EBoR', reps: '' },                         // unstaffed
    { _key: 'C', date: new Date(2026, 10, 5), time: '7:00 PM', slot_type: 'EBoR', reps: 'JW', reserved: true, unit: 'T945' },
    { _key: 'D', date: new Date(2026, 10, 6), time: '7:00 PM', slot_type: 'EBoR', reps: '', reserved: 'TRUE' },       // reserved + unstaffed
    { _key: 'E', date: new Date(2026, 10, 7), time: '7:00 PM', slot_type: 'EBoR', reps: 'JW', reserved: false }
  ];
  it('Scouts see only staffed, unreserved slots', () => {
    expect(Booking.openSlots(r, 'EBoR', now, 0).map(s => s.key)).toEqual(['A', 'E']);
  });
  it('a committee member booking may fill a reserved slot, never an unstaffed one', () => {
    expect(Booking.openSlots(r, 'EBoR', now, 0, { committee: true }).map(s => s.key)).toEqual(['A', 'C', 'E']);
  });
  it('isReserved reads tick boxes and text', () => {
    expect([true, 'TRUE', 'yes', 'x', 'Reserved'].every(v => Booking.isReserved({ reserved: v }))).toBe(true);
    expect([false, 'FALSE', '', null, undefined, 'no'].some(v => Booking.isReserved({ reserved: v }))).toBe(false);
    expect(Booking.isStaffed({ reps: 'JW/MA' })).toBe(true);
    expect(Booking.isStaffed({ reps: ' ' })).toBe(false);
  });
});

describe('changeWords: what a move changed (2026-10-29)', () => {
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  it('names the parts that changed', () => {
    expect(Booking.changeWords(at(18, 19), at(18, 19), true)).toMatchObject({ text: 'new place', subject: 'place changed', timeChanged: false });
    expect(Booking.changeWords(at(18, 19), at(19, 19), false)).toMatchObject({ text: 'new date', subject: 'moved' });
    expect(Booking.changeWords(at(18, 19), at(18, 18, 30), false).text).toBe('new time');
    expect(Booking.changeWords(at(18, 19), at(19, 18), false).text).toBe('new date and time');
    expect(Booking.changeWords(at(18, 19), at(19, 18), true)).toMatchObject({ text: 'new date, time and place', subject: 'moved, place changed' });
    expect(Booking.changeWords(NaN, at(19, 18), false).text).toBe('new date, time or place');
  });
});

