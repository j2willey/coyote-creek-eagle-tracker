import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../apps-script/src/lib/eborPaperwork.js');
const EagleDone = require('../apps-script/src/lib/eagleDone.js');
const Intake = require('../apps-script/src/lib/intake.js');

// Fictional people only (Theodore "Teddy" Sample, Owen Patrick Fairbanks, T999 ...).
describe('EborPaperwork: dates', () => {
  it('Requirement 7 boxes: MM, DD, YY', () => {
    expect(P.mmddyy('2026-03-07')).toEqual({ mm: '03', dd: '07', yy: '26', text: '03/07/26' });
    expect(P.mmddyy('2031-12-31').yy).toBe('31');
    expect(P.mmddyy('2100-01-02').yy).toBe('00');
  });
  it('the Advancement Report dates keep a four-digit year', () => {
    expect(P.reportDate('2026-03-07')).toBe('03/07/2026');
  });
  it('refuses something that is not a date', () => {
    expect(P.mmddyy('2026-02-30')).toBeNull();
    expect(P.mmddyy('3/7/2026')).toBeNull();
    expect(P.reportDate('')).toBe('');
  });
});

describe('EborPaperwork: Advancement Report fields', () => {
  const base = { scout: 'Theodore Sample', unit: 'T999', district: 'Coyote Creek', title: 'Coyote Creek Advancement', leaderName: 'Pat Q Leader',
    address: '12 Elm St', city: 'Springfield', state: 'CA', zip: '95000', boardYmd: '2026-03-07' };
  it('fills the named fields, every date = the EBoR date (Date Award Earned as MM/DD/YY)', () => {
    const r = P.reportFields(base);
    expect(r.problems).toEqual([]);
    expect(r.text).toEqual({
      'No': '999', 'District': 'Coyote Creek', 'Leader': 'Pat Q Leader', 'Address': '12 Elm St', 'City': 'Springfield', 'State': 'CA', 'Zip': '95000',
      'Date this report forwarded to council service center': '03/07/2026', 'Title': 'Coyote Creek Advancement', 'Board of Review Date': '03/07/2026',
      '#1': 'Theodore Sample', 'Date Award Earned1': '03/07/26', 'Badge of Rank Merit Badge or Award1': 'Eagle Scout'
    });
  });
  it('picks the unit type widget by position: Pack, Troop, Crew, Ship', () => {
    expect(P.reportFields(base).radio).toEqual({ group: 'Group16', index: 1 });
    expect(P.reportFields({ ...base, unit: 'C917' }).radio.index).toBe(2);
    expect(P.reportFields({ ...base, unit: 'Ship 5' }).radio.index).toBe(3);
    expect(P.reportFields({ ...base, unit: 'P12' }).radio.index).toBe(0);
    expect(P.unitParts('t 0999')).toMatchObject({ letter: 'T', number: '999', type: 'Troop' });
  });
  it('leaves the address out when unknown, and says what is missing', () => {
    const r = P.reportFields({ ...base, leaderName: '', address: '', city: '', state: '', zip: '' });
    expect(Object.keys(r.text)).not.toContain('Address');
    expect(Object.keys(r.text)).not.toContain('Leader');
    expect(r.problems.join(' ')).toMatch(/No Unit Leader/);
  });
  it('flags a bad unit or date', () => {
    const r = P.reportFields({ ...base, unit: 'Den 4', boardYmd: '' });
    expect(r.radio).toBeNull();
    expect(r.problems.join(' ')).toMatch(/EBoR date.*not a Pack, Troop/s);
  });
});

