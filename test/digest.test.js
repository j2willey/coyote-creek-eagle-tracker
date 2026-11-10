import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Digest = require('../apps-script/src/lib/digest.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');

describe('digest schedule (Settings → digestHours)', () => {
  it('reads the ways people write it', () => {
    expect(Digest.parseHours('6 PM')).toEqual({ hours: [18] });
    expect(Digest.parseHours('6 AM, 6 PM')).toEqual({ hours: [6, 18] });
    expect(Digest.parseHours('6pm; 6am')).toEqual({ hours: [6, 18] });
    expect(Digest.parseHours('18')).toEqual({ hours: [18] });
    expect(Digest.parseHours(18)).toEqual({ hours: [18] });
    expect(Digest.parseHours('6, 18')).toEqual({ hours: [6, 18] });
    expect(Digest.parseHours('18:00')).toEqual({ hours: [18] });
    expect(Digest.parseHours('12 AM, 12 PM')).toEqual({ hours: [0, 12] });
  });

  it('blank or off = no digest', () => {
    expect(Digest.parseHours('')).toEqual({ hours: [] });
    expect(Digest.parseHours('Off')).toEqual({ hours: [] });
    expect(Digest.scheduleLabel([])).toBe('off');
    expect(Digest.scheduleLabel([6, 18])).toBe('daily at 6 AM and 6 PM');
  });

  it('explains a value the sheet mangled ("6,18" read as 618)', () => {
    expect(Digest.parseHours(618).error).toMatch(/6 AM, 6 PM/);
    expect(Digest.parseHours('noonish').error).toMatch(/cannot read/);
    expect(Digest.parseHours('13 PM').error).toBeTruthy();
  });

  it('a time typed into the Settings cell (a Date) still works', () => {
    const s = SettingsModel.parse([['Key', 'Value'], ['digestHours', new Date(1899, 11, 30, 18, 0)]]);
    expect(s.digestHours).toBe('18:00');
    expect(Digest.parseHours(s.digestHours)).toEqual({ hours: [18] });
    expect(SettingsModel.parse([]).digestHours).toBe('6 PM');
  });
});

describe('dueSlot: hourly trigger decides whether to send', () => {
  const H = [6, 18];
  it('before the first slot of the day: yesterday evening is the latest slot', () => {
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 5 }, H, '2026-10-17 18')).toBeNull();
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 5 }, H, '2026-10-17 06')).toBe('2026-10-17 18');
  });
  it('at or after a slot, once', () => {
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 6 }, H, '2026-10-17 18')).toBe('2026-10-18 06');
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 7 }, H, '2026-10-18 06')).toBeNull();
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 19 }, H, '2026-10-18 06')).toBe('2026-10-18 18');
  });
  it('a missed slot is caught up on the next run', () => {
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 9 }, [18], '2026-10-16 18')).toBe('2026-10-17 18');
  });
  it('first run ever, off, and month/year boundaries', () => {
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 10 }, [18], '')).toBe('2026-10-17 18');
    expect(Digest.dueSlot({ date: '2026-10-18', hour: 10 }, [], '')).toBeNull();
    expect(Digest.prevDate('2026-11-01')).toBe('2026-10-31');
    expect(Digest.prevDate('2027-01-01')).toBe('2026-12-31');
  });
});

describe('digest recipients', () => {
  it('digestTo, else the Committee Group', () => {
    expect(Digest.recipients({ digestTo: 'a@x.org', committeeGroupEmail: 'g@x.org' })).toBe('a@x.org');
    expect(Digest.recipients({ committeeGroupEmail: 'g@x.org', testMode: false })).toBe('g@x.org');
  });
  it('test mode falls back to testRecipient; live mode never does', () => {
    expect(Digest.recipients({ testMode: true, testRecipient: 't@x.org' })).toBe('t@x.org');
    expect(Digest.recipients({ testMode: false, testRecipient: 't@x.org' })).toBe('');
  });
});

