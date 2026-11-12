import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../apps-script/src/lib/settingsView.js');
const M = require('../apps-script/src/lib/settingsModel.js');

describe('SettingsView (Admin → Settings)', () => {
  it('every default setting is in exactly one group', () => {
    const keys = V.GROUPS.flatMap(g => g.keys.map(k => k[0]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(M.DEFAULT_VALUES).filter(k => !keys.includes(k))).toEqual([]);
    expect(keys.filter(k => !(k in M.DEFAULT_VALUES))).toEqual([]);
  });
  it('shows values, defaults and links; unknown keys go to Other', () => {
    const s = { ...M.DEFAULT_VALUES, maxUploadMB: 25, scheduleSheetId: 'abc', mystery: 'x', sections: [{ key: 'k', label: 'L', scoutStatus: 'S', order: 1, aliases: [] }], _empty: false };
    const v = V.view(s, M.DEFAULT_VALUES);
    const all = v.groups.flatMap(g => g.items);
    expect(all.find(i => i.key === 'maxUploadMB')).toMatchObject({ value: '25', def: '20', isDefault: false });
    expect(all.find(i => i.key === 'testMode')).toMatchObject({ value: 'TRUE', isDefault: true });
    expect(all.find(i => i.key === 'scheduleSheetId').link).toBe('https://docs.google.com/spreadsheets/d/abc');
    expect(v.groups.at(-1)).toMatchObject({ id: 'other', items: [{ key: 'mystery', value: 'x' }] });
    expect(v.sections).toEqual([{ key: 'k', label: 'L', scoutStatus: 'S', order: 1 }]);
  });
  it('Admin role: Role column or the adminEmail', () => {
    expect(V.isAdmin({ role: 'Admin' }, 'a@example.org', {})).toBe(true);
    expect(V.isAdmin({ role: '' }, 'A@Example.org', { adminEmail: 'a@example.org' })).toBe(true);
    expect(V.isAdmin({ role: '' }, 'b@example.org', { adminEmail: 'a@example.org' })).toBe(false);
    expect(V.isAdmin(null, '', { adminEmail: '' })).toBe(false);
  });

  describe('editing (District details, Scheduling)', () => {
    const cur = { ...M.DEFAULT_VALUES, eborMinutes: 90, defaultStartTime: '7:00 PM', onlineBooking: 'Pre-Review Call' };
    it('normalizes and reports only real changes', () => {
      const r = V.validate('scheduling', { eborMinutes: '75', defaultStartTime: '19:30', reservedForUnits: 'off', onlineBooking: 'all' },
        { eborMinutes: '90' }, cur, M.DEFAULT_VALUES);
      expect(r.errors).toEqual([]);
      expect(r.changes).toEqual([
        { key: 'eborMinutes', from: '90', to: 75 }, { key: 'defaultStartTime', from: '7:00 PM', to: '7:30 PM' },
        { key: 'onlineBooking', from: 'Pre-Review Call', to: 'all' }]);
    });
    it('refuses bad values, other groups, and someone else\'s change in between', () => {
      const bad = V.validate('scheduling', { eborMinutes: 'x', defaultStartTime: 'soon', reservedForUnits: 'Maybe', onlineBooking: 'Lunch' }, {}, cur, M.DEFAULT_VALUES);
      expect(bad.errors.map(e => e.key)).toEqual(['eborMinutes', 'defaultStartTime', 'reservedForUnits', 'onlineBooking']);
      expect(bad.changes).toEqual([]);
      expect(V.validate('district', { councilEaglesEmail: 'not-an-email' }, {}, cur, M.DEFAULT_VALUES).errors).toHaveLength(1);
      expect(V.validate('district', { eborMinutes: '60' }, {}, cur, M.DEFAULT_VALUES).errors[0].message).toMatch(/not in District details/);
      expect(V.validate('test', { testMode: false }, {}, cur, M.DEFAULT_VALUES).errors[0].message).toMatch(/can't be edited/);
      expect(V.validate('scheduling', { eborMinutes: '60' }, { eborMinutes: '120' }, cur, M.DEFAULT_VALUES).errors[0].message).toMatch(/someone else/);
    });
  });
});
