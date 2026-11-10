import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../apps-script/src/lib/eagleDone.js');
const Booking = require('../apps-script/src/lib/booking.js');
const Units = require('../apps-script/src/lib/units.js');
const C = require('../apps-script/src/lib/councilApp.js');
const Board = require('../apps-script/src/lib/board.js');
const Intake = require('../apps-script/src/lib/intake.js');
const S = require('../apps-script/src/lib/scoutFiles.js');

// Theodore Sample (legal) goes by Teddy (Jim W., 2026-11-04).
describe('Preferred Name', () => {
  it('greeting, display: the first entry of the list', () => {
    expect(E.firstName('Theodore Sample', 'Teddy; Teddy Sample')).toBe('Teddy');
    expect(E.firstName('Theodore Sample', 'Teddy Sample')).toBe('Teddy');
    expect(E.firstName('Theodore Sample', '')).toBe('Theodore');
    expect(E.firstName('Theodore Sample')).toBe('Theodore');
    expect(E.display('Theodore Sample', 'Teddy; T.')).toBe('Theodore Sample ("Teddy")');
    expect(E.display('Theodore Sample', '')).toBe('Theodore Sample');
    expect(E.display('Theodore Sample', 'theodore sample')).toBe('Theodore Sample');
    expect(E.preferredList(' Teddy ;; Teddy Sample ')).toEqual(['Teddy', 'Teddy Sample']);
  });
  it('dashboard shows both names', () => {
    const t = Board.build([{ recordId: 'R1', section: 'review_booked', scout_name: 'Theodore Sample', preferred_name: 'Teddy' }], [], '2026-11-04');
    expect(t.find(x => x.key === 'proposals').groups.find(g => g.key === 'review_booked').rows[0].name).toBe('Theodore Sample ("Teddy")');
  });
  const recs = [{ recordId: 'R1', scout_name: 'Theodore Sample', unit: 'T999', preferred_name: 'Teddy' },
    { recordId: 'R2', scout_name: 'Mai Sample', unit: 'T999' }];
  it('schedule sheet: a typed preferred name finds the Scout (last name added to a one-word entry)', () => {
    expect(Booking.matchScout(recs, 'Teddy Sample', 'T999', Units.code)).toEqual({ recordId: 'R1' });
    expect(Booking.matchScout(recs, 'Theodore Sample', '', Units.code)).toEqual({ recordId: 'R1' });
    expect(Booking.matchScout(recs, 'Teddy S', 'T999', Units.code)).toEqual({ recordId: 'R1' });       // short form
    expect(Booking.matchScout(recs, 'Mai Sample', '', Units.code)).toEqual({ recordId: 'R2' });
  });
  it('Formsite: a form filled with the preferred name is a close match', () => {
    const p = { first: 'Teddy', middle: '', last: 'Sample', certName: 'Teddy Sample', unit: 'T999' };
    expect(C.matchRecord(recs, p, Units.code)).toMatchObject({ recordId: 'R1', close: true });
    expect(C.matchRecord(recs, { ...p, first: 'Theodore' }, Units.code)).toMatchObject({ recordId: 'R1', close: true });
  });
  it('intake form and Scout page carry it (optional); the Scout may edit it', () => {
    const f = Intake.FIELDS.find(x => x.key === 'preferred_name');
    expect(f).toMatchObject({ header: 'Preferred Name', label: 'Preferred name' });
    expect(f.required).toBeFalsy();
    expect(S.EDITABLE).toContain('preferred_name');
  });
});

describe('Preferred Name in the digest', () => {
  const D = require('../apps-script/src/lib/digest.js');
  it('changes are grouped under the name the committee knows now', () => {
    const ev = [{ When: new Date(2026, 10, 4, 9), Scout: 'Theodore Sample', Unit: 'T999', 'Record ID': 'R1', Entry: '11/4 [JW] Edited: BSA ID' }];
    const m = D.build(ev, d => '11/4', { nameFor: (id, n) => id === 'R1' ? 'Theodore Sample ("Teddy")' : n });
    expect(m.body).toContain('Theodore Sample ("Teddy") (T999)');
    expect(D.build(ev, d => '11/4', {}).body).toContain('Theodore Sample (T999)');
  });
});
