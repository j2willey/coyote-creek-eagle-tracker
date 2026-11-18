import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MS = require('../apps-script/src/lib/mySessions.js');

// Fictional Scouts and members only.
const S = (recordId, type, ymd, start, reps, section) =>
  ({ key: 'K-' + recordId, recordId, type, ymd, start, reps, section, scout: 'Scout ' + recordId, unit: 'T999' });
const TODAY = '2026-03-10';
const sessions = [
  S('R-1', 'EBoR', TODAY, 1900, ['AB', 'cd'], 'ebor_booked'),
  S('R-2', 'ESSPPR', TODAY, 1700, ['ab'], 'review_booked'),
  S('R-3', 'EBoR', '2026-03-09', 1500, ['AB'], 'eagle_earned'),        // yesterday, outcome already recorded
  S('R-4', 'EBoR', TODAY, 1800, ['EF'], 'ebor_booked'),                // someone else's board
  S('R-5', 'Followup', TODAY, 1600, ['AB'], 'underway'),               // not a phone outcome
  S('R-6', 'ESSPPR', '2026-03-09', 1400, ['CD'], 'review_revisions')   // reviewed yesterday, revisions requested
];

describe('MySessions (phone outcomes, 2026-11-17)', () => {
  it("lists the member's EBoRs and Proposal Reviews, soonest first, by initials in any case", () => {
    const mine = MS.list(sessions, 'ab');
    expect(mine.map(s => s.recordId)).toEqual(['R-3', 'R-2', 'R-1']);
    expect(mine.map(s => s.done)).toEqual([true, false, false]);
    expect(mine[1]).toMatchObject({ label: 'Proposal Review', href: '/committee/review?r=R-2' });
    expect(mine[2]).toMatchObject({ short: 'EBoR', href: '/committee/eagle?r=R-1' });
    expect(MS.list(sessions, '')).toEqual([]);
    expect(MS.list(sessions, 'ZZ')).toEqual([]);
  });
  it('a phone opens the one session still waiting; none or several -> pick', () => {
    expect(MS.autoOpen(MS.list(sessions, 'AB'))).toBe('');                   // R-1 and R-2 both open
    expect(MS.autoOpen(MS.list(sessions, 'CD'))).toBe('/committee/eagle?r=R-1');   // R-6 is done
    expect(MS.autoOpen(MS.list(sessions, 'EF'))).toBe('/committee/eagle?r=R-4');
    expect(MS.autoOpen([])).toBe('');
  });
  it("tonight: today's open sessions only", () => {
    expect(MS.tonight(MS.list(sessions, 'AB'), TODAY).map(s => s.recordId)).toEqual(['R-2', 'R-1']);
    expect(MS.tonight(MS.list(sessions, 'CD'), TODAY).map(s => s.recordId)).toEqual(['R-1']);
    expect(MS.tonight(MS.list(sessions, 'CD'), '2026-03-09')).toEqual([]);
  });
  it('record IDs are URL-encoded in the link', () => {
    expect(MS.list([S('R 7&x', 'EBoR', TODAY, 1, ['AB'], 'ebor_booked')], 'AB')[0].href).toBe('/committee/eagle?r=R%207%26x');
  });
});
