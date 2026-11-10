import { describe, it, expect } from 'vitest';
import S from '../apps-script/src/lib/shadowInvites.js';

describe('ShadowInvites', () => {
  const now = new Date(2026, 9, 26, 15, 0).getTime();
  const row = (o) => Object.assign({ _key: 'K', _row: 2, slot_type: 'EBoR', date: '2026-10-27', time: '7:00 PM', record_id: 'R-1', event_id: 'shadow', reps: 'AB/LD', duration_min: 90 }, o);
  it('booked shadow sessions from tomorrow on; not today, not real invites, not open slots, not Blocked', () => {
    const c = S.candidates([row({ _key: 'A' }), row({ _key: 'today', date: '2026-10-26', time: '7:00 PM' }), row({ _key: 'real', event_id: 'abc123' }),
      row({ _key: 'open', record_id: '' }), row({ _key: 'blk', slot_type: 'Blocked' }), row({ _key: 'B', slot_type: 'ESSPPR', date: '2026-11-04', time: '5:30 PM', duration_min: '' })], now);
    expect(c.map(x => x.key)).toEqual(['A', 'B']);
    expect(c[0]).toMatchObject({ type: 'EBoR', minutes: 90, who: ['AB', 'LD'] });
    expect(c[1].minutes).toBe(60);
  });
});
