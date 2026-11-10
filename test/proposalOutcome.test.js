import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../apps-script/src/lib/proposalOutcome.js');
const Intake = require('../apps-script/src/lib/intake.js');

describe('ProposalOutcome initials', () => {
  it('normalizes the ways members type them', () => {
    for (const t of ['JW, TW', 'JW TW', 'jw&tw', 'J.W. & T.W.', 'JW and TW', ' JW / TW ', 'JW;TW', 'JW&TW', 'JW, JW, TW']) {
      expect(P.normalizeInitials(t).text).toBe('JW&TW');
    }
    expect(P.normalizeInitials('AB').text).toBe('AB');
  });
  it('refuses empty or non-initials, warns on unknown', () => {
    expect(P.normalizeInitials('').errors.length).toBe(1);
    expect(P.normalizeInitials('AB 12').errors[0]).toMatch(/12/);
    expect(P.normalizeInitials('Jimmy').errors.length).toBe(1);
    const r = P.normalizeInitials('AB, RPF', ['AB', 'CD']);
    expect(r.errors).toEqual([]);
    expect(r.unknown).toEqual(['RPF']);
  });
});

describe('ProposalOutcome signed copy', () => {
  it('builds the standard signed name', () => {
    expect(P.signedFileName('Scout Q. Nine', 'T 109', 'AB&CD', Intake.namePart, Intake.unitPart))
      .toBe('Scout_Q_Nine-T109_ESSPP-ApprovedAndSignedBy-AB&CD.pdf');
  });
  it('archives every ESSPP version and an earlier signed copy, nothing else', () => {
    const top = [
      { id: 'v1', name: 'S-T1_ESSPP-V1.pdf' }, { id: 'v3', name: 'S-T1_ESSPP-V3.pdf' },
      { id: 'old', name: 'S-T1_ESSPP-ApprovedAndSignedBy-AB.pdf' },
      { id: 'sl', name: 'S-T1_Slides-V2.pptx' }, { id: 'sig', name: 'S-T1_Signatures-V1.pdf' }, { id: 'odd', name: 'scan.pdf' },
      { id: 'new', name: 'S-T1_ESSPP-ApprovedAndSignedBy-AB&CD.pdf' }
    ];
    expect(P.archivePlan(top, 'new')).toEqual(['v1', 'v3', 'old']);
  });
  it('the signed name is not an ESSPP version (versioning stops at approval)', () => {
    const ScoutFiles = require('../apps-script/src/lib/scoutFiles.js');
    expect(ScoutFiles.parseStandardName('S-T1_ESSPP-ApprovedAndSignedBy-AB&CD.pdf')).toBeNull();
  });
  it('PDF only', () => {
    expect(P.isPdfName('a.PDF')).toBe(true);
    expect(P.isPdfName('a.docx')).toBe(false);
  });
});

