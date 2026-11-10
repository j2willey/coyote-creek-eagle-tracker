import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../apps-script/src/lib/councilApp.js');
const Intake = require('../apps-script/src/lib/intake.js');
const Units = require('../apps-script/src/lib/units.js');

// Shape of the real Formsite email (test submission "NotA Scout", 2026-11-03), personal details replaced.
const html = fs.readFileSync(path.resolve(__dirname, 'fixtures/formsite-eagle-application.html'), 'utf8');
const ATT = ['f-1608-25-12345678_boxQLzGb_Avatar.jpg', 'f-1608-26-12345678_KM3uZ0Gm_Avatar.jpg',
  'f-1608-63-12345678_1K5WwADP_Avatar.jpg', 'f-1608-15-12345678_I7O0Zeo6_Background.jpg'];

describe('Council application emails (Formsite)', () => {
  it('trigger: Formsite sender + subject prefix only', () => {
    expect(C.isMatch('eagles at svmbc.org <noreply@fs10.formsite.com>', 'Eagle Project Result: NotA Scout')).toBe(true);
    expect(C.isMatch('council-account@council.example.org', 'Eagle Project Result: NotA Scout')).toBe(false);   // a forward
    expect(C.isMatch('noreply@fs10.formsite.com', 'Fwd: Eagle Project Result: NotA Scout')).toBe(false);
    expect(C.isMatch('noreply@fs10.formsite.com', 'Proposal Result: X')).toBe(false);
  });
  const p = C.parse(html);
  it('reads the answers and which question each file was uploaded for', () => {
    expect(p).toMatchObject({ ref: '12345678', first: 'NotA', middle: 'Real', last: 'Scout', certName: 'NotA Scout', unit: 'T9999',
      scoutEmail: 'scout.test@example.org', parentEmail: 'parent.test@example.org', projectName: 'World Peas' });
    expect(p.uploads.map(u => [u.kind, u.files.length])).toEqual([['application', 1], ['workbook', 1], ['statement', 1], ['project', 1]]);
    expect(p.values['Summary of Project']).toBe('Chocolate Peas for the World');
    expect(C.fieldOf(ATT[0])).toBe(25);
    expect(C.originalName(ATT[3])).toBe('Background.jpg');
  });
  it('names the files our way', () => {
    const pl = C.plan(p, ATT, 'NotA Real Scout', 'T9999', Intake.namePart, Intake.unitPart);
    expect(pl.files.map(f => f.name)).toEqual(['NotA_Real_Scout-T9999-Application_RankApplication.jpg', 'NotA_Real_Scout-T9999-Application_Workbook.jpg',
      'NotA_Real_Scout-T9999-Application_Statement.jpg', 'NotA_Real_Scout-T9999-Application_ProjectPhoto-01.jpg']);
    expect(pl.missing).toEqual([]);
    expect(pl.emailName).toBe('NotA_Real_Scout-T9999-Application_FormsiteEmail.pdf');
    // sorts apart from the Proposal files of the same Scout
    expect(['NotA_Real_Scout-T9999_ESSPP-V2.pdf', pl.emailName, pl.files[1].name].sort()[2]).toBe('NotA_Real_Scout-T9999_ESSPP-V2.pdf');
    pl.files.concat([{ name: pl.emailName }]).forEach(f => expect(C.isSubmittedName(f.name), f.name).toBe(true));
  });
  it('several photos, a file linked but not attached, an attachment no question names', () => {
    const q = { uploads: [{ label: 'Project Pictures', kind: 'project', files: ['f-1-15-9_a_1.jpg', 'f-1-15-9_b_2.JPG'] },
      { label: 'Eagle Applicant Workbook', kind: 'workbook', files: ['f-1-26-9_c_big.pdf'] }] };
    const pl = C.plan(q, ['f-1-15-9_a_1.jpg', 'f-1-15-9_b_2.JPG', 'f-1-63-9_d_stmt.pdf'], 'A B', 'C917', Intake.namePart, Intake.unitPart);
    expect(pl.files.map(f => f.name)).toEqual(['A_B-C917-Application_ProjectPhoto-01.jpg', 'A_B-C917-Application_ProjectPhoto-02.jpg', 'A_B-C917-Application_Statement.pdf']);
    expect(pl.missing).toEqual(['Eagle Applicant Workbook: big.pdf']);
  });
  it('files linked instead of attached are planned for fetching, named our way', () => {
    // Formsite sends links (no attachments) when the files are big: every upload comes from its link.
    const pl = C.plan(p, [], 'NotA Real Scout', 'T9999', Intake.namePart, Intake.unitPart);
    expect(pl.files).toEqual([]);
    expect(pl.missing).toEqual([]);
    expect(pl.links.map(l => l.name)).toEqual(['NotA_Real_Scout-T9999-Application_RankApplication.jpg', 'NotA_Real_Scout-T9999-Application_Workbook.jpg',
      'NotA_Real_Scout-T9999-Application_Statement.jpg', 'NotA_Real_Scout-T9999-Application_ProjectPhoto-01.jpg']);
    expect(pl.links[0].url).toBe('https://fs10.formsite.com/svmbc/files/f-1608-25-12345678_boxQLzGb_Avatar.jpg');
    expect(pl.links[3]).toMatchObject({ kind: 'project', label: 'Project Pictures', original: 'Background.jpg' });
    // mixed: attached ones from the email, the rest from links, numbering shared
    const some = C.plan(p, [ATT[3]], 'NotA Real Scout', 'T9999', Intake.namePart, Intake.unitPart);
    expect(some.files.map(f => f.name)).toEqual(['NotA_Real_Scout-T9999-Application_ProjectPhoto-01.jpg']);
    expect(some.links.length).toBe(3);
  });
  it('a fetched link counts only when it is the file, not a web page', () => {
    expect(C.fetchProblem(200, 'application/pdf', 1000)).toBe('');
    expect(C.fetchProblem(200, 'text/html; charset=UTF-8', 1000)).toMatch(/web page/);
    expect(C.fetchProblem(403, 'text/html', 10)).toMatch(/403/);
    expect(C.fetchProblem(200, 'image/jpeg', 0)).toMatch(/empty/);
  });
  it('graded matching: close = first + last name in the unit; anything looser = check', () => {
    const R = (id, scout_name, unit, extra = {}) => ({ recordId: id, scout_name, unit, ...extra });
    const m = (recs, q = p) => C.matchRecord(recs, q, Units.code);
    // middle name on the sheet or not: still close; a second unit in the cell counts
    expect(m([R('R1', 'NotA Real Scout', 'T9999')])).toMatchObject({ recordId: 'R1', close: true });
    expect(m([R('R1', 'Nota Scout', 'C967 T9999')])).toMatchObject({ recordId: 'R1', close: true });
    // nickname: same last name in the unit -> check
    expect(m([R('R1', 'Notty Scout', 'T9999'), R('R2', 'Other Kid', 'T9999')])).toMatchObject({ recordId: 'R1', close: false, how: 'same last name + unit' });
    // two-part surname entered differently: same first name in the unit -> check
    expect(m([R('R1', 'NotA Scout-Smith', 'T9999')])).toMatchObject({ recordId: 'R1', close: false });       // similar name
    expect(m([R('R1', 'NotA Quillfeather', 'T9999')])).toMatchObject({ recordId: 'R1', close: false, how: 'same first name + unit' });
    // wrong unit on the form: the Scout's email -> check
    expect(m([R('R1', 'Totally Different', 'T41', { scout_email: 'Scout.Test@example.org' })])).toMatchObject({ recordId: 'R1', close: false, how: "the Scout's email" });
    // parent email only counts with the same last name (siblings!)
    expect(m([R('R1', 'Sibling Scout', 'T41', { parent_email: 'parent.test@example.org' })])).toMatchObject({ recordId: 'R1', how: "the parent's email + last name" });
    expect(m([R('R1', 'Sibling Other', 'T41', { parent_email: 'parent.test@example.org' })]).error).toBeTruthy();
    // two candidates: never guess
    expect(m([R('R1', 'Ann Scout', 'T9999'), R('R2', 'Bob Scout', 'T9999')]).error).toBeTruthy();
    expect(m([R('R2', 'NotA Scout', 'T41')]).error).toMatch(/not in unit/);
  });
  it('promote ONLY a close match in Proposal Approved; anything else stays and is flagged', () => {
    expect(C.decide({ recordId: 'R1', close: true }, 'proposal_approved')).toEqual({ match: 'Matched', promote: true });
    expect(C.decide({ recordId: 'R1', close: true }, 'app_submitted')).toEqual({ match: 'Stage?', promote: false });
    expect(C.decide({ recordId: 'R1', close: true }, 'review_booked')).toEqual({ match: 'Stage?', promote: false });
    expect(C.decide({ recordId: 'R1', close: false }, 'proposal_approved')).toEqual({ match: 'Check', promote: false });
    expect(C.decide({ error: 'x' }, '')).toEqual({ match: 'No match', promote: false });
    const l = C.toCheck([{ 'Received': new Date(2026, 10, 4), 'Ref': '5', 'Name on form': 'E F', 'Unit on form': 'T1', 'Match': 'Stage?',
      'Scout': 'E F (T1)', 'Stage': 'In-Person Review: Booked', 'Checked': false }], () => '11/4');
    expect(l[0].why).toBe('filed for E F (T1), but they are in In-Person Review: Booked (not Proposal Approved): row not moved to Application Submitted');
  });
  it('digest list: Check and No match rows until Checked, oldest first', () => {
    const rows = [
      { 'Received': new Date(2026, 10, 4), 'Ref': '2', 'Name on form': 'Jane Doe', 'Unit on form': 'T41', 'Match': 'Check', 'Scout': 'Janet Doe (T41)', 'How': 'same last name + unit', 'Checked': false },
      { 'Received': new Date(2026, 10, 3), 'Ref': '1', 'Name on form': 'NotA Real Scout', 'Unit on form': 'T9999', 'Match': 'No match', 'Folder': 'https://drive/x', 'Checked': '' },
      { 'Received': new Date(2026, 10, 3), 'Ref': '3', 'Name on form': 'A B', 'Match': 'Matched', 'Checked': true },
      { 'Received': new Date(2026, 10, 2), 'Ref': '4', 'Name on form': 'C D', 'Match': 'Check', 'Checked': true }];
    const l = C.toCheck(rows, d => (d.getMonth() + 1) + '/' + d.getDate());
    expect(l.map(x => x.title)).toEqual(['NotA Real Scout (T9999), #1, 11/3', 'Jane Doe (T41), #2, 11/4']);
    expect(l[0].why).toBe('no matching Scout: files in https://drive/x');
    expect(l[1].why).toBe('filed for Janet Doe (T41) by same last name + unit: is that right? (row not moved)');
    expect(C.HEADERS).toContain('Checked');
  });
  it('nothing moves but an earlier submission (to Archive/)', () => {
    const top = [{ id: 'log', name: 'Life to Eagle Log' }, { id: 'p1', name: 'X-T1_ESSPP-V2.pdf' },
      { id: 's1', name: 'X-T1_ESSPP-ApprovedAndSignedBy-JW.pdf' }, { id: 'e1', name: 'X-T1_EagleApplication-Signed.pdf' },
      { id: 'old', name: 'X-T1-Application_Workbook.pdf' }, { id: 'old2', name: 'X-T1-Application_ProjectPhoto-03.jpg' }];
    expect(C.toArchive(top)).toEqual(['old', 'old2']);
  });
  it('email body for the PDF: no images, no IP/browser rows', () => {
    const out = C.emailHtml(html, 'Council Eagle application (Formsite #12345678)');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/0\.0\.0\.0|formLoginNew/);
    expect(out).toMatch(/World Peas/);
    expect(out).toMatch(/Avatar\.jpg \(113 KB\)/);
  });
});