describe('digest email', () => {
  const t = (h, m) => new Date(2026, 9, 17, h, m);
  const rows = [
    { When: t(9, 0), Scout: 'Scout One', Unit: 'T910', 'Record ID': 'R1', Entry: '10/17 [tool] Pre-Review Call booked for Tue 10/20 7:00 PM' },
    { When: t(10, 0), Scout: 'Scout Two', Unit: 'C910', 'Record ID': 'R2', Entry: '10/17 Waiting on beneficiary letter', By: 'member@x.org' },
    { When: t(11, 0), Scout: 'Scout One', Unit: 'T910', 'Record ID': 'R1', Entry: '10/17 [sheet] Moved from A to B (by member@x.org)', By: 'member@x.org' },
    { When: t(12, 0), Scout: 'Scout Three', Unit: 'T92', 'Record ID': 'R3', Entry: '10/17 [Log started]' },
    { When: t(20, 0), Scout: 'Scout Four', Unit: 'T92', 'Record ID': 'R4', Entry: 'later' },
    { When: t(8, 0), Scout: 'Scout Five', Unit: 'T92', 'Record ID': 'R5', Entry: 'earlier' }
  ];
  const since = t(8, 0).getTime(), until = t(18, 0).getTime();

  it('takes only the window, skips bookkeeping lines', () => {
    const ev = Digest.select(rows, since, until);
    expect(ev.map(e => e['Record ID'])).toEqual(['R1', 'R2', 'R1']);   // 8:00 itself was in the previous digest
  });

  it('groups by Scout, one line each, time instead of the date prefix', () => {
    const m = Digest.build(Digest.select(rows, since, until), d => d.getHours() + ':00',
      { sinceLabel: 'Fri 10/16 6:00 PM', sheetUrl: 'https://sheet', scheduleLabel: 'daily at 6 PM' });
    expect(m.subject).toBe('Eagle Tracker digest: 3 changes (2 Scouts)');
    expect(m.body).toContain('Here is everything that has happened since the last digest (Fri 10/16 6:00 PM):');
    expect(m.body).toContain('Scout One (T910)\n  9:00  [tool] Pre-Review Call booked');
    expect(m.body).toContain('  11:00  [sheet] Moved from A to B (by member@x.org)\n');   // "by" not repeated
    expect(m.body).toContain('  10:00  Waiting on beneficiary letter (by member@x.org)');
    expect(m.body).toContain('https://sheet');
    expect(m.body).not.toMatch(/Log started/);
  });
});

describe('Digest HTML', () => {
  it('has an HTML version: one bold heading per Scout, one list item per change, escaped', () => {
    const m = Digest.build([
      { When: new Date(2026, 9, 21, 19, 10), Scout: 'Pat <Test>', Unit: 'T1', 'Record ID': 'R-1', Entry: '10/21 [sheet] Moved from A to B', By: 'JW' }
    ], d => 'Wed 7:10 PM', { sinceLabel: 'Wed 10/21 6:44 PM', sheetUrl: 'https://x.org/s' });
    expect(m.html).toContain('<b>Pat &lt;Test&gt; (T1)</b>');
    expect(m.html).toContain('<li style="margin:0 0 3px"><span style="color:#6b6b66;white-space:nowrap">Wed 7:10 PM</span>&nbsp; [sheet] Moved from A to B (by JW)</li>');
    expect(m.html).toContain('<a href="https://x.org/s">Tracking sheet</a>');
  });
  it('awaiting list at the top, next 7 days, and a digest with no changes', () => {
    const m = Digest.build([], d => '', { awaiting: [{ title: 'Emails waiting in the Outbox', items: ['A (T1), 2 days'] }],
      upcoming: [{ when: 'Tue 10/27 7:00 PM', what: 'Proposal Review: B (T2), JW' }], sinceLabel: 'Fri', scheduleLabel: 'daily at 6 PM' });
    expect(m.subject).toBe('Eagle Tracker digest: no changes, 1 awaiting action');
    expect(m.body.indexOf('AWAITING ACTION')).toBe(0);
    expect(m.body).toContain('Emails waiting in the Outbox (1):\n  - A (T1), 2 days');
    expect(m.body).toContain('Next 7 days (1):\n  Tue 10/27 7:00 PM  Proposal Review: B (T2), JW');
    expect(m.body).toContain('Nothing changed since the last digest (Fri).');
    expect(m.html).toContain('AWAITING ACTION');
  });
});
