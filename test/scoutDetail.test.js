import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../apps-script/src/lib/scoutDetail.js');

const group = ['', 'Scout', '', '', 'Scout Info', '', '', 'Eagle Project Proposal', '', 'Proposal Review', '', 'Eagle Project', 'Council', 'Eagle Earned', '', ''];
const mach = ['_key', 'scout_name', 'unit', 'action', 'age', 'birth_date', 'scout_email', 'proj_title', 'beneficiary', 'proposal_review.date', 'proposal_review.who', 'approved_date', 'application_verified', 'svmbc_received', 'ebor_date', 'notes'];
const label = ['', 'Eagle Candidate', 'Unit', 'Action', 'Age', 'Birth Date', 'Scout Email', 'Project Title', 'Beneficiary', 'Date', 'Who', 'Approved Date', 'Application Verified', 'SVMBC Received', 'EBoR Date', 'Notes'];

describe('ScoutDetail', () => {
  const cols = D.layout(group, mach, label);
  it('assigns columns to the three tabs by their group heading; hides _key, Action, Notes', () => {
    const by = (t) => cols.filter(c => c.tab === t).map(c => c.name);
    expect(by('info')).toEqual(['scout_name', 'unit', 'age', 'birth_date', 'scout_email']);
    expect(by('proposal')).toEqual(['proj_title', 'beneficiary', 'proposal_review.date', 'proposal_review.who', 'approved_date']);
    expect(by('eagle')).toEqual(['application_verified', 'svmbc_received', 'ebor_date']);
    expect(cols.find(c => c.name === 'proposal_review.date').label).toBe('Date');
  });
  it('cell types and values', () => {
    expect(D.cell(new Date(2009, 0, 13), 'Birth Date')).toEqual({ type: 'date', value: '2009-01-13' });
    expect(D.cell(new Date(2026, 9, 21, 19, 0), 'Date')).toEqual({ type: 'datetime', value: '2026-10-21T19:00' });
    expect(D.cell(true, 'SVMBC Received')).toEqual({ type: 'bool', value: 'true' });
    expect(D.cell(250, 'Est. Fundraising').type).toBe('number');
    expect(D.cell('', 'EBoR Date').type).toBe('date');
    expect(D.cell('a@b.org', 'Scout Email').type).toBe('email');
  });
  const row = ['R1', 'Scout One', 'T1', '', 17.2, new Date(2009, 0, 13), 'a@b.org', 'Benches', 'Park', new Date(2026, 9, 21, 19), 'AB/CD', '', '', false, ''];
  const formulas = row.map((_, i) => i === 4 ? '=YEARFRAC(F5,TODAY())' : '');
  const tabs = D.tabs(cols, row, formulas);
  const fields = tabs.flatMap(t => t.fields);
  it('builds the tabs; formula columns are not editable', () => {
    expect(tabs.map(t => t.label)).toEqual(['Scout Info', 'Proposal', 'Eagle / EBoR']);
    expect(fields.find(f => f.name === 'age').editable).toBe(false);
    expect(fields.find(f => f.name === 'birth_date')).toMatchObject({ type: 'date', value: '2009-01-13', editable: true });
  });
  it('changes: only real changes, validated', () => {
    const r = D.changes({ scout_name: 'Scout Q. One', birth_date: '2009-01-31', unit: 'T1', svmbc_received: 'true', 'proposal_review.date': '2026-10-21T19:00' }, fields);
    expect(r.errors).toEqual([]);
    expect(r.changes.map(c => c.name)).toEqual(['scout_name', 'birth_date', 'svmbc_received']);
    expect(D.changes({ age: '18' }, fields).errors[0]).toMatch(/calculated/);
    expect(D.changes({ birth_date: '13/01/2009' }, fields).errors[0]).toMatch(/pick a date/);
    expect(D.changes({ scout_email: 'nope' }, fields).errors[0]).toMatch(/not an email/);
    expect(D.changes({ scout_name: '' }, fields).errors[0]).toMatch(/can't be empty/);
  });
  it('log lines', () => {
    const r = D.changes({ birth_date: '2009-01-31', unit: 'T2' }, fields);
    expect(D.logLine('10/23', 'AB', r.changes)).toBe('10/23 [AB] Edited: Unit: "T1" → "T2"; Birth Date: "2009-01-13" → "2009-01-31"');
    expect(D.moveLine('10/23', 'JW', 'EBoR Booked', 'Application Verified', 'booked by mistake')).toBe('10/23 [JW] Moved (correction) from EBoR Booked to Application Verified: booked by mistake');
  });
});
