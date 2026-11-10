import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SC = require('../apps-script/src/lib/scheduleCheck.js');

const start = new Date(2026, 9, 26, 19, 0).getTime();
describe('ScheduleCheck.compare', () => {
  it('empty, same day (no time), same day+time', () => {
    expect(SC.compare('', start).state).toBe('empty');
    expect(SC.compare(new Date(2026, 9, 26), start).state).toBe('same');
    expect(SC.compare(new Date(2026, 9, 26, 19, 0), start).state).toBe('same');
    expect(SC.compare('10/26/2026', start).state).toBe('same');
    expect(SC.compare('10/26', start).state).toBe('same');
    expect(SC.compare('10/26/26 7:00 PM', start).state).toBe('same');
  });
  it('different day or time, and unreadable text', () => {
    expect(SC.compare(new Date(2026, 9, 27), start)).toEqual({ state: 'differs', tracking: '10/27/2026' });
    expect(SC.compare(new Date(2026, 9, 26, 17, 30), start)).toEqual({ state: 'differs', tracking: '10/26/2026 5:30 PM' });
    expect(SC.compare('next week', start)).toEqual({ state: 'unreadable', tracking: 'next week' });
  });
});
