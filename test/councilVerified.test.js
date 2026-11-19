import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../apps-script/src/lib/councilVerified.js');
const C = require('../apps-script/src/lib/councilApp.js');
const E = require('../apps-script/src/lib/eborPaperwork.js');
const Intake = require('../apps-script/src/lib/intake.js');
const Units = require('../apps-script/src/lib/units.js');

// Shape of Council's "Ready for EBOR" emails (2026-11), fictional Scouts.
describe('Council "Ready for EBOR" emails', () => {
  it('trigger: the subject says Ready for EBOR (sender is a staff member\'s own address: not used)', () => {
    expect(V.isMatch('Owen Patrick Fairbanks, T999, Ready for EBOR')).toBe(true);
    expect(V.isMatch('Fwd: Teddy Sample, T998, ready for EBoR')).toBe(true);
    expect(V.isMatch('RE: Pat Q, T997, Ready for an E.B.O.R.')).toBe(true);
    expect(V.isMatch('Eagle Project Result: Owen Fairbanks')).toBe(false);
    expect(V.isMatch('EBoR reminder: Owen Fairbanks')).toBe(false);
  });

  it('reads name and unit from the subject', () => {
    expect(V.parseSubject('Owen Patrick Fairbanks, T999, Ready for EBOR'))
      .toEqual({ name: 'Owen Patrick Fairbanks', first: 'Owen', middle: 'Patrick', last: 'Fairbanks', unit: 'T999' });
    expect(V.parseSubject('Fwd: Theodore Alan Quincy Sample, T9817, Ready for EBOR'))
      .toMatchObject({ first: 'Theodore', middle: 'Alan Quincy', last: 'Sample', unit: 'T9817' });
    expect(V.parseSubject('Teddy Sample, Troop 9610, Ready for EBOR')).toMatchObject({ first: 'Teddy', last: 'Sample', unit: 'T9610' });
    expect(V.parseSubject('Pat Q T9296 Ready for EBOR')).toMatchObject({ first: 'Pat', last: 'Q', unit: 'T9296' });
    expect(V.parseSubject('Pat Q, Ready for EBOR')).toMatchObject({ first: 'Pat', last: 'Q', unit: '' });
    expect(V.parseSubject('Ready for EBOR')).toBe(null);
    expect(V.parseSubject('Hello')).toBe(null);
  });

  it('the subject feeds the same graded match as Formsite (first + last name in the unit = close)', () => {
    const recs = [
      { recordId: 'R1', scout_name: 'Owen Fairbanks', unit: 'T999' },
      { recordId: 'R2', scout_name: 'Theodore Sample', preferred_name: 'Teddy', unit: 'T998' },
      { recordId: 'R3', scout_name: 'Owen Fairbanks', unit: 'T997' }
    ];
    expect(C.matchRecord(recs, V.parseSubject('Owen Patrick Fairbanks, T999, Ready for EBOR'), Units.code)).toMatchObject({ recordId: 'R1', close: true });
    expect(C.matchRecord(recs, V.parseSubject('Teddy Q Sample, T998, Ready for EBOR'), Units.code)).toMatchObject({ recordId: 'R2', close: true });
    expect(C.matchRecord(recs, V.parseSubject('Owen Fairbanks, Ready for EBOR'), Units.code).close).not.toBe(true);   // two Owens, no unit
  });

  it('recognises documents from their OCR text', () => {
    expect(V.classify('EAGLE SCOUT RANK APPLICATION\nThis application must be ...')).toBe('application');
    expect(V.classify('Eagle Scout Service Project Workbook  Proposal')).toBe('workbook');
    expect(V.classify('Statement of ambitions and life purpose')).toBe('statement');
    expect(V.classify('Letter of Recommendation for ...')).toBe('reference');
    expect(V.classify('')).toBe('');
    expect(V.classify('scanned page, nothing legible')).toBe('');
  });

  it('drops small images (signature logos), keeps documents and real photos', () => {
    expect(V.keep([{ name: 'image001.png', mime: 'image/png', bytes: 8000 }, { name: 'doc1.pdf', mime: 'application/pdf', bytes: 300000 },
      { name: 'IMG_1.jpg', mime: 'image/jpeg', bytes: 2000000 }])).toEqual([1, 2]);
  });

  const plan = (atts) => V.plan(atts, 'Owen Patrick Fairbanks', 'T999', Intake.namePart, Intake.unitPart);

  it('one attachment is the Verified Application, whatever OCR says (Jim W.)', () => {
    const p = plan([{ name: 'doc2026111614520.pdf', kind: '' }]);
    expect(p.files.map(f => f.name)).toEqual(['Owen_Patrick_Fairbanks-T999_EagleApplication-Verified.pdf']);
    expect(p.verified).toBe(0);
    expect(p.toIdentify).toEqual([]);
    expect(p.emailName).toBe('Owen_Patrick_Fairbanks-T999_Council-ReadyForEBoR-Email.pdf');
  });

  it('several attachments: OCR names them; the rest are for a member to identify', () => {
    const p = plan([{ name: 'doc1.pdf', kind: 'workbook' }, { name: 'doc2.pdf', kind: 'application' }, { name: 'doc3.pdf', kind: '' }, { name: 'doc4.PDF', kind: '' }]);
    expect(p.files.map(f => f.name)).toEqual(['Owen_Patrick_Fairbanks-T999_Council-Workbook.pdf', 'Owen_Patrick_Fairbanks-T999_EagleApplication-Verified.pdf',
      'Owen_Patrick_Fairbanks-T999_Council-Doc-01.pdf', 'Owen_Patrick_Fairbanks-T999_Council-Doc-02.pdf']);
    expect(p.verified).toBe(1);
    expect(p.toIdentify).toEqual(['Owen_Patrick_Fairbanks-T999_Council-Doc-01.pdf', 'Owen_Patrick_Fairbanks-T999_Council-Doc-02.pdf']);
  });

  it('two "applications" or none: no file is called Verified; a member decides', () => {
    const p = plan([{ name: 'a.pdf', kind: 'application' }, { name: 'b.pdf', kind: 'application' }]);
    expect(p.verified).toBe(-1);
    expect(p.files.every(f => !/verified/i.test(f.name))).toBe(true);
    expect(p.toIdentify).toHaveLength(2);
    expect(p.toIdentify[0]).toMatch(/looks like an Eagle application/);
    expect(plan([{ name: 'a.pdf', kind: '' }, { name: 'b.pdf', kind: 'statement' }]).verified).toBe(-1);
  });

  it('the EBoR paperwork page picks the Verified Application, not the other Council files', () => {
    const p = plan([{ name: 'doc1.pdf', kind: 'workbook' }, { name: 'doc2.pdf', kind: 'application' }, { name: 'doc3.pdf', kind: '' }]);
    const files = p.files.map((f, i) => ({ id: 'n' + i, name: f.name, modified: 100 - i }))
      .concat([{ id: 'm', name: p.emailName, modified: 200 }, { id: 'old', name: 'Owen_Patrick_Fairbanks-T999-Application_RankApplication.pdf', modified: 1 }]);
    expect(E.pickVerified(files).name).toBe('Owen_Patrick_Fairbanks-T999_EagleApplication-Verified.pdf');
  });

  it('archives the application as submitted (and an earlier verified one, or a same-name file); nothing else', () => {
    const top = [
      { id: 'sub', name: 'Owen_Patrick_Fairbanks-T999-Application_RankApplication.pdf' },
      { id: 'sub2', name: 'Owen_Patrick_Fairbanks-T999-Application_RankApplication-2.jpg' },
      { id: 'wb', name: 'Owen_Patrick_Fairbanks-T999-Application_Workbook.pdf' },
      { id: 'ver', name: 'Owen_Patrick_Fairbanks-T999_EagleApplication-Verified.pdf' },
      { id: 'mail', name: 'Owen_Patrick_Fairbanks-T999_Council-ReadyForEBoR-Email.pdf' },
      { id: 'esspp', name: 'Owen_Patrick_Fairbanks-T999_ESSPP-V2.pdf' },
      { id: 'signed', name: 'Owen_Patrick_Fairbanks-T999_EagleApplication-Signed.pdf' }
    ];
    expect(V.toArchive(top, plan([{ name: 'x.pdf', kind: '' }]))).toEqual(['sub', 'sub2', 'ver', 'mail']);
    // no Verified Application identified: the submitted one stays (only a same-name file moves)
    expect(V.toArchive(top, plan([{ name: 'a.pdf', kind: '' }, { name: 'b.pdf', kind: '' }]))).toEqual(['mail']);
  });

  it('only a close match in Application Submitted / Proposal Approved moves to Application Verified', () => {
    expect(V.decide({ recordId: 'R1', close: true }, 'app_submitted')).toEqual({ match: 'Matched', promote: true });
    expect(V.decide({ recordId: 'R1', close: true }, 'proposal_approved')).toEqual({ match: 'Matched', promote: true });
    expect(V.decide({ recordId: 'R1', close: true }, 'app_verified')).toEqual({ match: 'Matched', promote: false });
    expect(V.decide({ recordId: 'R1', close: true }, 'review_booked')).toEqual({ match: 'Stage?', promote: false });
    expect(V.decide({ recordId: 'R1', close: false }, 'app_submitted')).toEqual({ match: 'Check', promote: false });
    expect(V.decide({ error: 'No Scout named X' }, '')).toEqual({ match: 'No match', promote: false });
  });

  it('digest + dashboard: anything not Matched, or files to identify, until Checked', () => {
    const d = new Date(2026, 10, 18, 9);
    const rows = [
      { 'Received': d, 'Name on email': 'Owen Fairbanks', 'Unit on email': 'T999', 'Match': 'Matched', 'Record ID': 'R1', 'Scout': 'Owen Fairbanks (T999)', 'To identify': '', 'Checked': true },
      { 'Received': d, 'Name on email': 'Teddy Sample', 'Unit on email': 'T998', 'Match': 'Matched', 'Record ID': 'R2', 'Scout': 'Theodore Sample (T998)', 'To identify': 'X_Council-Doc-01.pdf', 'Checked': false, 'Folder': 'https://f' },
      { 'Received': d, 'Name on email': 'Pat Q', 'Unit on email': '', 'Match': 'No match', 'Record ID': '', 'Folder': 'https://nm', 'Checked': '' },
      { 'Received': d, 'Name on email': 'Pat R', 'Unit on email': 'T997', 'Match': 'Check', 'Record ID': 'R3', 'Scout': 'Pat Roe (T997)', 'How': 'same last name + unit', 'Checked': 'TRUE' }
    ];
    const list = V.toCheck(rows, () => '11/18');
    expect(list.map(x => x.title)).toEqual(['Ready for EBOR: Teddy Sample (T998), 11/18', 'Ready for EBOR: Pat Q, 11/18']);
    expect(list[0].why).toMatch(/which document is which\? X_Council-Doc-01\.pdf/);
    expect(list[1].why).toMatch(/no matching Scout/);
    expect(V.flags(rows, () => '11/18')).toEqual({ R2: expect.objectContaining({ folder: 'https://f', label: 'Council', tab: 'Council Verified' }) });
  });
});

