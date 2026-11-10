import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Units = require('../apps-script/src/lib/units.js');
const Booking = require('../apps-script/src/lib/booking.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');

const rows = [
  { 'Unit': 'T910', 'Under Review': false, 'Unit Leader Email': 'sm170@x.org', 'Committee Chair Email': 'cc@x.org; other@x.org', 'EBoR Coordinator Email': '' },
  { 'Unit': 'C910', 'Under Review': 'yes', 'Unit Leader Email': 'Advisor <adv@x.org>', 'Other Contacts': 'SM170@x.org' },
  { 'Unit': 'Troop 92', 'Under Review': '', 'Unit Leader Email': 'sm92@x.org' },
  { 'Unit': '', 'Unit Leader Email': 'nobody@x.org' }
];

describe('Units', () => {
  const units = Units.parse(rows);

  it('reads the Unit Info tab', () => {
    expect(units.map(u => u.code)).toEqual(['t910', 'c910', 't92']);
    expect(units[0].contacts).toEqual(['sm170@x.org', 'cc@x.org', 'other@x.org']);
    expect(units[1].underReview).toBe(true);
    expect(units[0].underReview).toBe(false);
  });

  it('finds a unit by any spelling, never T for C', () => {
    expect(Units.find(units, 'Troop 910').unit).toBe('T910');
    expect(Units.find(units, 'C910').underReview).toBe(true);
    expect(Units.find(units, 'T999')).toBeNull();
  });

  it('an adult can be a contact for several units', () => {
    expect(Units.forEmail(units, 'SM170@x.org').map(u => u.unit)).toEqual(['T910', 'C910']);
  });

  it('board members round-trip, leniently', () => {
    const b = Units.parseBoard('Pat Fake, PAT@x.org, 408-555-0100; Lee Fake, lee@x.org\nSam Fake');
    expect(b).toEqual([
      { name: 'Pat Fake', email: 'pat@x.org', phone: '408-555-0100' },
      { name: 'Lee Fake', email: 'lee@x.org', phone: '' },
      { name: 'Sam Fake', email: '', phone: '' }]);
    expect(Units.formatBoard(b)).toBe('Pat Fake, pat@x.org, 408-555-0100; Lee Fake, lee@x.org; Sam Fake');
  });

  it('validates the board from the unit page', () => {
    expect(Units.validateBoard([{ name: 'A', email: 'a@x.org' }, {}]).ok).toBe(true);
    expect(Units.validateBoard([{ email: 'a@x.org' }]).ok).toBe(false);
    expect(Units.validateBoard([{ name: 'A', email: 'bad' }]).ok).toBe(false);
    expect(Units.validateBoard(Array(7).fill({ name: 'A' })).ok).toBe(false);
  });

});

describe('EBoR booking rules', () => {
  it('opens at Application Verified, moves to EBoR Scheduled', () => {
    expect(Booking.bookableType('app_verified')).toBe('EBoR');
    expect(Booking.rules('EBoR')).toMatchObject({ movesTo: 'ebor_booked', cancelBackTo: 'app_verified', notifyUnit: true, lead: 'eborLeadHours' });
    const s = SettingsModel.parse([]);
    expect(s.eborLeadHours).toBe(336);
    expect(s.bookingLeadHours).toBe(48);
    expect(s.reviewLeadHours).toBe(48);
    expect(SettingsModel.sectionLabel(s, 'app_verified')).toBe('Application Verified');
  });

  it('notices when a member moved a booked slot', () => {
    const row = { date: new Date(2026, 10, 4), time: '7:30 PM', location: 'Troop hall', address: '' };
    const same = { startMs: new Date(2026, 10, 4, 19, 30).getTime(), location: 'Troop hall' };
    expect(Booking.slotChanges(row, same, 'EBoR')).toMatchObject({ timeChanged: false, placeChanged: false });
    const moved = { startMs: new Date(2026, 10, 2, 19, 0).getTime(), location: 'East Valley YMCA' };
    expect(Booking.slotChanges(row, moved, 'EBoR')).toMatchObject({ timeChanged: true, placeChanged: true });
    expect(Booking.slotChanges(row, moved, 'Intake').placeChanged).toBe(false);   // virtual: place ignored
  });

  it('EBoR invite text', () => {
    const t = Booking.inviteText('EBoR', 'Scout Nine', 'T910', '', 'Wed 11/4 7:30 PM', { location: 'YMCA', address: '1 Fake St' });
    expect(t.summary).toBe('Eagle Board of Review: Scout Nine (T910)');
    expect(t.description).toContain('Field uniform');
  });
});

