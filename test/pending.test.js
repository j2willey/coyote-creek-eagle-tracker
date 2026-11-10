import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Pending = require('../apps-script/src/lib/pending.js');
const Digest = require('../apps-script/src/lib/digest.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');

describe('Pending (new files waiting on the committee)', () => {
  const now = new Date(2026, 9, 23, 10).getTime();
  it('raise keeps the oldest time, else now', () => {
    const old = new Date(2026, 9, 20, 9);
    expect(Pending.raise(old, now).getTime()).toBe(old.getTime());
    expect(Pending.raise('', now).getTime()).toBe(now);
    expect(Pending.raise('garbage', now).getTime()).toBe(now);
  });
  it('reads cells', () => {
    expect(Pending.isPending('')).toBe(false);
    expect(Pending.isPending(null)).toBe(false);
    expect(Pending.isPending(new Date(now))).toBe(true);
    expect(Pending.ageDays(new Date(now - 2.2 * 86400e3), now)).toBe(2);
    expect(Pending.ageText(0)).toBe('today');
    expect(Pending.ageText(1)).toBe('1 day');
  });
  it('waiting list, oldest first', () => {
    const w = Pending.waiting([
      { scout_name: 'B', unit: 'T2', pending: new Date(now - 86400e3) },
      { scout_name: 'A', unit: 'T1', pending: new Date(now - 5 * 86400e3) },
      { scout_name: 'C', unit: 'T3', pending: '' }
    ], now);
    expect(w.map(x => [x.title, x.days])).toEqual([['A (T1)', 5], ['B (T2)', 1]]);
  });
  it('log line and the Checked action', () => {
    expect(Pending.clearedLine('10/23', 'JW', 'moved to Intake Review: To Book')).toBe('10/23 [JW] New files checked (moved to Intake Review: To Book)');
    expect(SettingsModel.isChecked(SettingsModel.CHECKED)).toBe(true);
    expect(SettingsModel.isChecked('Proposal Received')).toBe(false);
    expect(SettingsModel.sectionForAction(SettingsModel.parse([]), SettingsModel.CHECKED)).toBeNull();
  });
  it('digest lists Scouts waiting on the committee first', () => {
    const fmt = (d) => d.toISOString().slice(0, 10);
    const m = Digest.build([{ When: new Date(now), Scout: 'A', Unit: 'T1', 'Record ID': 'R1', Entry: '10/23 [Scout] Scout Update: ESSPP-V2', By: '' }], fmt,
      { waiting: [{ title: 'A (T1)', days: 2 }] });
    expect(m.body.split('\n')[0]).toBe('New files to check (1):');
    expect(m.body).toMatch(/A \(T1\), waiting 2 days/);
    expect(m.html).toMatch(/New files to check/);
    expect(Digest.build([{ When: new Date(now), Scout: 'A', Entry: 'x' }], fmt, {}).body).not.toMatch(/waiting/);
    const c = Digest.build([{ When: new Date(now), Scout: 'A', Entry: 'x' }], fmt, { council: [{ title: 'E_1 (T1)', days: 10 }] });
    expect(c.body).toMatch(/not yet acknowledged by Council \(1\):\n  - E_1 \(T1\), sent 10 days ago/);
  });
});