describe('CouncilVerified.rowsToTick (dashboard "✓ Council email checked")', () => {
  it('Matched rows with files to identify count until Checked; plain Matched rows never do', () => {
    const rows = [
      { _row: 2, 'Record ID': 'R1', 'Match': 'Matched', 'To identify': '', 'Checked': true },
      { _row: 3, 'Record ID': 'R1', 'Match': 'Matched', 'To identify': 'Scout_1-T999_Council-Doc-01.pdf', 'Checked': false },
      { _row: 4, 'Record ID': 'R1', 'Match': 'Matched', 'To identify': '', 'Checked': false },
      { _row: 5, 'Record ID': 'R1', 'Match': 'Matched', 'To identify': 'x.pdf', 'Checked': true },
      { _row: 6, 'Record ID': 'R2', 'Match': 'Check', 'To identify': '', 'Checked': false }
    ];
    expect(V.rowsToTick(rows, 'R1').map(r => r._row)).toEqual([3]);
    expect(V.rowsToTick(rows, 'R2').map(r => r._row)).toEqual([6]);
  });
});

describe('Naming the files to identify (dashboard panel)', () => {
  const D1 = 'Owen_Fairbanks-T999_Council-Doc-01.pdf', D2 = 'Owen_Fairbanks-T999_Council-Doc-02.jpg';
  it('identifyNames reads the To identify cell', () => {
    expect(V.identifyNames(D1 + '; ' + D2 + ' (looks like an Eagle application: which one is the verified one?)')).toEqual([D1, D2]);
    expect(V.identifyNames('which file is the verified application?')).toEqual([]);
    expect(V.identifyNames('')).toEqual([]);
  });
  it('keyword', () => {
    expect(V.keyword('signature page')).toBe('SignaturePage');
    expect(V.keyword('Merit-badge record!')).toBe('Merit-badgeRecord');
    expect(V.keyword('Workbook-Signatures')).toBe('Workbook-Signatures');
    expect(V.keyword('  ../  ')).toBe('');
    expect(V.keyword('x'.repeat(60)).length).toBe(40);
  });
  it('identifyName keeps name, unit, Council- and the extension; numbers a taken name', () => {
    expect(V.identifyName(D1, 'MeritBadges', [])).toBe('Owen_Fairbanks-T999_Council-MeritBadges.pdf');
    expect(V.identifyName(D2, 'Workbook-Signatures', [])).toBe('Owen_Fairbanks-T999_Council-Workbook-Signatures.jpg');
    expect(V.identifyName(D1, 'Workbook', ['owen_fairbanks-t999_council-workbook.pdf'])).toBe('Owen_Fairbanks-T999_Council-Workbook-2.pdf');
    expect(V.identifyName(D1, 'Workbook', ['Owen_Fairbanks-T999_Council-Workbook.pdf', 'Owen_Fairbanks-T999_Council-Workbook-2.pdf']))
      .toBe('Owen_Fairbanks-T999_Council-Workbook-3.pdf');
    expect(V.identifyName('Owen_Fairbanks-T999_EagleApplication-Verified.pdf', 'Workbook', [])).toBe(null);
    expect(V.identifyName(D1, ' !! ', [])).toBe(null);
  });
  it('afterIdentify drops renamed entries; renameNote', () => {
    const cell = D1 + '; ' + D2 + ' (looks like an Eagle application: which one is the verified one?)';
    expect(V.afterIdentify(cell, { [D2]: 'x' })).toBe(D1);
    expect(V.afterIdentify(cell, { [D1]: 'x', [D2]: 'y' })).toBe('');
    expect(V.renameNote(D1, 'Owen_Fairbanks-T999_Council-MeritBadges.pdf')).toBe('Council-Doc-01 → Council-MeritBadges');
  });
});