describe('dashboard Formsite tag', () => {
  it('Check / Stage? rows not Checked, by Record ID; No match and Matched never tag a row', () => {
    const rows = [
      { 'Received': new Date(2026, 10, 4), 'Ref': '1', 'Match': 'Stage?', 'Scout': 'A B (T1)', 'Stage': 'In-Person Review: Booked', 'Record ID': 'R1', 'Folder': 'https://f/1', 'Checked': false },
      { 'Received': new Date(2026, 10, 4), 'Ref': '2', 'Match': 'Check', 'Scout': 'C D (T2)', 'How': 'same last name + unit', 'Record ID': 'R2', 'Checked': true },
      { 'Received': new Date(2026, 10, 4), 'Ref': '3', 'Match': 'Matched', 'Record ID': 'R3', 'Checked': true },
      { 'Received': new Date(2026, 10, 4), 'Ref': '4', 'Match': 'No match', 'Checked': false }];
    const f = C.flags(rows, () => '11/4');
    expect(Object.keys(f)).toEqual(['R1']);
    expect(f.R1).toEqual({ folder: 'https://f/1',
      why: 'Formsite application 11/4: filed for A B (T1), but they are in In-Person Review: Booked (not Proposal Approved): row not moved to Application Submitted' });
  });
  it('the dashboard row carries it', () => {
    const B = require('../apps-script/src/lib/board.js');
    const t = B.build([{ recordId: 'R1', section: 'review_booked', scout_name: 'A B', formsite: { why: 'x', folder: 'f' } },
      { recordId: 'R2', section: 'review_booked', scout_name: 'C D' }], [], '2026-11-04');
    const rows = t.find(x => x.key === 'proposals').groups.find(g => g.key === 'review_booked').rows;
    expect(rows.map(r => r.formsite)).toEqual([{ why: 'x', folder: 'f' }, null]);
  });
});