describe('ProposalOutcome dates', () => {
  const base = { outcome: 'approved', date: '2026-10-23', today: '2026-10-23' };
  it('quiet when the review date is earlier and no Approved Date yet', () => {
    const r = P.datePlan({ ...base, reviewDate: '2026-10-21', approvedDate: '' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.set).toEqual({ reviewDate: null, approvedDate: '2026-10-23' });
  });
  it('warns and fills a missing review date', () => {
    const r = P.datePlan({ ...base, reviewDate: '' });
    expect(r.warnings[0]).toMatch(/no Proposal Review date/);
    expect(r.set.reviewDate).toBe('2026-10-23');
  });
  it('warns and replaces a later review date', () => {
    const r = P.datePlan({ ...base, reviewDate: '2026-10-28' });
    expect(r.warnings[0]).toMatch(/10\/28\/2026/);
    expect(r.set.reviewDate).toBe('2026-10-23');
  });
  it('keeps an existing Approved Date that matches; warns when it changes', () => {
    expect(P.datePlan({ ...base, date: '2026-10-20', reviewDate: '2026-10-19', approvedDate: '2026-10-20' }).set.approvedDate).toBeNull();
    const r = P.datePlan({ ...base, reviewDate: '2026-10-19', approvedDate: '2026-10-20' });
    expect(r.warnings[0]).toMatch(/already has Approved Date/);
    expect(r.set.approvedDate).toBe('2026-10-23');
  });
  it('no Approved Date for other outcomes; refuses future or missing dates', () => {
    expect(P.datePlan({ ...base, outcome: 'revisions', reviewDate: '2026-10-21' }).set.approvedDate).toBeNull();
    expect(P.datePlan({ ...base, date: '2026-10-24' }).errors[0]).toMatch(/future/);
    expect(P.datePlan({ ...base, date: '' }).errors.length).toBe(1);
  });
});

describe('ProposalOutcome page data', () => {
  const recs = [
    { recordId: 'R1', section: 'review_booked', scout_name: 'Scout B', unit: 'T1', who: 'AB/CD', reviewDate: '2026-10-21' },
    { recordId: 'R2', section: 'proposal_revisions', scout_name: 'Scout A', unit: 'T2', reviewDate: '2026-10-07' },
    { recordId: 'R3', section: 'review_booked', scout_name: 'Scout C', unit: 'T3', reviewDate: '2026-10-28' },
    { recordId: 'R4', section: 'proposal_approved', scout_name: 'Scout D', unit: 'T4', reviewDate: '2026-10-01' },
    { recordId: 'R5', section: 'review_booked', scout_name: 'Scout E', unit: 'T5', reviewDate: '' }
  ];
  it('lists only reviewed / revision Scouts, held reviews first', () => {
    const c = P.choices(recs, null, '2026-10-23');
    expect(c.map(x => x.recordId)).toEqual(['R2', 'R1', 'R5', 'R3']);
    expect(c[1].who).toBe('AB/CD');
    expect(c[3].upcoming).toBe(true);
  });
  it('dashboard counts', () => {
    const now = new Date(2026, 9, 23, 9).getTime();
    const slots = [
      { booked: true, type: 'Intake', start: now + 3600e3 }, { booked: false, type: 'ESSPPR', start: now + 3600e3 },
      { booked: true, type: 'EBoR', start: now - 3600e3 }, { booked: true, type: 'EBoR', start: now + 20 * 86400e3 }
    ];
    expect(P.homeCounts(recs, slots, 3, now, '2026-10-23')).toEqual({ outbox: 3, upcoming: 1, awaitingOutcome: 1, revisions: 1, toApprove: 4, signing: 0,
      pending: 0, oldestPendingDays: 0 });
    const withPending = recs.map((r, i) => ({ ...r, pending: i === 0 ? now - 3.5 * 86400e3 : i === 1 ? now - 3600e3 : 0 }));
    const c = P.homeCounts(withPending, slots, 0, now, '2026-10-23');
    expect([c.pending, c.oldestPendingDays]).toEqual([2, 3]);
    expect(P.choices(withPending, null, '2026-10-23').find(x => x.recordId === 'R1').pending).toBe(true);
  });
  it('log lines', () => {
    expect(P.logLine('10/23', 'JW', 'approved', 'AB&CD', 'S-T1_ESSPP-ApprovedAndSignedBy-AB&CD.pdf', 'Great  project'))
      .toBe('10/23 [JW] Proposal approved, signed by AB&CD (S-T1_ESSPP-ApprovedAndSignedBy-AB&CD.pdf). Note: Great project');
    expect(P.logLine('10/23', 'CD', 'revisions', 'AB&CD', '', '')).toBe('10/23 [CD] Revisions requested (AB&CD)');
  });
});

describe('ProposalOutcome signatures in progress', () => {
  it('writes and reads the Signing cell', () => {
    const t = P.signingText({ waiting: ['CD', 'PQ'], since: '2026-11-08', signed: ['AB'] });
    expect(t).toBe('Waiting on CD, PQ since 2026-11-08; signed AB');
    expect(P.parseSigning(t)).toEqual({ waiting: ['CD', 'PQ'], since: '2026-11-08', signed: ['AB'] });
    expect(P.parseSigning('Waiting on CD since 2026-11-08; signed AB&PQ').signed).toEqual(['AB', 'PQ']);
    expect(P.parseSigning('')).toBe(null);
    expect(P.parseSigning('done')).toBe(null);
  });
  it('tells the Scout signatures are in progress only while approved and waiting', () => {
    const w = 'Waiting on CD since 2026-11-08; signed AB';
    expect(P.scoutStatus('Proposal approved', 'proposal_approved', w)).toBe(P.SIGNING_STATUS);
    expect(P.scoutStatus('Proposal approved', 'proposal_approved', '')).toBe('Proposal approved');
    expect(P.scoutStatus('Application submitted', 'app_submitted', w)).toBe('Application submitted');
  });
  it('checks next signers against the committee and who already signed', () => {
    const members = [{ initials: 'AB', email: 'ab@example.org' }, { initials: 'CD', email: 'cd@example.org' }, { initials: 'PQ', email: '' }];
    expect(P.nextSigners(['cd', 'CD'], members, ['AB'])).toEqual({ list: ['CD'], emails: ['cd@example.org'], errors: [] });
    expect(P.nextSigners(['AB'], members, ['AB']).errors[0]).toMatch(/already signed/);
    expect(P.nextSigners(['PQ'], members, []).errors[0]).toMatch(/email/);
    expect(P.nextSigners([], members, []).errors[0]).toMatch(/Pick who/);
  });
  it('adds signers in order without repeats', () => {
    expect(P.addSigners(['AB'], ['CD', 'AB'])).toEqual(['AB', 'CD']);
  });
  it('offers approved Scouts with signatures pending on the Review page', () => {
    const recs = [
      { recordId: 'R1', section: 'proposal_approved', scout_name: 'Pat Q', signing: 'Waiting on CD since 2026-11-08; signed AB', reviewDate: '2026-11-04' },
      { recordId: 'R2', section: 'proposal_approved', scout_name: 'Teddy Sample', signing: '' },
      { recordId: 'R3', section: 'review_booked', scout_name: 'Owen Fairbanks', reviewDate: '2026-11-05' }
    ];
    const c = P.choices(recs, null, '2026-11-08');
    expect(c.map(x => x.recordId)).toEqual(['R1', 'R3']);
    expect(c[0].signing.waiting).toEqual(['CD']);
    expect(c[1].signing).toBe(null);
    expect(P.homeCounts(recs, [], 0, 0, '2026-11-08').signing).toBe(1);
  });
  it('drafts the signer email and log lines', () => {
    const e = P.signerEmail({ scout: 'Pat Q', unit: 'T999', date: '11/4/2026', signed: 'AB', by: 'AB', link: 'https://x/committee/review?r=R1' });
    expect(e.subject).toBe('Please sign: Eagle Project Proposal for Pat Q (T999)');
    expect(e.body).toMatch(/review\?r=R1/);
    expect(e.body).not.toMatch(/Note:/);
    expect(P.signLogLine('11/8', 'CD', 'Signature added', 'AB&CD', 'f.pdf', ['PQ'])).toBe('11/8 [CD] Signature added (AB&CD, f.pdf); waiting on PQ');
    expect(P.signLogLine('11/8', 'CD', 'Signature added', 'AB&CD', 'f.pdf', [])).toMatch(/signatures complete$/);
  });
  it('lists signatures waiting too long for the digest', () => {
    const recs = [{ title: 'Pat Q (T999)', signing: 'Waiting on CD since 2026-11-01; signed AB' },
      { title: 'Teddy Sample (T999)', signing: 'Waiting on CD since 2026-11-07; signed AB' }, { title: 'x', signing: '' }];
    expect(P.signingOverdue(recs, '2026-11-08', 3)).toEqual([{ title: 'Pat Q (T999)', waiting: 'CD', days: 7 }]);
  });
});
