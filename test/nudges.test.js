import { describe, it, expect } from 'vitest';
import Nudges from '../apps-script/src/lib/nudges.js';

const H = 3600e3, D = 24 * H, now = Date.UTC(2026, 9, 24, 12);

describe('Nudges', () => {
  it('stageSince resets on a new section and counts days otherwise', () => {
    const r = Nudges.stageSince([
      { recordId: 'A', section: 'review_to_book', since: 'review_to_book 2026-10-10' },
      { recordId: 'B', section: 'review_to_book', since: 'intake_to_book 2026-10-01' },
      { recordId: 'C', section: 'app_verified', since: '' }], '2026-10-24');
    expect(r.days).toEqual({ A: 14, B: 0, C: 0 });
    expect(r.updates).toEqual([{ recordId: 'B', value: 'review_to_book 2026-10-24' }, { recordId: 'C', value: 'app_verified 2026-10-24' }]);
  });
  it('pleaseBook fires at 7 and 14 days, online types only, once', () => {
    const recs = [{ recordId: 'A', section: 'review_to_book', days: 7 }, { recordId: 'B', section: 'intake_to_book', days: 15 },
      { recordId: 'C', section: 'app_verified', days: 9 }, { recordId: 'D', section: 'review_to_book', days: 30 },
      { recordId: 'E', section: 'review_to_book', days: 3 }];
    const out = Nudges.pleaseBook(recs, ['Intake', 'ESSPPR'], { 'pb:A:review_to_book:7': true });
    expect(out.map(x => x.key)).toEqual(['pb:B:intake_to_book:14']);
  });
  it('pleaseBookDays: per session type; EBoR once by default (24 months to hold it), a type can be turned off', () => {
    const P = Nudges.parseBookDays;
    expect(P('').days).toEqual({ Intake: [7, 14], ESSPPR: [7, 14], EBoR: [7] });
    expect(P('Intake 7,14; ESSPPR 7,14; EBoR 7').days).toEqual({ Intake: [7, 14], ESSPPR: [7, 14], EBoR: [7] });
    expect(P('Eagle Board of Review; Proposal Review 10').days).toEqual({ Intake: [7, 14], ESSPPR: [10], EBoR: [] });
    expect(P('Pre-Review Call 14, 7, 7').days.Intake).toEqual([7, 14]);
    expect(P('Bogus 3').errors[0]).toMatch(/unknown session type "Bogus"/);
    const all = ['Intake', 'ESSPPR', 'EBoR'];
    const recs = (sec, d) => [{ recordId: 'X', section: sec, days: d }];
    const keys = (r, plan) => Nudges.pleaseBook(r, all, {}, plan).map(x => x.key);
    expect(keys(recs('app_verified', 7))).toEqual(['pb:X:app_verified:7']);           // default plan
    expect(keys(recs('app_verified', 14))).toEqual([]);                                 // no second EBoR reminder
    expect(keys(recs('review_to_book', 14))).toEqual(['pb:X:review_to_book:14']);
    expect(keys(recs('review_to_book', 21))).toEqual([]);                               // a week after the last mark: digest only
    expect(keys(recs('app_verified', 8), P('EBoR').days)).toEqual([]);                  // turned off
    expect(keys(recs('review_to_book', 12), P('ESSPPR 10').days)).toEqual(['pb:X:review_to_book:10']);
  });
  it('boardMissing: within 7 days, not under review, empty board, once per slot+start', () => {
    const s = (k, o) => Object.assign({ key: k, recordId: 'R' + k, start: now + 3 * D, section: 'ebor_booked', board: '', underReview: false }, o);
    const out = Nudges.boardMissing([s('1'), s('2', { board: 'Pat Q <p@x.org>' }), s('3', { underReview: true }),
      s('4', { start: now + 9 * D }), s('5', { section: 'ebor_paused' }), s('6')], now, 7, { ['bm:6:' + (now + 3 * D)]: true });
    expect(out.map(x => x.key)).toEqual(['1']);
  });
  it('briefings: within 24 h with members', () => {
    const out = Nudges.briefings([{ key: 'a', recordId: 'R', start: now + 20 * H, reps: 'JW' }, { key: 'b', recordId: 'R', start: now + 30 * H, reps: 'JW' },
      { key: 'c', recordId: 'R', start: now + 2 * H, reps: '' }, { key: 'd', recordId: '', start: now + 2 * H, reps: 'JW' }], now, {});
    expect(out.map(x => x.nudgeKey)).toEqual(['br:a:' + (now + 20 * H)]);
  });
  it('awaiting: unstaffed sessions and reserved slots', () => {
    const g = Nudges.awaiting({ unstaffed: [{ what: 'Eagle Board of Review: Scout 3 (T92)', when: 'Sat 10/24 7:00 PM', booked: true }],
      reserved: [{ what: 'Eagle Board of Review for T945, Mt. Olive', when: 'Thu 10/22 7:00 PM' }] });
    expect(g.map(x => x.title)).toEqual(['Sessions with no committee member (not bookable until one signs up)', 'Reserved slots with no Scout yet']);
    expect(g[0].items[0]).toBe('Eagle Board of Review: Scout 3 (T92), Sat 10/24 7:00 PM: a Scout is booked');
  });
  it('awaiting orders groups and drops empty ones', () => {
    const g = Nudges.awaiting({ toBook: [{ title: 'A', stage: 'Proposal Review To Book', days: 3, type: 'ESSPPR' },
      { title: 'B', stage: 'Application Verified', days: 10, type: 'EBoR' }, { title: 'D', stage: 'Proposal Review To Book', days: 8, type: 'ESSPPR' }],
      files: [{ title: 'C (T1)', days: 1 }] });
    expect(g.map(x => x.title)).toEqual(['New files to check', 'Scouts waiting to book a Proposal Review',
      'Scouts waiting to book an Eagle Board of Review (EBoR)']);
    expect(g[1].items).toEqual(['D: Proposal Review To Book, 8 days', 'A: Proposal Review To Book, 3 days']);
    expect(g[2].items[0]).toBe('B: Application Verified, 10 days');
  });
});

describe('reviewsDue (digest: reviews with no outcome yet)', () => {
  // now = Sat 10/24 noon UTC; slot dates as local Date objects like the schedule sheet gives
  const row = (id, type, d, time) => ({ record_id: id, slot_type: type, date: new Date(2026, 9, d), time });
  const rows = [row('A', 'Intake', 20, '7:00 PM'), row('B', 'Intake', 20, '7:00 PM'), row('C', 'ESSPPR', 21, '7:00 PM'),
    row('D', 'EBoR', 30, '7:00 PM'), row('', 'Intake', 20, '7:00 PM')];
  const sections = { A: 'intake_booked', B: 'review_booked', C: 'review_booked', D: 'ebor_booked' };
  it('only when the Scout is still in the Booked stage of that session\'s type', () => {
    const due = Nudges.reviewsDue(rows, (id) => sections[id] || '', now);
    expect(due.map(x => x.recordId)).toEqual(['A', 'C']);   // B held a Pre-Review Call and is now booked for the Review: done
    expect(due[0].type).toBe('Intake');
  });
});

