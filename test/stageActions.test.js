import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SA = require('../apps-script/src/lib/stageActions.js');

describe('StageActions', () => {
  const cols = SA.resolveColumns(['scout_name', 'application_submitted', 'council.application_verified', 'emailed_to_set_up_ebor', 'notes'], {});
  it('finds the tracking columns by name, Settings override first', () => {
    expect(cols).toEqual({ submitted: 'application_submitted', verified: 'council.application_verified', emailedEbor: 'emailed_to_set_up_ebor', ebor: '', signedSent: '', svmbcReceived: '' });
    expect(SA.resolveColumns(['x_verified', 'application_verified'], { appVerifiedColumn: 'x_verified' }).verified).toBe('x_verified');
    expect(SA.resolveColumns([], {}).verified).toBe('');
  });
  it('offers actions by stage', () => {
    expect(SA.forSection('app_submitted').map(a => a.key)).toEqual(['app_verified', 'checked', 'followup']);
    expect(SA.forSection('proposal_approved').map(a => a.key)).toEqual(['app_submitted', 'app_verified', 'checked', 'followup']);
    expect(SA.forSection('review_booked')[0]).toMatchObject({ key: 'review_outcome', page: '/committee/review' });
    expect(SA.forSection('eagle_earned').map(a => a.key)).toEqual(['paperwork', 'svmbc_received']);
    expect(SA.resolveColumns(['signed_eagle_application_and.date', 'signed_eagle_application_and.who', 'eagle_earned.svmbc_received'], {}))
      .toMatchObject({ signedSent: 'signed_eagle_application_and.date', svmbcReceived: 'eagle_earned.svmbc_received' });
    expect(Object.keys(SA.bySection(['proposal_approved', 'eagle_not_awarded', 'app_submitted']))).toEqual(['proposal_approved', 'eagle_not_awarded', 'app_submitted']);   // Close record… (2026-11-10)
    expect(Object.keys(SA.bySection(['proposal_approved', 'nowhere', 'app_submitted']))).toEqual(['proposal_approved', 'app_submitted']);
    expect(SA.forSection('proposal_received').map(a => a.key)).toEqual(['intake_ok', 'incomplete', 'not_approved', 'checked', 'followup']);
    expect(SA.forSection('proposal_incomplete').map(a => a.key)).toEqual(['intake_ok', 'incomplete', 'not_approved', 'checked', 'followup']);
    expect(SA.forSection('intake_to_book').map(a => a.key)).toEqual(['resend_intake', 'book_intake', 'checked', 'followup']);
    expect(SA.forSection('intake_booked').map(a => a.key)).toEqual(['review_ok', 'intake_revisions', 'not_approved', 'checked', 'followup']);
    expect(SA.forSection('intake_revisions').map(a => a.key)).toEqual(['review_ok', 'intake_revisions', 'not_approved', 'checked', 'followup']);
    expect(SA.forSection('review_to_book').map(a => a.key)).toEqual(['resend_review', 'book_review', 'checked', 'followup']);
    expect(SA.forSection('proposal_revisions').map(a => a.key)).toEqual(['review_outcome', 'checked', 'followup']);
    expect(SA.forSection('proposal_not_approved').map(a => a.key)).toEqual(['close', 'keep_open', 'followup']);   // no stage moves from here; Closed records (2026-11-10)
    expect(SA.forSection('app_verified').map(a => a.key)).toEqual(['book_ebor', 'resend_ebor', 'checked', 'followup']);
    expect(SA.forSection('ebor_booked').map(a => a.key)).toEqual(['eagle_earned', 'ebor_paused', 'eagle_not_awarded', 'checked', 'followup']);
    expect(SA.forSection('ebor_paused').map(a => a.key)).toEqual(['book_ebor', 'paused_not_awarded', 'close', 'keep_open', 'followup']);
    expect(SA.plan({ section: 'ebor_paused', action: 'paused_not_awarded', note: 'x', cols: {} })).toMatchObject({ errors: [], warnings: [], set: {}, to: 'eagle_not_awarded' });
    expect(SA.forSection('eagle_earned').map(a => a.key)).toEqual(['paperwork', 'svmbc_received']);
    expect(SA.resolveColumns(['signed_eagle_application_and.date', 'signed_eagle_application_and.who', 'eagle_earned.svmbc_received'], {}))
      .toMatchObject({ signedSent: 'signed_eagle_application_and.date', svmbcReceived: 'eagle_earned.svmbc_received' });
    expect(SA.forSection('proposal_received').find(a => a.key === 'incomplete')).toMatchObject({ noteToEmail: true });
    expect(SA.forSection('proposal_received').find(a => a.key === 'checked')).toMatchObject({ ifPending: true });
  });
  const base = { action: 'app_verified', section: 'app_submitted', date: '2026-10-22', today: '2026-10-23', cols };
  it('verified: records the date, quiet when the submitted date is earlier', () => {
    const p = SA.plan({ ...base, dates: { submitted: '2026-10-10' } });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.set).toEqual({ verified: '2026-10-22' });
    expect(p.to).toBe('app_verified');
  });
  it('verified straight from Proposal Approved fills the submitted date too (with a warning)', () => {
    const p = SA.plan({ ...base, section: 'proposal_approved', dates: {} });
    expect(p.set).toEqual({ verified: '2026-10-22', submitted: '2026-10-22' });
    expect(p.warnings[0]).toMatch(/No Application Submitted date/);
  });
  it('warns on a changed date or odd order; refuses wrong stage, future date, missing column', () => {
    expect(SA.plan({ ...base, dates: { verified: '2026-10-01', submitted: '2026-09-01' } }).warnings[0]).toMatch(/already has Application Verified 10\/1\/2026/);
    expect(SA.plan({ ...base, dates: { submitted: '2026-10-25' } }).warnings[0]).toMatch(/after/);
    expect(SA.plan({ ...base, section: 'eagle_earned' }).errors[0]).toMatch(/no longer at a stage/);
    expect(SA.plan({ ...base, date: '2026-10-24' }).errors[0]).toMatch(/future/);
    expect(SA.plan({ ...base, cols: { ...cols, verified: '' } }).errors[0]).toMatch(/no "Application Verified" column/);
    expect(SA.plan({ ...base, cols: { ...cols, emailedEbor: '' }, dates: { submitted: '2026-10-01' } }).warnings[0]).toMatch(/won't be recorded/);
  });
  it('submitted: acknowledgement, moves to Application Submitted', () => {
    const p = SA.plan({ ...base, action: 'app_submitted', section: 'proposal_approved', dates: {} });
    expect(p).toMatchObject({ errors: [], warnings: [], set: { submitted: '2026-10-22' }, to: 'app_submitted' });
    expect(SA.get('app_submitted').template).toBe('Application submitted: acknowledgement');
  });
  it('proposal decisions: no date, note warning, stay vs move, Checked needs new files', () => {
    const b = { section: 'proposal_incomplete', today: '2026-10-23', cols };
    expect(SA.plan({ ...b, action: 'intake_ok' })).toMatchObject({ errors: [], warnings: [], set: {}, to: 'intake_to_book' });
    const inc = SA.plan({ ...b, action: 'incomplete' });
    expect(inc.to).toBeNull();                                     // already in Proposal Incomplete: stays
    expect(inc.warnings[0]).toMatch(/No note/);
    expect(SA.plan({ ...b, action: 'incomplete', note: 'Missing signatures' }).warnings).toEqual([]);
    expect(SA.plan({ ...b, section: 'proposal_received', action: 'incomplete', note: 'x' }).to).toBe('proposal_incomplete');
    expect(SA.plan({ ...b, section: 'intake_booked', action: 'review_ok' }).to).toBe('review_to_book');
    expect(SA.plan({ ...b, section: 'intake_to_book', action: 'resend_intake' }).to).toBeNull();
    expect(SA.plan({ ...b, action: 'checked' }).errors[0]).toMatch(/no new files/);
    expect(SA.plan({ ...b, action: 'checked', pending: true }).errors).toEqual([]);
    expect(SA.plan({ ...b, section: 'review_booked', action: 'intake_ok' }).errors[0]).toMatch(/no longer at a stage/);
    expect(SA.logLine('10/23', 'CD', 'incomplete', '', 'Missing beneficiary signature')).toBe('10/23 [CD] Proposal incomplete: changes requested. Note: Missing beneficiary signature');
  });
  it('EBoR outcomes record the board date and move the row', () => {
    const c2 = SA.resolveColumns(['ebor_date', 'application_verified'], { eborDateColumn: 'ebor_date' });
    const b = { section: 'ebor_booked', today: '2026-10-23', cols: c2, date: '2026-10-21' };
    expect(SA.plan({ ...b, action: 'eagle_earned', dates: { ebor: '2026-10-21' } })).toMatchObject({ errors: [], warnings: [], set: { ebor: '2026-10-21' }, to: 'eagle_earned' });
    expect(SA.plan({ ...b, action: 'eagle_earned', dates: { ebor: '2026-10-29' } }).warnings[0]).toMatch(/already has EBoR Date 10\/29\/2026/);
    expect(SA.plan({ ...b, action: 'ebor_paused', dates: { ebor: '2026-10-21' } }).warnings[0]).toMatch(/No note/);
    expect(SA.plan({ ...b, action: 'eagle_not_awarded', note: 'x', dates: { ebor: '2026-10-21' } }).to).toBe('eagle_not_awarded');
    expect(SA.forSection('ebor_booked')[0]).toMatchObject({ dateDefault: 'ebor' });
    expect(SA.plan({ section: 'app_verified', action: 'resend_ebor', cols: c2 })).toMatchObject({ errors: [], to: null });
  });
  it('Eagle earned: scans both or neither; photos optional; paperwork needs both; Council received needs its column', () => {
    const c3 = SA.resolveColumns(['ebor_date', 'eagle_earned.svmbc_received'], {});
    const b = { action: 'eagle_earned', section: 'ebor_booked', today: '2026-10-23', date: '2026-10-21', cols: c3, dates: { ebor: '2026-10-21' } };
    expect(SA.plan({ ...b, files: ['application', 'report', 'photo'] })).toMatchObject({ errors: [], warnings: [] });
    expect(SA.plan({ ...b, files: ['application'] }).errors[0]).toMatch(/both signed scans/);
    expect(SA.plan({ ...b, files: [] }).warnings.join(' ')).toMatch(/No signed scans.*No photos/);
    expect(SA.plan({ action: 'paperwork', section: 'eagle_earned', cols: c3, files: ['report'] }).errors[0]).toMatch(/signed Eagle Scout Rank Application/);
    expect(SA.plan({ action: 'svmbc_received', section: 'eagle_earned', cols: c3 }).errors).toEqual([]);
    expect(SA.plan({ action: 'svmbc_received', section: 'eagle_earned', cols: {} }).errors[0]).toMatch(/SVMBC Received/);
    expect(SA.forSection('ebor_booked')[0]).toMatchObject({ files: ['application', 'report', 'photo'] });
  });
  it('log line', () => {
    expect(SA.logLine('10/23', 'AB', 'app_verified', '2026-10-22', 'via email')).toBe('10/23 [AB] Eagle application verified by Council (10/22/2026). Note: via email');
  });
});

describe('StageActions: schedule-page actions say which type to open (2026-11-11)', () => {
  it('book actions carry new=<type> so the schedule page opens the dialog for that Scout', () => {
    const find = (sec, key) => SA.forSection(sec).find(a => a.key === key);
    expect(find('intake_to_book', 'book_intake')).toMatchObject({ page: '/committee/schedule', pageQuery: 'new=Intake' });
    expect(find('review_to_book', 'book_review')).toMatchObject({ page: '/committee/schedule', pageQuery: 'new=ESSPPR' });
    expect(find('app_verified', 'book_ebor')).toMatchObject({ page: '/committee/schedule', pageQuery: 'new=EBoR' });
    expect(find('ebor_paused', 'book_ebor')).toMatchObject({ pageQuery: 'new=EBoR' });
  });
});
