import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../apps-script/src/lib/adminRules.js');

describe('Admin: intake exceptions', () => {
  const now = new Date(2026, 9, 24, 9).getTime(), H = 3600e3;
  const q = (id, st, ago, extra = {}) => ({ 'Queue ID': id, Status: st, Submitted: new Date(now - ago), 'Eagle Candidate': 'S_' + id, Unit: 'T1', ...extra });
  it('lists only what needs a person, newest first, with the right actions', () => {
    const list = A.intakeExceptions([
      q('A', 'Promoted', H), q('B', 'Unconfirmed', 30 * H, { _confirm_expires: new Date(now - H) }), q('C', 'Possible duplicate', 2 * H),
      q('D', 'Error', 5 * H), q('E', 'Confirmed', 10 * 60e3), q('F', 'Confirmed', 3 * H), q('G', 'Uploading', 3 * H), q('H', 'Spam/deleted', H)
    ], now);
    expect(list.map(x => [x.queueId, x.actions.join('|')])).toEqual([
      ['C', 'attach|promote|spam'], ['F', 'promote|spam'], ['G', 'emailUpload|dismiss'], ['D', 'promote|attach|spam'], ['B', 'resend|spam']]);
    expect(list.find(x => x.queueId === 'B').why).toMatch(/expired/);
  });

  // Unfinished uploads (Jim W., 2026-11-12)
  it('says why an upload never finished', () => {
    expect(A.uploadWhy('')).toMatch(/closed or left/);
    expect(A.uploadWhy('Upload failed 11/11 6:31 PM: proposal.pdf: larger than 20 MB; Emailed 11/12 (JW)'))
      .toBe('Upload failed: proposal.pdf: larger than 20 MB');
    const list = A.intakeExceptions([q('G', 'Uploading', 3 * H, { Note: 'Upload failed 10/24 6:00 AM: Network error' })], now);
    expect(list[0].why).toBe('Upload failed: Network error');
  });
  it('a later finished submission from the same Scout email replaces an unfinished upload', () => {
    const rows = [
      q('U1', 'Uploading', 5 * H, { 'Scout Email': 'scout@example.org' }),
      q('U2', 'Uploading', 4 * H, { 'Scout Email': 'other@example.org' }),
      q('N1', 'Unconfirmed', 3 * H, { 'Scout Email': 'Scout@Example.org' }),
      q('N2', 'Promoted', 2 * H, { 'Scout Email': 'scout@example.org' }),
      q('X', 'Spam/deleted', H, { 'Scout Email': 'other@example.org' }),
      q('U3', 'Uploading', 30 * 60e3, { 'Scout Email': 'scout@example.org' })   // after the finished ones: still open
    ];
    expect(A.replacedUploads(rows)).toEqual([{ queueId: 'U1', by: 'N2' }]);
    expect(A.intakeExceptions(rows, now).map(x => x.queueId)).not.toContain('U1');
    expect(A.intakeExceptions(rows, now).map(x => x.queueId)).toContain('U2');
  });
  it('appends to a Note', () => {
    expect(A.appendNote('', 'Emailed 11/12 (JW)')).toBe('Emailed 11/12 (JW)');
    expect(A.appendNote('x', 'y')).toBe('x; y');
  });
});

describe('Admin: Eagle archive', () => {
  const recs = [
    { recordId: 'R1', section: 'eagle_earned', ebor: '2025-12-01' }, { recordId: 'R2', section: 'eagle_earned', ebor: '2026-03-01' },
    { recordId: 'R3', section: 'eagle_earned', ebor: '2026-10-12' }, { recordId: 'R4', section: 'ebor_booked', ebor: '2026-11-01' },
    { recordId: 'R5', section: 'eagle_earned', ebor: '' }
  ];
  it('counts per year and picks the year\'s Eagles only', () => {
    expect(A.archiveYears(recs)).toEqual([{ year: '2025', count: 1 }, { year: '2026', count: 2 }, { year: 'no EBoR date', count: 1 }]);
    expect(A.archiveIds(recs, 2026)).toEqual(['R2', 'R3']);
  });
  it('delete runs, bottom-up', () => {
    const keep = new Set([5, 6, 9]);
    expect(A.deleteRuns(10, 4, r => keep.has(r))).toEqual([[10, 1], [7, 2], [4, 1]]);
    expect(A.deleteRuns(6, 4, () => false)).toEqual([[4, 3]]);
    expect(A.deleteRuns(6, 4, () => true)).toEqual([]);
  });
});

describe('web submission vs tracking row (2026-11-04)', () => {
  const A = require('../apps-script/src/lib/adminRules.js');
  const Intake = require('../apps-script/src/lib/intake.js');
  const S = require('../apps-script/src/lib/scoutFiles.js');
  it('field by field: only fields the form filled; emails compared without case', () => {
    const cur = { scout_name: 'Theodore Sample', unit: 'T999', birth_date: new Date(2011, 5, 14), scout_email: 'Teddy.Sample01@example.org', parent_email: '', beneficiary: 'Riverbend Park' };
    const form = { scout_name: 'Theodore Sample', unit: 'T999', birth_date: '2011-06-13', scout_email: 'teddy.sample01@example.org', parent_email: 'p@x.org', beneficiary: 'Riverbend Parks', proj_coach: '' };
    const rows = A.compareRows(cur, form, Intake.FIELDS, v => S.show(v));
    expect(rows.map(r => [r.key, r.differs])).toEqual([['scout_name', false], ['unit', false], ['birth_date', true], ['scout_email', false],
      ['parent_email', true], ['beneficiary', true]]);
    expect(rows.find(r => r.key === 'birth_date')).toMatchObject({ sheet: '2011-06-14', form: '2011-06-13' });
  });
  it('attached submissions to compare: differed, not reviewed, last 60 days', () => {
    const now = new Date(2026, 10, 4).getTime();
    const q = [
      { 'Queue ID': 'Q1', 'Status': 'Attached', 'Record ID': 'R1', 'Submitted': new Date(2026, 10, 4), 'Note': 'Files attached to R1. Differs: Birth date …' },
      { 'Queue ID': 'Q2', 'Status': 'Attached', 'Record ID': 'R2', 'Submitted': new Date(2026, 10, 4), 'Note': 'Files attached to R2' },
      { 'Queue ID': 'Q3', 'Status': 'Attached', 'Record ID': 'R3', 'Submitted': new Date(2026, 10, 4), 'Note': 'Differs: x. Reviewed 11/4 by JW: kept the sheet.' },
      { 'Queue ID': 'Q4', 'Status': 'Attached', 'Record ID': 'R4', 'Submitted': new Date(2026, 7, 1), 'Note': 'Differs: x' },
      { 'Queue ID': 'Q5', 'Status': 'Promoted', 'Record ID': 'R5', 'Submitted': new Date(2026, 10, 4), 'Note': 'Differs: x' }];
    expect(A.toReview(q, now).map(x => x.queueId)).toEqual(['Q1']);
  });
});
