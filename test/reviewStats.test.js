import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Events = require('../apps-script/src/lib/events.js');
const RS = require('../apps-script/src/lib/reviewStats.js');
const Perf = require('../apps-script/src/lib/perf.js');

describe('Events (_Events tab, 2026-11-17)', () => {
  it('builds rows with initials, never names, and reads them back', () => {
    const at = new Date('2026-11-17T10:00:00');
    const r = Events.row({ event: 'review_outcome', recordId: 'R-1', outcome: 'revisions', date: '2026-11-16', session: 'SL_1', reps: 'ab, cd' }, at);
    expect(r).toMatchObject({ 'Record ID': 'R-1', 'Event': 'review_outcome', 'Outcome': 'revisions', 'Date': '2026-11-16', 'Reps': 'AB CD', 'By': 'system', 'Source': 'live' });
    expect(Object.keys(r)).toEqual(Events.HEADERS);
    expect(() => Events.row({ event: 'nope', recordId: 'R-1' }, at)).toThrow();
    expect(() => Events.row({ event: 'stage' }, at)).toThrow();
    const back = Events.parse([r, { 'Record ID': 'R-2', 'Event': 'junk' }]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ recordId: 'R-1', reps: ['AB', 'CD'], date: '2026-11-16' });
  });
  it('a Pre-Review Call outcome only from a stage after the call', () => {
    expect(Events.intakeOutcome('review_ok', 'intake_booked')).toBe('ready');
    expect(Events.intakeOutcome('intake_revisions', 'intake_revisions')).toBe('changes');
    expect(Events.intakeOutcome('not_approved', 'intake_booked')).toBe('not_approved');
    expect(Events.intakeOutcome('not_approved', 'proposal_received')).toBe('');      // before any call
    expect(Events.intakeOutcome('checked', 'intake_booked')).toBe('');
  });
});

describe('ReviewStats', () => {
  const S = (key, type, recordId, ymd, who) => ({ key, type, recordId, ymd, who });
  const sessions = [
    S('I1', 'Intake', 'A', '2026-09-01', ['AB']), S('P1', 'ESSPPR', 'A', '2026-09-10', ['CD', 'EF']),              // A: approved at review
    S('I2', 'Intake', 'B', '2026-09-02', ['AB']), S('P2', 'ESSPPR', 'B', '2026-09-12', ['CD']), S('P3', 'ESSPPR', 'B', '2026-10-01', ['CD']),  // B: later, 2 reviews
    S('I3', 'Intake', 'C', '2026-09-03', ['GH']), S('P4', 'ESSPPR', 'C', '2026-09-20', ['EF']),              // C: still open
    S('P5', 'ESSPPR', 'D', '2025-11-01', ['CD']),                                                             // D: no call, 2025, later
    S('P6', 'ESSPPR', 'E', '2026-10-05', ['CD']),                                                             // E: approved before (older history)
    S('I4', 'Intake', 'F', '2026-10-01', ['GH']), S('P7', 'ESSPPR', 'F', '2026-10-15', ['AB'])];            // F: exact event says approved
  const records = [{ recordId: 'A', approved: '2026-09-10' }, { recordId: 'B', approved: '2026-10-01' }, { recordId: 'C', approved: '' },
    { recordId: 'D', approved: '2025-12-15' }, { recordId: 'E', approved: '2026-01-01' }, { recordId: 'F', approved: '2026-10-20' }];
  const events = Events.parse([Events.row({ event: 'review_outcome', recordId: 'F', outcome: 'approved', date: '2026-10-15', session: 'P7' }, new Date()),
    Events.row({ event: 'intake_outcome', recordId: 'F', outcome: 'ready', date: '2026-10-01', session: 'I4' }, new Date())]);

  it('counts each Scout once by the first Proposal Review; recorded outcomes win over dates', () => {
    const y = RS.compute({ sessions, records, events }, '2026');
    expect(y).toMatchObject({ scouts: 4, atFirst: 2, later: 1, open: 1, skipped: 1, exact: 1, inferred: 3 });
    expect(y.laterDays).toMatchObject({ n: 1, median: 19, min: 19, max: 19 });
    expect(y.reviewsPerApproval).toEqual({ one: 2, two: 1, more: 0 });
    const all = RS.compute({ sessions, records, events }, '');
    expect(all).toMatchObject({ since: '2025-11-01', scouts: 5, later: 2 });
    expect(all.laterDays).toMatchObject({ n: 2, min: 19, max: 44, avg: 31.5 });
  });
  it('credits the members of the last Pre-Review Call before the review', () => {
    const all = RS.compute({ sessions, records, events }, '');
    const by = Object.fromEntries(all.byIntake.map(x => [x.who, x]));
    expect(by.AB).toEqual({ who: 'AB', scouts: 2, decided: 2, atFirst: 1 });
    expect(by.GH).toEqual({ who: 'GH', scouts: 2, decided: 1, atFirst: 1 });
    expect(by['(no Pre-Review Call)']).toEqual({ who: '(no Pre-Review Call)', scouts: 1, decided: 1, atFirst: 0 });
    expect(all.byIntake[all.byIntake.length - 1].who).toBe('(no Pre-Review Call)');
    expect(all.intakeToReview).toMatchObject({ n: 4, min: 9, max: 17 });
    expect(all.intakeOutcomes).toEqual([{ who: 'GH', ready: 1, changes: 0, notApproved: 0 }]);
  });
  it('empty input is harmless', () => {
    expect(RS.compute({}, '2026')).toMatchObject({ scouts: 0, since: '', byIntake: [], laterDays: { n: 0, median: null } });
  });
});

