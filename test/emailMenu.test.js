import { describe, it, expect } from 'vitest';
import M from '../apps-script/src/lib/emailMenu.js';
import C from '../apps-script/src/lib/templateCatalog.js';

describe('EmailMenu', () => {
  const idOf = (k) => (C.get(k) || {}).id || '';
  it('every entry is a catalog email', () => { M.ENTRIES.forEach(e => expect(C.get(e.key), e.key).toBeTruthy()); });
  it('EBoR Booked: reminders need an EBoR slot; under review has no board-missing email', () => {
    const c = M.choices('ebor_booked', { slots: { EBoR: true }, hasBooked: true, underReview: true, idOf });
    expect(c.map(x => x.label)).toContain('4.3.c EBoR reminder');
    expect(c.filter(x => /EBoR reminder/.test(x.key)).length).toBe(1);   // one email for the Scout and the board (2026-11-02)
    expect(c.find(x => x.key === 'Unit Board Members missing').ready).toBe(false);
    const none = M.choices('ebor_booked', { slots: { EBoR: false }, idOf });
    expect(none.find(x => x.key === 'EBoR reminder')).toMatchObject({ ready: false, why: /No upcoming EBoR/ });
  });
  it('stages: status email everywhere active, none for Eagles', () => {
    expect(M.choices('intake_to_book', {}).map(x => x.key)).toEqual(['Status + page link', 'Book: Pre-Review Call', 'Please book']);
    expect(M.choices('eagle_earned', {})).toEqual([]);
  });
  it('recent: waiting in the Outbox, or sent in the last 14 days', () => {
    const now = new Date(2026, 9, 25).getTime();
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder', status: 'Pending', at: now }], now)).toBe('already waiting in the Outbox');
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder', status: 'Sent', at: new Date(2026, 9, 24).getTime() }], now)).toBe('sent 10/24');
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder', status: 'Discarded', at: now }], now)).toBe('');
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder', status: 'Sent', at: now - 20 * 864e5 }], now)).toBe('');
  });
  it('recent: a draft of a retired reminder (4.3.a/b) still counts for the merged 4.3.c', () => {
    const now = new Date(2026, 10, 2).getTime();
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder: board', status: 'Pending', at: now }], now)).toBe('already waiting in the Outbox');
    expect(M.recent('EBoR reminder', [{ template: 'EBoR reminder: Scout', status: 'Sent', at: now }], now)).toBe('sent 11/2');
  });
  it('note emails are prefilled with the last request; booked confirmations need that type', () => {
    const c = M.choices('proposal_revisions', { request: 'Add the materials list.' });
    expect(c.find(x => x.key === 'Revisions requested')).toMatchObject({ note: true, noteDefault: 'Add the materials list.', ready: true });
    const b = M.choices('review_booked', { slots: { ESSPPR: false } });
    expect(b.find(x => x.key === 'Booked: Proposal Review')).toMatchObject({ ready: false, why: /No upcoming Proposal Review/ });
  });
});
