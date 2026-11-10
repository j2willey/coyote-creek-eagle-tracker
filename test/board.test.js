import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Board = require('../apps-script/src/lib/board.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');

describe('Board (dashboard tabs)', () => {
  it('age rounds down to one decimal', () => {
    expect(Board.age('2008-11-19', '2026-10-23')).toBe(17.9);
    expect(Board.age('2008-10-24', '2026-10-23')).toBe(17.9);   // day before the 18th birthday
    expect(Board.age('2008-10-23', '2026-10-23')).toBe(18);
    expect(Board.age('', '2026-10-23')).toBeNull();
  });
  it('first line of notes', () => {
    expect(Board.firstLine('10/22 [sheet] Moved\n10/20 older')).toBe('10/22 [sheet] Moved');
    expect(Board.firstLine(null)).toBe('');
  });
  const sections = SettingsModel.parse([]).sections;
  const recs = [
    { recordId: 'R1', section: 'proposal_incomplete', scout_name: 'Scout_1', unit: 'T1', birth: '2009-01-01', notes: 'a\nb', pending: 5, folderId: 'F1' },
    { recordId: 'R2', section: 'review_booked', scout_name: 'Scout_2', unit: 'T2', birth: '2010-06-01', notes: '' },
    { recordId: 'R3', section: 'proposal_approved', scout_name: 'Scout_3', unit: 'T3', birth: '2009-03-01', approved: '2026-10-01' },
    { recordId: 'R4', section: 'eagle_earned', scout_name: 'Scout_4', unit: 'T4', birth: '2008-01-01', ebor: '2026-01-01' },
    { recordId: 'R5', section: 'ebor_paused', scout_name: 'Scout_5', unit: 'T5', birth: '2008-05-01' },
    { recordId: 'R6', section: 'app_verified', scout_name: 'Scout_6', unit: 'T6', birth: '2008-05-01', ebor: '2026-12-07' },
    { recordId: 'R7', section: 'proposal_received', scout_name: '', unit: 'T7' }
  ];
  const tabs = Board.build(recs, sections, '2026-10-23');
  const tab = (k) => tabs.find(t => t.key === k);
  it('splits sections into the five tabs, grouped by stage in sheet order', () => {
    expect(tabs.map(t => t.key)).toEqual(['proposals', 'underway', 'ebors', 'eagles', 'exceptions']);
    expect(tab('proposals').count).toBe(2);
    expect(tab('proposals').pending).toBe(1);
    expect(tab('proposals').groups.find(g => g.key === 'proposal_incomplete').rows[0]).toMatchObject(
      { name: 'Scout_1', age: 17.8, note: 'a', pending: true, folder: 'https://drive.google.com/drive/folders/F1' });
    expect(tab('proposals').groups[0].label).toBe('Proposal Received');
    expect(tab('ebors').count).toBe(1);                                   // paused is an exception
    expect(tab('exceptions').groups.find(g => g.key === 'ebor_paused').rows).toHaveLength(1);
    expect(tab('exceptions').stage).toBe(true);
  });
  it('waiting on Council: paperwork sent, SVMBC Received empty (any mark counts)', () => {
    expect(Board.councilWait('2026-10-15', '', '2026-10-23')).toBe(8);
    expect(Board.councilWait('2026-10-15', '*', '2026-10-23')).toBeNull();
    expect(Board.councilWait('2026-10-15', true, '2026-10-23')).toBeNull();
    expect(Board.councilWait('2026-10-15', false, '2026-10-23')).toBe(8);
    expect(Board.councilWait('', '', '2026-10-23')).toBeNull();
    const t = Board.build([
      { recordId: 'E1', section: 'eagle_earned', scout_name: 'E_1', unit: 'T1', ebor: '2026-10-12', signedSent: '2026-10-13', svmbcReceived: '' },
      { recordId: 'E2', section: 'eagle_earned', scout_name: 'E_2', unit: 'T2', ebor: '2026-10-20', signedSent: '2026-10-21', svmbcReceived: '' },
      { recordId: 'E3', section: 'eagle_earned', scout_name: 'E_3', unit: 'T3', ebor: '2026-10-01', signedSent: '2026-10-02', svmbcReceived: '*' }
    ], sections, '2026-10-23', 7);
    const eagles = t.find(x => x.key === 'eagles');
    expect(eagles.council).toBe(2);
    expect(Board.councilWaiting(t).map(x => [x.title, x.days, x.overdue])).toEqual([['E_1 (T1)', 10, true], ['E_2 (T2)', 2, false]]);
  });
  it('Eagles: age fixed at the EBoR date', () => {
    expect(tab('eagles').groups[0].rows[0].age).toBe(18);
    expect(tab('eagles').ageLocked).toBe(true);
    expect(tab('underway').groups[0].rows[0].age).toBe(17.6);
  });
});

