import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../apps-script/src/lib/signatures.js');

// Fictional people and Scouts only.
const DAY = 86400000, NOW = Date.UTC(2026, 10, 12, 18, 0);
const row = (o) => Object.assign({ _row: 2, 'Row ID': 'SG-1', 'Request ID': 'SR-A', 'Record ID': 'R1', Scout: 'Teddy Sample', Email: '',
  Name: 'Pat Q', Slots: 'application:chair', Rep: false, Status: 'Signed', 'Asked by': 'PQ', Asked: new Date(NOW - DAY), Signed: '', Expires: '', Filed: '', Note: '' }, o);

describe('Signatures (remote EBoR signing ledger; one document since 2026-11-17)', () => {
  it('knows every slot and labels it; boxes of the dropped Advancement Report are ignored', () => {
    expect(S.DOCS).toEqual(['application']);
    expect(S.slotKeys()).toEqual(['application:chair', 'application:rep']);
    expect(S.slotLabel('application:rep')).toMatch(/Requirement 7.*representative/);
    expect(S.slotLabel('report:Signature1')).toBe('');
    expect(S.parseSlots('report:Signature2; application:chair, bogus, application:chair')).toEqual(['application:chair']);
  });

  it('room signers: signed ones only, one person on several boxes', () => {
    const r = S.roomSigners({
      application: [{ key: 'chair', name: 'Chris  Sample', rep: false, signed: true }, { key: 'rep', name: 'chris sample', rep: true, signed: true }],
      report: [{ key: 'Signature1', name: 'Lee Member', rep: true, signed: true }]
    });
    expect(r).toEqual([{ slots: ['application:chair', 'application:rep'], name: 'Chris Sample', rep: true }]);
  });

  const rows = S.list([
    row({}),
    row({ 'Row ID': 'SG-2', Email: 'Sam@Example.org', Name: 'Sam Signer', Slots: 'application:rep', Rep: true, Status: 'Pending', Expires: new Date(NOW + 10 * DAY) }),
    row({ 'Row ID': 'SG-3', Email: 'old@example.org', Name: 'Old Address', Slots: 'report:Signature2', Status: 'Pending', Expires: new Date(NOW - 1) }),
    row({ 'Row ID': 'SG-4', 'Request ID': 'SR-0', Asked: new Date(NOW - 30 * DAY), Email: 'sam@example.org', Status: 'Pending', Expires: new Date(NOW + DAY), Filed: new Date(NOW - 20 * DAY) })
  ]);

  it('open rows: pending, unexpired, not filed, by email', () => {
    expect(S.openFor(rows, 'SAM@example.org', NOW).map(r => r.id)).toEqual(['SG-2']);
    expect(S.openFor(rows, 'old@example.org', NOW)).toEqual([]);
    expect(S.openFor(rows, '', NOW)).toEqual([]);
  });

  it('the current series and where it stands', () => {
    const ser = S.series(rows, 'R1');
    expect(ser.map(r => r.id)).toEqual(['SG-1', 'SG-2', 'SG-3']);
    const st = S.state(ser, NOW);
    expect(Object.keys(st.signed)).toEqual(['application:chair']);
    expect(st.pending.map(r => r.id)).toEqual(['SG-2']);
    expect(st.expired.map(r => r.id)).toEqual(['SG-3']);
    expect(st.missing).toEqual(['application:rep']);
    expect(st.complete).toBe(false);
    expect(st.repOk).toEqual({ application: false });
    expect(S.summary(st)).toMatch(/^Pat Q signed .*; waiting on Sam Signer \(sam@example.org\) for .*; expired: Old Address/);
    expect(S.series(rows, 'R9')).toEqual([]);
  });

  it('complete when both application boxes are signed; an old Advancement Report box does not hold it up', () => {
    const all = S.list([
      row({ Slots: 'application:chair, report:Signature2' }),
      row({ 'Row ID': 'SG-2', Name: 'Sam Signer', Slots: 'application:rep', Rep: true })]);
    const st = S.state(S.series(all, 'R1'), NOW);
    expect(st.complete).toBe(true);
    expect(st.repOk).toEqual({ application: true });
  });

  it('checks a request: names, emails, boxes free', () => {
    const fresh = S.state(S.series(S.list([row({})]), 'R1'), NOW);
    const ok = S.checkRequest([{ name: 'Lee Member', email: 'Lee@Example.org', slots: ['application:rep'] }], fresh);
    expect(ok.errors).toEqual([]);
    expect(ok.clean).toEqual([{ name: 'Lee Member', email: 'lee@example.org', slots: ['application:rep'], rep: false }]);
    const st = S.state(S.series(rows, 'R1'), NOW);
    const bad = S.checkRequest([
      { name: 'X', email: 'nope', slots: [] },
      { name: 'Two', email: 'two@example.org', slots: ['application:chair', 'application:rep'] },
      { name: 'Twice', email: 'two@example.org', slots: ['report:Signature3'] }], st);
    expect(bad.errors).toEqual([
      'Signer 1: type the name.', 'Signer 1: not an email address.', 'Signer 1: pick at least one signature box.',
      'Signer 2: Eagle Application (Requirement 7): Board of review chair is already signed by Pat Q.',
      'Signer 2: Eagle Application (Requirement 7): Council / district board representative is already asked of Sam Signer.',
      'Signer 3: two@example.org is listed twice (give one signer several boxes instead).',
      'Signer 3: pick at least one signature box.']);
    expect(S.checkRequest([], { requestId: '' }).errors[0]).toMatch(/Save partial first/);
  });

  it('new rows', () => {
    let n = 0;
    const out = S.newRows([{ name: 'Lee Member', email: 'lee@example.org', slots: ['application:rep'], rep: true }],
      { id: () => 'SG-' + (++n), requestId: 'SR-A', recordId: 'R1', scout: 'Teddy Sample', askedBy: 'PQ', now: NOW, days: 14 });
    expect(out[0]).toMatchObject({ 'Row ID': 'SG-1', Email: 'lee@example.org', Slots: 'application:rep', Status: 'Pending', Signed: '' });
    expect(out[0].Expires.getTime()).toBe(NOW + 14 * DAY);
    const room = S.newRows([{ name: 'Pat Q', slots: ['application:chair'], rep: true }], { id: () => 'SG-9', requestId: 'SR-B', recordId: 'R1', scout: 'T', askedBy: 'PQ', now: NOW, status: 'Signed' });
    expect(room[0]).toMatchObject({ Email: '', Status: 'Signed', Expires: '' });
    expect(room[0].Signed.getTime()).toBe(NOW);
  });

  it('a save on a changed copy is refused', () => {
    const base = { application: { id: 'a1', modified: 5 } };
    expect(S.baseChanged(base, { application: { id: 'a1', modified: 5 } })).toBe('');
    expect(S.baseChanged(base, { application: { id: 'a1', modified: 6 } })).toMatch(/Eagle Application/);
  });

  it('partial names, slots per document, digest waiting list', () => {
    expect(S.partialNames({ application: 'Teddy_Sample-T999_EagleApplication-Signed.pdf' })).toEqual({ application: 'Teddy_Sample-T999_EagleApplication-Partial.pdf' });
    expect(S.slotsOf('application', ['application:rep', 'report:Signature1'])).toEqual(['rep']);
    expect(S.waiting(rows, NOW, 0.5)).toEqual([{ recordId: 'R1', scout: 'Teddy Sample', names: ['Sam Signer'] }]);
    expect(S.waiting(rows, NOW, 3)).toEqual([]);
    expect(S.layoutText).toBeUndefined();
  });
});
