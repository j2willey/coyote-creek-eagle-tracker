import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../apps-script/src/lib/people.js');

describe('People (Admin → committee members)', () => {
  const rows = [
    { _row: 2, Name: 'Pat Q Example', Initials: 'PQ', Email: 'pat@example.org', Active: true, Role: 'Admin' },
    { _row: 3, Name: 'Chris Sample', Initials: 'CS', Email: 'Chris@Example.org', Active: '', Role: '' },
    { _row: 4, Name: 'Helper', Initials: 'HE', Email: 'help@example.org', Active: false, Role: 'admin' },
    { _row: 5, Name: '', Initials: '', Email: '', Active: '' }
  ];
  const members = P.list(rows);
  it('lists members (blank = active; Role normalized)', () => {
    expect(members).toEqual([
      { row: 2, name: 'Pat Q Example', initials: 'PQ', email: 'pat@example.org', active: true, role: 'Admin' },
      { row: 3, name: 'Chris Sample', initials: 'CS', email: 'Chris@Example.org', active: true, role: '' },
      { row: 4, name: 'Helper', initials: 'HE', email: 'help@example.org', active: false, role: 'Admin' }]);
  });
  it('adds a member with unique initials and email', () => {
    const ok = P.validate({ name: 'Jordan Test', initials: 'jt', email: 'Jordan@Example.org', active: true, role: '' }, members, {});
    expect(ok).toEqual({ errors: [], fields: { Name: 'Jordan Test', Email: 'jordan@example.org', Active: true, Role: '', Initials: 'JT' } });
    const bad = P.validate({ name: 'X', initials: 'cs', email: 'chris@example.org', role: 'Boss' }, members, {});
    expect(bad.errors).toEqual(['Name: 2 to 100 characters.', 'Role: blank, Admin or Support.', 'Email: already on the list.', 'Initials: already used by someone else.']);
  });
  it('updates keep the initials and check the row did not change', () => {
    const r = P.validate({ name: 'Chris Sample', initials: 'ZZ', email: 'chris@example.org', active: false, role: 'Admin' }, members, { row: 3, wasEmail: 'chris@example.org', meEmail: 'pat@example.org' });
    expect(r.errors).toEqual([]);
    expect(r.fields).toEqual({ Name: 'Chris Sample', Email: 'chris@example.org', Active: false, Role: 'Admin' });
    expect(P.logLine(members[1], r.fields)).toBe('Committee: CS Email "Chris@Example.org" → "chris@example.org", Active "true" → "false", Role "" → "Admin"');
    expect(P.validate({ name: 'Chris', email: 'c@example.org' }, members, { row: 3, wasEmail: 'other@example.org' }).errors[0]).toMatch(/changed on the sheet/);
    expect(P.validate({ name: 'Chris', email: 'c@example.org' }, members, { row: 9, wasEmail: '' }).errors[0]).toMatch(/no longer/);
  });
  it('an Admin can\'t lock themselves out', () => {
    const r = P.validate({ name: 'Pat Q Example', email: 'pat2@example.org', active: false, role: '' }, members, { row: 2, wasEmail: 'pat@example.org', meEmail: 'Pat@example.org' });
    expect(r.errors).toHaveLength(3);
  });
  it('logs an add', () => {
    expect(P.logLine(null, { Name: 'Jordan Test', Initials: 'JT', Email: 'j@example.org', Active: true, Role: 'Admin' })).toBe('Committee: added Jordan Test (JT), Role Admin');
  });
  it('only Support gives the Support role or changes a Support row', () => {
    const withSupport = P.list([...rows.slice(0, 3), { _row: 6, Name: 'Sam Support', Initials: 'SS', Email: 'sam@example.org', Active: true, Role: 'support' }]);
    expect(withSupport[3].role).toBe('Support');
    const give = { name: 'Jordan Test', initials: 'JT', email: 'jordan@example.org', active: true, role: 'Support' };
    expect(P.validate(give, withSupport, { meEmail: 'pat@example.org', meRole: 'Admin' }).errors).toEqual(['Only Support can give the Support role or change a Support member.']);
    expect(P.validate(give, withSupport, { meEmail: 'sam@example.org', meRole: 'Support' }).errors).toEqual([]);
    const edit = { name: 'Sam Support', email: 'sam@example.org', active: true, role: '' };
    expect(P.validate(edit, withSupport, { row: 6, wasEmail: 'sam@example.org', meEmail: 'pat@example.org', meRole: 'Admin' }).errors[0]).toMatch(/Only Support/);
    // Support can't drop their own role here either (no locking yourself out)
    expect(P.validate(edit, withSupport, { row: 6, wasEmail: 'sam@example.org', meEmail: 'sam@example.org', meRole: 'Support' }).errors[0]).toMatch(/your own Admin role/);
    expect(P.logLine(null, { Name: 'Jordan Test', Initials: 'JT', Email: 'j@example.org', Active: true, Role: 'Support' })).toBe('Committee: added Jordan Test (JT), Role Support');
  });
});