describe('Board EBoR months (like the sheet colours)', () => {
  const B = require('../apps-script/src/lib/board.js');
  it('bands: past / this month / next month / later', () => {
    expect(B.eborBand('2026-10-20', '2026-10-24')).toBe('past');
    expect(B.eborBand('2026-10-29', '2026-10-24')).toBe('this');
    expect(B.eborBand('2026-11-30', '2026-10-24')).toBe('next');
    expect(B.eborBand('2027-01-11', '2026-10-24')).toBe('later');
    expect(B.eborBand('2027-01-11', '2026-12-24')).toBe('next');
    expect(B.eborBand('', '2026-10-24')).toBe('');
  });
  it('EBoR Booked gets month counts and the unit tags', () => {
    const recs = [
      { recordId: 'A', section: 'ebor_booked', scout_name: 'A', ebor: '2026-10-29', underReview: true, unitBoard: false },
      { recordId: 'B', section: 'ebor_booked', scout_name: 'B', ebor: '2026-11-04', underReview: false, unitBoard: false },
      { recordId: 'C', section: 'ebor_booked', scout_name: 'C', ebor: '2027-01-11', underReview: false, unitBoard: null },
      { recordId: 'D', section: 'app_verified', scout_name: 'D', ebor: '' }];
    const t = B.build(recs, [], '2026-10-24').find(x => x.key === 'ebors');
    const g = t.groups.find(x => x.key === 'ebor_booked');
    expect(g.months).toMatchObject({ thisMonth: 1, next: 1, later: 1, thisLabel: 'Oct', nextLabel: 'Nov' });
    expect(g.rows.map(r => [r.band, r.underReview, r.unitReview])).toEqual([['this', true, true], ['next', false, false], ['later', false, false]]);
    expect(t.groups.find(x => x.key === 'app_verified').months).toBeUndefined();
  });
});

describe('Board: EBoR board size', () => {
  const B = require('../apps-script/src/lib/board.js');
  it('board state: short (<3), ok (3-6), big (>6), none without a slot', () => {
    const recs = [
      { recordId: 'A', section: 'ebor_booked', scout_name: 'A', ebor: '2026-11-04', boardSize: 2 },
      { recordId: 'B', section: 'ebor_booked', scout_name: 'B', ebor: '2027-02-04', boardSize: 2 },
      { recordId: 'C', section: 'ebor_booked', scout_name: 'C', ebor: '2027-02-04', boardSize: 8 },
      { recordId: 'D', section: 'ebor_booked', scout_name: 'D', ebor: '2026-11-04', boardSize: null }];
    const rows = B.build(recs, [], '2026-10-24').find(x => x.key === 'ebors').groups.find(g => g.key === 'ebor_booked').rows;
    expect(rows.map(r => r.boardState)).toEqual(['short', 'short', 'big', '']);
  });
});

describe('Board sessions (dashboard Session column + Board tag link, 2026-11-03)', () => {
  const now = new Date(2026, 10, 3, 12).getTime();
  const rows = [
    { _key: 'S1', record_id: 'R1', slot_type: 'Pre-Review Call', date: '2026-11-10', time: '19:00', reps: 'JW, AB' },
    { _key: 'S0', record_id: 'R1', slot_type: 'Pre-Review Call', date: '2026-11-05', time: '19:00', reps: '' },        // earlier: wins
    { _key: 'S2', record_id: 'R2', slot_type: 'Proposal Review', date: '2026-11-03', time: '07:00', reps: 'CD' },      // 5 h ago: still shown
    { _key: 'S3', record_id: 'R3', slot_type: 'Proposal Review', date: '2026-11-02', time: '19:00', reps: 'CD' },      // 17 h ago: gone
    { _key: 'S4', record_id: 'R4', slot_type: 'Eagle Board of Review', date: '2026-11-04', time: '19:00', reps: 'JW/AB' },
    { _key: 'S5', record_id: '', slot_type: 'Proposal Review', date: '2026-11-12', time: '19:00' },                    // open slot
    { _key: 'S6', record_id: 'R6', slot_type: 'Blocked', date: '2026-11-12', time: '19:00' }
  ];
  const n = Board.nextSessions(rows, now);
  it('next booked session per Scout and type', () => {
    expect(n.R1.Intake.key).toBe('S0');
    expect(n.R1.Intake.reps).toEqual([]);
    expect(n.R2.ESSPPR).toMatchObject({ key: 'S2', reps: ['CD'] });
    expect(n.R3).toBeUndefined();
    expect(n.R4.EBoR.reps).toEqual(['JW', 'AB']);
    expect(Object.keys(n).sort()).toEqual(['R1', 'R2', 'R4']);
  });
  it('a row carries only the session its stage is about', () => {
    const recs = [
      { recordId: 'R1', section: 'intake_booked', scout_name: 'A', sessions: n.R1 },
      { recordId: 'R2', section: 'review_to_book', scout_name: 'B', sessions: n.R2 },     // not booked: no session
      { recordId: 'R4', section: 'ebor_booked', scout_name: 'C', boardSize: 4, sessions: { EBoR: { ...n.R4.EBoR, names: ['Pat Q', 'Lee Fake'] } } }];
    const tabs = Board.build(recs, [], '2026-11-03');
    const row = (tab, g) => tabs.find(t => t.key === tab).groups.find(x => x.key === g).rows[0];
    expect(tabs.find(t => t.key === 'proposals').cols).toContain('session');
    expect(row('proposals', 'intake_booked').session).toMatchObject({ key: 'S0', reps: [] });
    expect(row('proposals', 'review_to_book').session).toBeNull();
    expect(row('ebors', 'ebor_booked').session).toMatchObject({ key: 'S4', reps: ['JW', 'AB'], names: ['Pat Q', 'Lee Fake'] });
  });
});