describe('Perf (Timings tab)', () => {
  it('encodes samples defensively and keeps the cache value bounded', () => {
    expect(Perf.encodeServer('stats', 812.4)).toBe('S|stats|812');
    expect(Perf.encodeServer('', 5)).toBe('');
    expect(Perf.encodeReport({ a: 'home<x>', r: 2410, s: 800 })).toBe('R|homex|2410|800');
    expect(Perf.encodeReport('junk')).toBe('');
    expect(Perf.append('', ['S|a|1', ''])).toBe('S|a|1');
    const big = Perf.append('S|a|1;'.repeat(20000), ['S|b|2']);
    expect(big.length).toBeLessThanOrEqual(90000);
    expect(big.endsWith('S|b|2')).toBe(true);
  });
  it('summarizes per action: server ms, round trip, and start-up + network', () => {
    const text = ['S|home|100', 'S|home|300', 'S|home|200', 'R|home|1300|300', 'R|home|1100|100', 'S|stats|900', 'R|stats|2000|'].join(';');
    const rows = Perf.summarize(text, '2026-11-17 09:00');
    expect(rows.map(r => r.Action)).toEqual(['home', 'stats']);
    expect(rows[0]).toMatchObject({ 'Calls': 3, 'Server p50 ms': 200, 'Server p90 ms': 300, 'Server max ms': 300, 'Round trips': 2,
      'Round trip p50 ms': 1100, 'Start-up + network p50 ms': 1000 });
    expect(rows[1]).toMatchObject({ 'Calls': 1, 'Round trips': 1, 'Start-up + network p50 ms': '' });
    expect(Object.keys(rows[0])).toEqual(Perf.HEADERS);
    expect(Perf.summarize('', 'x')).toEqual([]);
  });
});

describe('ReviewStats.timeToApproval (2026-11-17)', () => {
  it('days from the review to approval, with vs without a Pre-Review Call first, by month', () => {
    const recs = [
      { recordId: 'A', reviewDate: '2025-03-01', approved: '2025-03-01', intakeDate: '' },             // without, 0 days
      { recordId: 'B', reviewDate: '2025-04-01', approved: '2025-05-01', intakeDate: '' },             // without, 30
      { recordId: 'C', reviewDate: '2026-10-10', approved: '2026-10-12', intakeDate: '2026-10-01' },   // with, 2
      { recordId: 'D', reviewDate: '2026-10-20', approved: '', intakeDate: '2026-10-05' },             // with, open
      { recordId: 'E', reviewDate: '2026-10-25', approved: '2026-11-04', intakeDate: '2026-10-30' },   // call AFTER the review: without, 10
      { recordId: 'F', reviewDate: '2026-11-10', approved: '2026-11-10', intakeDate: '' },             // schedule shows a call: with, 0
      { recordId: 'G', reviewDate: '2026-11-12', approved: '2026-11-15', intakeDate: '' },             // tracking date overwritten by a 2nd review
      { recordId: 'H', reviewDate: '', approved: '2026-01-01', intakeDate: '' }];                      // no review date: left out
    const sessions = [{ key: 'I', type: 'Intake', recordId: 'F', ymd: '2026-11-01', who: ['AB'] },
      { key: 'P', type: 'ESSPPR', recordId: 'G', ymd: '2026-11-01', who: ['CD'] }];                  // G's first review: 14 days
    const t = RS.timeToApproval(recs, sessions);
    expect(t.with).toMatchObject({ n: 2, min: 0, max: 2, avg: 1 });
    expect(t.without).toMatchObject({ n: 4, min: 0, max: 30, avg: 13.5, median: 12 });
    expect(t.open).toEqual({ with: 1, without: 0 });
    expect(t.byMonth.map(y => [y.month, y.with.n, y.without.n])).toEqual([['2025-03', 0, 1], ['2025-04', 0, 1], ['2026-10', 1, 1], ['2026-11', 1, 1]]);
    expect(RS.timeToApproval([], [])).toMatchObject({ with: { n: 0 }, without: { n: 0 }, byMonth: [] });
  });
});