describe('EBoR page: phase and others to invite', () => {
  it('page phase by section', () => {
    expect(SettingsModel.pagePhase('proposal_incomplete')).toBe('proposal');
    expect(SettingsModel.pagePhase('app_verified')).toBe('ebor');
    expect(SettingsModel.pagePhase('ebor_booked')).toBe('ebor');
    expect(SettingsModel.pagePhase('proposal_approved')).toBe('status');
  });

  it('others to invite round-trip and validate', () => {
    const list = Units.parseCc('Mom@x.org (mom); sm@x.org (new Scoutmaster); junk');
    expect(list).toEqual([{ email: 'mom@x.org', note: 'mom' }, { email: 'sm@x.org', note: 'new Scoutmaster' }]);
    expect(Units.formatCc(list)).toBe('mom@x.org (mom); sm@x.org (new Scoutmaster)');
    expect(Units.validateCc([{ email: 'bad' }]).ok).toBe(false);
    expect(Units.validateCc([{ email: 'a@x.org', note: 'x' }, {}]).list).toHaveLength(1);
  });
});

describe('Units: under review marks and board size', () => {
  const U = require('../apps-script/src/lib/units.js');
  it('any mark counts as under review; blank / no / false do not', () => {
    expect([true, 'TRUE', 'Yes', 'x', 'Restricted', 'under review'].map(U.truthy)).toEqual([true, true, true, true, true, true]);
    expect([false, '', null, 'FALSE', 'No', 'n', '0', '-'].map(U.truthy)).toEqual([false, false, false, false, false, false, false, false]);
  });
  it('board size = district/council members on the slot + Unit Board Members', () => {
    expect(U.boardSize('JW, AB', 'Pat Q, pq@x.org; Lee R, lr@x.org')).toBe(4);
    expect(U.boardSize('JW', '')).toBe(1);
    expect(U.boardSize('', '')).toBe(0);
  });
});

describe('Units: Under Review column found by name', () => {
  const U = require('../apps-script/src/lib/units.js');
  it('accepts "Under review" / "Board Restriction" headers', () => {
    expect(U.combine([{ Unit: 'T945', 'Under review': true }], [], [])[0].underReview).toBe(true);
    expect(U.combine([{ Unit: 'Troop 610', 'Board Restriction': 'Yes' }], [], [])[0].underReview).toBe(true);
    expect(U.combine([{ Unit: 'T1', 'Under Review': false }], [], [])[0].underReview).toBe(false);
  });
});

describe('Units: Key 3 roles', () => {
  const U = require('../apps-script/src/lib/units.js');
  it('Unit Leader / Cubmaster / Scoutmaster / Crew Advisor count as the unit leader; COR and assistants do not', () => {
    expect(['Unit Leader', 'Cubmaster', 'Scoutmaster', 'Crew Advisor', 'Skipper'].map(r => U.key3Role(r, ''))).toEqual(Array(5).fill('Unit Leader'));
    expect(U.key3Role('Committee Chair', '')).toBe('Committee Chair');
    expect(U.key3Role('', 'Cubmaster')).toBe('Unit Leader');
    expect(['Chartered Org Rep', 'Assistant Scoutmaster', 'Treasurer', ''].map(r => U.key3Role(r, ''))).toEqual(['', '', '', '']);
  });
  it('combine picks up a Cubmaster row as a unit contact', () => {
    const u = U.combine([], [{ Unit: 'P42', Role: 'Cubmaster', Position: '', Email: 'cm@example.org' }, { Unit: 'P42', Role: 'Chartered Org Rep', Email: 'cor@example.org' }], []);
    expect(u[0].contacts).toEqual(['cm@example.org']);
  });
});

describe('Units: crew advisor titles and packs', () => {
  const U = require('../apps-script/src/lib/units.js');
  it('long advisor titles count; associate advisors and den leaders do not', () => {
    expect(['Venturing Crew Advisor', 'Crew Advisor', 'Advisor'].map(r => U.key3Role(r, ''))).toEqual(['Unit Leader', 'Unit Leader', 'Unit Leader']);
    expect(['Associate Advisor', 'Crew Associate Advisor', 'Den Leader'].map(r => U.key3Role(r, ''))).toEqual(['', '', '']);
  });
  it('Pack 110 = P110; Crew 163 = C163; Venturing Crew 9 = C9', () => {
    expect(U.code('Pack 110')).toBe(U.code('P110'));
    expect(U.code('Crew 163')).toBe(U.code('C163'));
    expect(U.code('Venturing Crew 9')).toBe('c9');
    expect(U.code('Troop 41')).toBe('t41');
  });
});

