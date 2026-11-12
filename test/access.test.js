import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../apps-script/src/lib/access.js');

// Fictional people only.
const committee = [
  { name: 'Pat Q Example', initials: 'PQ', email: 'pat@example.org', role: 'Admin' },
  { name: 'Chris Sample', initials: 'CS', email: 'chris@example.org', role: '' },
  { name: 'Sam Support', initials: 'SS', email: 'Sam@Example.org', role: 'Support' }
];

describe('Access (one identity check; Support role)', () => {
  it('normalizes roles', () => {
    expect(A.role(' admin ')).toBe('Admin');
    expect(A.role('SUPPORT')).toBe('Support');
    expect(A.role('Boss')).toBe('');
    expect(A.role(null)).toBe('');
  });
  it('the working committee leaves Support out', () => {
    expect(A.working(committee).map(m => m.initials)).toEqual(['PQ', 'CS']);
    expect(A.working(null)).toEqual([]);
  });
  it('finds any role by email, case-insensitive', () => {
    expect(A.memberFor(committee, 'sam@example.ORG').initials).toBe('SS');
    expect(A.memberFor(committee, '')).toBe(null);
    expect(A.memberFor(committee, 'nobody@example.org')).toBe(null);
  });
  it('Admin = Role Admin, Role Support, or Settings adminEmail', () => {
    expect(A.isAdmin(committee[0], 'pat@example.org', {})).toBe(true);
    expect(A.isAdmin(committee[2], 'sam@example.org', {})).toBe(true);
    expect(A.isAdmin(committee[1], 'chris@example.org', {})).toBe(false);
    expect(A.isAdmin(committee[1], 'Chris@example.org', { adminEmail: 'chris@example.org' })).toBe(true);
    expect(A.isAdmin(null, '', { adminEmail: '' })).toBe(false);
  });
  it('whoIs: member, admin, support and on file', () => {
    const w = A.whoIs({ email: ' SAM@example.org ', committee, settings: {} });
    expect(w.email).toBe('sam@example.org');
    expect(w.member.initials).toBe('SS');
    expect([w.admin, w.support, w.onFile]).toEqual([true, true, true]);
    const c = A.whoIs({ email: 'chris@example.org', committee, settings: {} });
    expect([c.admin, c.support, c.onFile]).toEqual([false, false, true]);
  });
  it('whoIs: on file through a record, a unit or a pending signature; otherwise not', () => {
    expect(A.whoIs({ email: 'scout@example.org', records: ['R1'], committee }).onFile).toBe(true);
    expect(A.whoIs({ email: 'leader@example.org', units: [{ unit: 'T999' }], committee }).onFile).toBe(true);
    expect(A.whoIs({ email: 'signer@example.org', signatures: [{ requestId: 'SR-1' }], committee }).onFile).toBe(true);
    const nobody = A.whoIs({ email: 'nobody@example.org', committee, settings: { adminEmail: 'nobody@example.org' } });
    expect(nobody.onFile).toBe(false);   // adminEmail alone gets error reports, not a sign-in link (as before)
    expect(nobody.admin).toBe(true);
    expect(A.whoIs({ email: '', records: ['R1'] }).onFile).toBe(false);
  });
});
