import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../apps-script/src/lib/reminders.js');
const O = require('../apps-script/src/lib/outbox.js');

const now = new Date(2026, 9, 24, 7).getTime(), H = 3600e3, D = 24 * H;
describe('EBoR reminders', () => {
  const slots = [
    { key: 'SL_1', recordId: 'R1', start: now + 2 * D + 12 * H, section: 'ebor_booked' },   // in 2.5 days: due
    { key: 'SL_2', recordId: 'R2', start: now + 5 * D, section: 'ebor_booked' },            // too early
    { key: 'SL_3', recordId: 'R3', start: now - H, section: 'ebor_booked' },                // past
    { key: 'SL_4', recordId: 'R4', start: now + D, section: 'ebor_paused' },                // not booked any more
    { key: 'SL_5', recordId: '', start: now + D, section: '' }                              // open slot
  ];
  it('drafts once per board, within the lead time', () => {
    const d = R.dueEbors(slots, now, 3, {});
    expect(d.map(x => x.key)).toEqual(['SL_1']);
    expect(R.dueEbors(slots, now, 3, { [d[0].reminderKey]: true })).toEqual([]);
    const moved = [{ ...slots[0], start: slots[0].start + D / 2 }];
    expect(R.dueEbors(moved, now, 3, { [d[0].reminderKey]: true }).length).toBe(1);   // new date: new reminders
  });
  it('board list', () => {
    expect(R.boardList(['Lee Fake', ''], [{ name: 'Pat Q', email: 'p@x.org' }, { email: 'z@x.org' }])).toBe('Lee Fake (district), Pat Q (unit), z@x.org (unit)');
  });
});

describe('Outbox scheduled send', () => {
  const ev = now + 3 * D + 12 * H;
  it('choices: 2 days / 1 day before the session, only if still ahead', () => {
    expect(O.scheduleChoices(ev, now).map(c => [c.label, c.at])).toEqual([['2 days before', ev - 2 * D], ['1 day before', ev - D]]);
    expect(O.scheduleChoices(now + D + H, now).map(c => c.label)).toEqual(['1 day before']);
    expect(O.scheduleChoices(0, now)).toEqual([]);
  });
  it('refuses the past and after the session', () => {
    expect(O.scheduleProblem(now - H, now, ev)).toMatch(/at least 5 minutes/);
    expect(O.scheduleProblem(ev + H, now, ev)).toMatch(/after the session/);
    expect(O.scheduleProblem(now + D, now, ev)).toBe('');
  });
  it('due rows', () => {
    const rows = [{ Id: 'a', Status: 'Scheduled', 'Send at': new Date(now - 60e3) }, { Id: 'b', Status: 'Scheduled', 'Send at': new Date(now + H) },
      { Id: 'c', Status: 'Pending', 'Send at': new Date(now - H) }];
    expect(O.due(rows, now).map(r => r.Id)).toEqual(['a']);
  });
});
