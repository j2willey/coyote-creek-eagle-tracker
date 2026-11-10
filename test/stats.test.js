import { describe, it, expect } from 'vitest';
import S from '../apps-script/src/lib/stats.js';

describe('Stats', () => {
  const recs = [
    { recordId: 'A', section: 'eagle_earned', unit: 'T1', birth: '2008-06-01', ebor: '2026-01-10', approved: '2025-06-01', female: true },
    { recordId: 'B', section: 'eagle_earned', unit: 'T1', birth: '2009-02-01', ebor: '2026-03-05', approved: '2026-01-05', female: 'M' },
    { recordId: 'C', section: 'eagle_earned', unit: 'T2', birth: '', ebor: '2026-03-20', approved: '2026-02-01', female: '' },
    { recordId: 'D', section: 'eagle_earned', unit: 'T2', birth: '2007-01-01', ebor: '2025-12-01', approved: '2025-01-01' },
    { recordId: 'E', section: 'ebor_booked', birth: '2009-01-01', ebor: '2026-11-04', approved: '2026-05-01' },
    { recordId: 'F', section: 'ebor_booked', birth: '2009-01-01', ebor: '' },
    { recordId: 'G', section: 'proposal_approved', birth: '2009-01-01', approved: '2024-05-01' },
    { recordId: 'H', section: 'app_submitted', birth: '2009-03-01', submitted: '2026-09-01', verified: '' },
    { recordId: 'I', section: 'app_verified', birth: '2008-12-01', submitted: '2026-08-01', verified: '2026-08-21' }];
  const s = S.current(recs, '2026-10-24');
  it('this year: monthly, totals, female, ages, approvals', () => {
    expect(s.monthly.slice(0, 4)).toEqual([1, 0, 2, 0]);
    expect(s.annual).toMatchObject({ year: '2026', total: 3, female: 1, femalePct: 33.3, approved: 3, missingAge: 1, minAge: 17.0, maxAge: 17.6 });
  });
  it('future EBoRs, pipeline, open approvals, throughput, age watch, units', () => {
    expect(s.future).toEqual([{ month: 'November 2026', count: 1 }]);
    expect(s.futureUndated).toBe(1);
    expect(s.pipeline.find(p => p.key === 'booked').count).toBe(2);
    expect(s.openByYear).toEqual([{ year: '2024', count: 1 }]);
    expect(s.throughput.councilVerify).toEqual({ median: 20, n: 1 });
    expect(s.throughput.approvalToEagle.n).toBe(3);
    expect(s.ageWatch.count).toBe(5);
    expect(s.byUnit[0]).toEqual({ unit: 'T1', count: 2 });
  });
  it('female column values', () => {
    expect([true, 'Y', 'x', 'F', 'Female'].map(S.isFemale)).toEqual([true, true, true, true, true]);
    expect([false, '', 'M', 'male', 'No'].map(S.isFemale)).toEqual([false, false, false, false, false]);
  });
  it('workload: booked past sessions this year, by month and member', () => {
    const t = (m, d) => new Date(2026, m, d, 19).getTime();
    const w = S.workload([{ type: 'Intake', start: t(0, 5), who: ['jw'], booked: true }, { type: 'EBoR', start: t(0, 9), who: ['JW', 'AB'], booked: true },
      { type: 'EBoR', start: t(11, 9), who: ['AB'], booked: true }, { type: 'ESSPPR', start: t(1, 9), who: ['CD'], booked: false }], 2026, t(9, 24));
    expect(w.byMonth[0]).toEqual({ Intake: 1, ESSPPR: 0, EBoR: 1 });
    expect(w.byMember).toEqual([{ who: 'JW', Intake: 1, ESSPPR: 0, EBoR: 1, total: 2 }, { who: 'AB', Intake: 0, ESSPPR: 0, EBoR: 1, total: 1 }]);
  });
  it('history from the tab; seed rows add up', () => {
    const rows = S.HISTORY_SEED.map(r => Object.fromEntries(S.HISTORY_HEADERS.map((h, i) => [h, r[i]])));
    const h = S.history(rows);
    expect(h[0]).toMatchObject({ year: '2020', total: 36, female: null, avgAge: null });
    h.slice(1).forEach(y => expect(y.monthly.reduce((a, b) => a + b, 0)).toBe(y.total));
  });
});