describe('EborPaperwork: signer rules', () => {
  const s = (name, rep = false, signed = true) => ({ name, rep, signed });
  it('has two slots on the application and three on the Advancement Report', () => {
    expect(P.signerSlots('application').map(x => x.key)).toEqual(['chair', 'rep']);
    expect(P.signerSlots('report').map(x => x.key)).toEqual(['Signature1', 'Signature2', 'Signature3']);
    expect(P.signerSlots('report')[0].rep).toBe(true);
  });
  it('accepts one council / district representative and others any adult', () => {
    const r = P.checkSigners('report', [s('Owen Patrick Fairbanks', true), s('Pat Q'), s('Jordan Example')]);
    expect(r.ok).toBe(true);
    expect(r.clean).toEqual([{ key: 'Signature1', name: 'Owen Patrick Fairbanks', rep: true }, { key: 'Signature2', name: 'Pat Q', rep: false }, { key: 'Signature3', name: 'Jordan Example', rep: false }]);
  });
  it('needs at least one representative', () => {
    const r = P.checkSigners('application', [s('Pat Q'), s('Jordan Example')]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/tick "District Advancement Committee \/ Council representative"/);
  });
  it('two representatives are fine (a district person and a council person)', () => {
    expect(P.checkSigners('application', [s('Pat Q', true), s('Jordan Example', true)]).ok).toBe(true);
  });
  it('needs every name, every signature and the right count; one person cannot sign twice', () => {
    expect(P.checkSigners('application', [s(''), s('Jordan Example', true)]).errors.join(' ')).toMatch(/type the signer's name/);
    expect(P.checkSigners('application', [s('Pat Q', true, false), s('Jordan Example')]).errors.join(' ')).toMatch(/signature is missing/);
    expect(P.checkSigners('report', [s('Pat Q', true), s('Jordan Example')]).errors.join(' ')).toMatch(/needs 3 signatures/);
    expect(P.checkSigners('application', [s('Pat Q', true), s(' pat  q ')]).errors.join(' ')).toMatch(/two signature lines/);
    expect(P.checkSigners('nope', []).ok).toBe(false);
  });
});

describe('EborPaperwork: files in the Scout folder', () => {
  const f = (id, name, modified, mime = 'application/pdf') => ({ id, name, mime, modified });
  it('picks the newest PDF with "verified" in its name, any case', () => {
    const files = [
      f('a', 'Verified Eagle Application.pdf', 100),
      f('b', 'EAGLE APPLICATION VERIFIED 2.pdf', 300),
      f('c', 'verified notes.txt', 900, 'text/plain'),
      f('d', 'Sample_T999_ESSPP-V2.pdf', 800)
    ];
    expect(P.pickVerified(files).id).toBe('b');
  });
  it('is null when there is none, and never takes our own signed output', () => {
    expect(P.pickVerified([f('d', 'Sample_T999_ESSPP-V2.pdf', 800)])).toBeNull();
    expect(P.pickVerified([f('e', 'Verified-Teddy_Sample-T999_EagleApplication-Signed.pdf', 9)])).toBeNull();
    expect(P.pickVerified([])).toBeNull();
  });
  it('lists the PDFs for the picker, verified ones first', () => {
    const l = P.pdfChoices([f('d', 'Other.pdf', 800), f('a', 'verified.pdf', 100), f('p', 'photo.jpg', 5, 'image/jpeg'), f('b', 'Verified 2.pdf', 300)]);
    expect(l.map(x => x.id)).toEqual(['b', 'a', 'd']);
    expect(l.map(x => x.verified)).toEqual([true, true, false]);
  });
  it('archives the Verified Application used and earlier versions of the two outputs, nothing else', () => {
    const names = EagleDone.fileNames('Theodore Sample', 'T999', '2026-03-07', Intake.namePart, Intake.unitPart);
    const top = [
      { id: 'v', name: 'Verified Eagle Application.pdf' }, { id: 'v2', name: 'Another Verified.pdf' },
      { id: 'old1', name: names.application }, { id: 'old2', name: names.report.toUpperCase() },
      { id: 'new1', name: names.application }, { id: 'new2', name: names.report },
      { id: 'esspp', name: 'Theodore_Sample-T999_ESSPP-ApprovedAndSignedBy-AB.pdf' }
    ];
    expect(P.archivePlan(top, ['new1', 'new2'], names, 'v').sort()).toEqual(['old1', 'old2', 'v']);
    expect(P.archivePlan(top, ['new1', 'new2'], names, '').sort()).toEqual(['old1', 'old2']);   // Verified came from the computer
  });
});

describe('EborPaperwork: the Scout dropdown', () => {
  const day = (y, m, d) => new Date(y, m - 1, d);
  const rows = [
    { record_id: 'R-1', slot_type: 'EBoR', date: day(2026, 3, 14), time: '7:00 PM', reps: 'AB, CD', board_members: 'Pat Q, pat@example.org' },
    { record_id: 'R-1', slot_type: 'EBoR', date: day(2026, 1, 10), time: '7:00 PM', reps: 'EF' },
    { record_id: 'R-2', slot_type: 'EBoR', date: day(2026, 2, 1), time: '7:00 PM', reps: 'AB' },
    { record_id: 'R-3', slot_type: 'EBoR', date: day(2026, 1, 5), time: '6:00 PM', reps: '' },
    { record_id: 'R-4', slot_type: 'Intake', date: day(2026, 3, 1), time: '6:00 PM', reps: '' }
  ];
  it('takes the earliest EBoR on or after today, else the latest before it', () => {
    expect(P.boardFor(rows, 'R-1', '2026-02-01')).toMatchObject({ ymd: '2026-03-14', upcoming: true, reps: ['AB', 'CD'], boardMembers: 'Pat Q, pat@example.org' });
    expect(P.boardFor(rows, 'R-1', '2026-03-14').ymd).toBe('2026-03-14');           // tonight still counts
    expect(P.boardFor(rows, 'R-1', '2026-04-01')).toMatchObject({ ymd: '2026-03-14', upcoming: false });
    expect(P.boardFor(rows, 'R-4', '2026-02-01')).toBeNull();                         // not an EBoR
    expect(P.boardFor(rows, 'R-9', '2026-02-01')).toBeNull();
  });
  it('lists EBoR Booked and Paused Scouts, soonest board first, and preselects an upcoming one', () => {
    const recs = [
      { recordId: 'R-1', section: 'ebor_booked', name: 'Teddy Sample', unit: 'T999' },
      { recordId: 'R-2', section: 'ebor_paused', name: 'Owen Fairbanks', unit: 'C917' },
      { recordId: 'R-3', section: 'ebor_booked', name: 'Scout One', unit: 'S5' },
      { recordId: 'R-5', section: 'ebor_booked', name: 'Scout Five', unit: 'T1' },
      { recordId: 'R-6', section: 'eagle_earned', name: 'Done', unit: 'T2' }
    ];
    const boards = {};
    recs.forEach(r => { boards[r.recordId] = P.boardFor(rows, r.recordId, '2026-02-02'); });
    const ch = P.choices(recs, boards, k => k);
    expect(ch.scouts.map(x => x.recordId)).toEqual(['R-1', 'R-2', 'R-3', 'R-5']);   // R-1 upcoming; R-2, R-3 past (latest first); R-5 none
    expect(ch.selected).toBe('R-1');
    expect(P.choices(recs.slice(1, 3), { 'R-2': boards['R-2'], 'R-3': boards['R-3'] }, k => k).selected).toBe('');
  });
});

describe('EborPaperwork: log line', () => {
  it('names the signers and what was filed', () => {
    const line = P.logLine('3/7', 'AB', '2026-03-07', { application: [{ name: 'Pat Q', rep: true }, { name: 'Jordan Example', rep: false }], report: [{ name: 'Pat Q', rep: true }] },
      ['A.pdf', 'R.pdf'], 2, true);
    expect(line).toMatch(/^3\/7 \[AB\] EBoR paperwork signed in the browser \(board 03\/07\/26\)/);
    expect(line).toMatch(/Requirement 7: Pat Q \(DAC\/Council\), Jordan Example\./);
    expect(line).toMatch(/Filed A\.pdf and R\.pdf; 2 earlier file\(s\) to Archive; Council email drafted in the Outbox\./);
  });
});

describe('EborPaperwork: the Demo Scout', () => {
  it('is the first dropdown entry, flagged, and does not change which real Scout is preselected', () => {
    const ch = P.withDemo({ scouts: [{ recordId: 'R-1', name: 'A', unit: 'T1' }], selected: 'R-1' }, '2026-11-11');
    expect(ch.scouts.map(s => s.recordId)).toEqual(['DEMO', 'R-1']);
    expect(ch.scouts[0]).toMatchObject({ demo: true, boardYmd: '2026-11-11', unit: 'T999' });
    expect(ch.scouts[0].label).toMatch(/Demo Scout \(test: no email to Council\)/);
    expect(ch.selected).toBe('R-1');
    expect(P.withDemo(undefined, '2026-11-11').scouts).toHaveLength(1);
    expect(P.isDemo('DEMO')).toBe(true);
    expect(P.isDemo('R-1')).toBe(false);
    expect(P.isDemo('')).toBe(false);
  });
  it('is fictional: Report fill uses the demo leader and address, unit T999 is a Troop', () => {
    const fill = P.reportFields(P.demoReportInput('2026-11-11', 'Coyote Creek', 'Coyote Creek Advancement'));
    expect(fill.problems).toEqual([]);
    expect(fill.text).toMatchObject({ '#1': 'Theodore "Teddy" Sample', No: '999', Leader: 'Pat Q Leader', Address: '1 Example Way', City: 'San Jose', State: 'CA', Zip: '95100' });
    expect(fill.radio).toEqual({ group: 'Group16', index: 1 });
  });
  it('folder path is <year>/Demo Scout - T999 (test)', () => {
    expect(P.demoFolderPath('2026-11-11')).toEqual(['2026', 'Demo Scout - T999 (test)']);
  });
  it('Reset demo moves only the signed files; signedIn reads the same names', () => {
    const top = [{ id: 'a', name: 'Theodore_Teddy_Sample-T999_EagleApplication-Signed.pdf' }, { id: 'r', name: 'x-T999_AdvancementReport-Signed.PDF' },
      { id: 'v', name: 'Verified Eagle Application (demo).pdf' }, { id: 'n', name: 'notes.txt' }];
    expect(P.demoResetPlan(top)).toEqual(['a', 'r']);
    expect(P.signedIn(top)).toEqual({ application: true, report: true });
    expect(P.signedIn([top[2]])).toEqual({ application: false, report: false });
  });
  it('the demo email goes To the member only, no Cc or Bcc, whatever the original addressed', () => {
    const out = P.demoEmail({ to: ['council@example.org'], cc: 'group@example.org, leader@example.org', bcc: 'x@example.org', kind: 'x',
      subject: 'Eagle paperwork', body: 'Hello Council', htmlBody: '<p>Hello Council</p>' }, 'ab@example.org');
    expect(out.to).toEqual(['ab@example.org']);
    expect(out.cc).toBe('');
    expect(out.bcc).toBe('');
    expect(out.subject).toBe('[DEMO] Eagle paperwork');
    expect(out.body).toMatch(/^\[DEMO\] A test run/);
    expect(out.body).toMatch(/Hello Council$/);
    expect(out.htmlBody).toMatch(/Hello Council/);
    expect(P.demoEmail({ subject: '[DEMO] Again', body: '' }, 'ab@example.org').subject).toBe('[DEMO] Again');
    expect(P.demoActivity('AB')).toBe('EBoR paperwork demo run by AB');
  });
});