describe('What a Council attachment is, from its own name (before OCR)', () => {
  it('classifyName', () => {
    expect(V.classifyName('Project Report - signed.pdf')).toBe('report');
    expect(V.classifyName('Rank Advancement History.pdf')).toBe('meritbadges');
    expect(V.classifyName('Scout_1 Merit Badges.pdf')).toBe('meritbadges');
    expect(V.classifyName('Owen Fairbanks Eagle Project.pdf')).toBe('workbook');
    expect(V.classifyName('Owen Fairbanks Eagle.pdf')).toBe('');            // too vague: OCR or a member decides
    expect(V.classifyName('Eagle_Scout_Service_Project_Workbook.pdf')).toBe('workbook');
    expect(V.classifyName('Eagle Scout Rank Application.pdf')).toBe('application');
    expect(V.classifyName('eagle-app-verified.pdf')).toBe('application');
    expect(V.classifyName('Statement of Ambitions.pdf')).toBe('statement');
    expect(V.classifyName('Reference letter - coach.pdf')).toBe('reference');
    expect(V.classifyName('doc2026111910123.pdf')).toBe('');
    expect(V.classifyName('scan0001.pdf')).toBe('');
    expect(V.classifyName('')).toBe('');
  });
  it('kindOf: name first, OCR only up to 2 MB', () => {
    let read = 0;
    const ocr = () => { read++; return 'Eagle Scout Service Project Workbook'; };
    expect(V.kindOf('Project Report.pdf', 50000, ocr)).toEqual({ kind: 'report', big: false });
    expect(read).toBe(0);
    expect(V.kindOf('doc2026.pdf', 900000, ocr)).toEqual({ kind: 'workbook', big: false });
    expect(read).toBe(1);
    expect(V.kindOf('doc2026.pdf', 12 * 1048576, ocr)).toEqual({ kind: '', big: true });
    expect(read).toBe(1);
  });
  it('plan: names from the new kinds; too-big files say so', () => {
    const p = V.plan([{ name: 'doc1.pdf', kind: 'application' }, { name: 'Project Report.pdf', kind: 'report' },
      { name: 'Rank Advancement.pdf', kind: 'meritbadges' }, { name: 'doc2.pdf', kind: '', big: true }],
      'Owen Patrick Fairbanks', 'T999', Intake.namePart, Intake.unitPart);
    const names = p.files.map(f => f.name.replace(/^.*_/, '_'));
    expect(names).toEqual(['_EagleApplication-Verified.pdf', '_Council-Workbook-Report.pdf', '_Council-MeritBadges.pdf', '_Council-Doc-01.pdf']);
    expect(p.toIdentify).toHaveLength(1);
    expect(p.toIdentify[0]).toMatch(/Council-Doc-01\.pdf \(too big to read automatically\)$/);
    expect(V.identifyNames(p.toIdentify.join('; '))).toHaveLength(1);
  });
});
