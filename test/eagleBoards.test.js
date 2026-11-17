import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EB = require('../apps-script/src/lib/eagleBoards.js');

// Fictional Scouts and members only.
const B = (recordId, start, reps) => ({ key: 'S-' + recordId, recordId, start, reps });
const boards = [B('R-7', 1900, ['AB', 'cd']), B('R-5', 1700, ['AB']), B('R-9', 1800, ['EF'])];

describe('EagleBoards (the Eagle earned page, 2026-11-17)', () => {
  it("the member's own boards, soonest first, by initials in any case", () => {
    expect(EB.mine(boards, 'ab').map(b => b.recordId)).toEqual(['R-5', 'R-7']);
    expect(EB.mine(boards, 'CD').map(b => b.recordId)).toEqual(['R-7']);
    expect(EB.mine(boards, '')).toEqual([]);
  });
  it('warns, never redirects, when the picked Scout is not on one of the member\'s boards', () => {
    const mineAB = EB.mine(boards, 'AB');
    expect(EB.decide('R-7', mineAB)).toMatchObject({ mode: 'own', recordId: 'R-7' });
    expect(EB.decide('R-9', mineAB)).toMatchObject({ mode: 'warn', recordId: 'R-9', own: ['R-5', 'R-7'] });
    expect(EB.decide('R-9', [])).toMatchObject({ mode: 'other', recordId: 'R-9' });       // nothing to compare with
    expect(EB.decide('', EB.mine(boards, 'CD'))).toMatchObject({ mode: 'own', recordId: 'R-7' });
    expect(EB.decide('', mineAB)).toMatchObject({ mode: 'choose', recordId: '' });
    expect(EB.decide('', [])).toMatchObject({ mode: 'none' });
    expect(EB.onBoard(['AB', 'CD'], 'cd')).toBe(true);
    expect(EB.onBoard(['AB'], 'EF')).toBe(false);
  });
  it('undo: 10 minutes, the member who saved or an Admin, only while at Eagle Earned', () => {
    const t = { by: 'ab@example.org', at: 1000 };
    expect(EB.undoProblem(t, 1000 + 9 * 60000, 'AB@example.org', false, 'eagle_earned')).toBe('');
    expect(EB.undoProblem(t, 1000 + 11 * 60000, 'ab@example.org', false, 'eagle_earned')).toMatch(/10 minutes/);
    expect(EB.undoProblem(null, 1000, 'ab@example.org', false, 'eagle_earned')).toMatch(/10 minutes/);
    expect(EB.undoProblem(t, 1000, 'cd@example.org', false, 'eagle_earned')).toMatch(/Only the member who saved/);
    expect(EB.undoProblem(t, 1000, 'cd@example.org', true, 'eagle_earned')).toBe('');
    expect(EB.undoProblem(t, 1000, 'ab@example.org', false, 'ebor_booked')).toMatch(/no longer at Eagle Earned/);
  });
  it('undo puts Eagles to Date back only where it still shows the number given', () => {
    const nums = [{ code: 't999', n: 110, was: 109 }, { code: 'c917', n: 12, was: 11 }];
    expect(EB.unbump(nums, { t999: 110, c917: 13 })).toEqual([{ code: 't999', from: 110, to: 109 }]);
    expect(EB.unbump([], {})).toEqual([]);
  });
});
