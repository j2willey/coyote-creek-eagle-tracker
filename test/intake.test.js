import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Intake = require('../apps-script/src/lib/intake.js');

const NOW = new Date(2026, 9, 12, 9, 30);
const good = {
  scout_name: 'Scout Nine', unit_type: 'T', unit_number: '109', birth_date: '2009-03-04',
  scout_email: ' Pat.Tester+Scout_9@Example.com ', parent_email: 'pat.tester+Parent_9@example.com',
  proj_title: 'Benches for the creek trail', beneficiary: 'Fake Park District'
};

describe('Intake.validate', () => {
  it('accepts a complete submission and normalizes it', () => {
    const v = Intake.validate(good, NOW);
    expect(v.ok).toBe(true);
    expect(v.clean.scout_email).toBe('pat.tester+scout_9@example.com');
    expect(v.clean.birth_date).toBe('2009-03-04');
    expect(v.clean.bsa_id).toBe('');
    expect(v.clean.unit).toBe('T109');
  });

  it('needs a unit type and number; writes T/C/S + number', () => {
    expect(Intake.validate({ ...good, unit_type: 'C', unit_number: '0910' }, NOW).clean.unit).toBe('C910');
    expect(Intake.validate({ ...good, unit_type: '', unit_number: '910' }, NOW).ok).toBe(false);
    expect(Intake.validate({ ...good, unit_type: 'T', unit_number: '' }, NOW).ok).toBe(false);
    expect(Intake.validate({ ...good, unit_type: 'X', unit_number: '910' }, NOW).ok).toBe(false);
  });

  it('parses the ways units are written', () => {
    for (const [txt, want] of [['T910', 'T910'], ['T 910', 'T910'], ['Troop 910', 'T910'], ['C910', 'C910'],
      ['Venturing Crew #910', 'C910'], ['Crew 910', 'C910'], ['Sea Scout Ship 910', 'S910'], ['Ship 7', 'S7']]) {
      const p = Intake.parseUnit(txt);
      expect(p.type + p.number, txt).toBe(want);
    }
    expect(Intake.parseUnit('910').type).toBeNull();
    expect(Intake.parseUnit('Pack 910')).toBeNull();
    expect(Intake.normUnit('Troop 910')).not.toBe(Intake.normUnit('C910'));
  });

  it('lists every missing required field', () => {
    const v = Intake.validate({}, NOW);
    expect(v.ok).toBe(false);
    expect(v.errors.map(e => e.field)).toEqual(
      ['scout_name', 'unit', 'birth_date', 'scout_email', 'parent_email', 'proj_title', 'beneficiary']);
  });

  it('rejects bad email, BSA ID, impossible or implausible birth dates', () => {
    expect(Intake.validate({ ...good, scout_email: 'nope' }, NOW).ok).toBe(false);
    expect(Intake.validate({ ...good, bsa_id: '12ab' }, NOW).ok).toBe(false);
    expect(Intake.validate({ ...good, bsa_id: '123456789' }, NOW).ok).toBe(true);
    expect(Intake.validate({ ...good, birth_date: '2009-02-30' }, NOW).ok).toBe(false);
    expect(Intake.validate({ ...good, birth_date: '2024-01-01' }, NOW).ok).toBe(false);
  });
});

describe('Intake files', () => {
  it('checks type, tag and size', () => {
    expect(Intake.checkFile({ name: 'p.PDF', tag: 'ESSPP', bytes: 1000 }, 20)).toBe('');
    expect(Intake.checkFile({ name: 'p.exe', tag: 'ESSPP', bytes: 1000 }, 20)).toMatch(/not accepted/);
    expect(Intake.checkFile({ name: 'p.pdf', tag: 'Junk', bytes: 1000 }, 20)).toMatch(/Pick/);
    expect(Intake.checkFile({ name: 'p.pdf', tag: 'ESSPP', bytes: 21 * 1024 * 1024 }, 20)).toMatch(/20 MB/);
    expect(Intake.checkFile({ name: 'p.pdf', tag: 'ESSPP', bytes: 0 }, 20)).toMatch(/empty/);
  });

  it('builds the standard name', () => {
    expect(Intake.standardName("Mary-Jane O'Neil", 'T 101', 'ESSPP', 1, 'scan 3.pdf')).toBe('Mary-Jane_ONeil-T101_ESSPP-V1.pdf');
    expect(Intake.standardName('Scout Nine', 'Troop 109', 'Photo', 2, 'IMG_1.HEIC')).toBe('Scout_Nine-Troop109_Photo-V2.heic');
    expect(Intake.folderName('Scout Nine', 'T109')).toBe('Scout Nine - T109');
    expect(Intake.folderName('A/B', 'T1')).toBe('A-B - T1');
  });

  it('names files waiting in the queue folder', () => {
    expect(Intake.queueFileName('Q-1', 'Scout Nine', 'T 109', 'ESSPP', 'my proposal.pdf'))
      .toBe('Q-1_Scout_Nine-T109_ESSPP_my proposal.pdf');
    expect(Intake.queueFileName('Q-1', 'A', 'T1', 'Photo', 'a/b.jpg')).toBe('Q-1_A-T1_Photo_a-b.jpg');
  });

  it('counts versions per file type', () => {
    expect(Intake.assignVersions([], ['ESSPP', 'Photo', 'Photo'])).toEqual([1, 1, 2]);
    expect(Intake.assignVersions([{ tag: 'ESSPP', version: 2 }, { tag: 'Slides', version: 1 }], ['ESSPP', 'Slides'])).toEqual([3, 2]);
  });
});

describe('Intake.duplicateCheck', () => {
  const cand = { queueId: 'Q-1', scout_name: 'Scout Nine', unit: 'Troop 109', birth_date: '2009-03-04', scout_email: 'a@x.org', bsa_id: '1234567' };

  it('exact on Scout email or BSA ID', () => {
    expect(Intake.duplicateCheck(cand, [{ recordId: 'R-1', scout_email: 'A@x.org' }], []).exact).toEqual(['R-1']);
    expect(Intake.duplicateCheck(cand, [{ recordId: 'R-2', bsa_id: 1234567 }], []).exact).toEqual(['R-2']);
  });

  it('close on name + unit + birth date, with unit spelling and Date cells', () => {
    const r = { recordId: 'R-3', scout_name: 'scout  nine', unit: 'T 109', birth_date: new Date(2009, 2, 4), scout_email: 'b@x.org' };
    const out = Intake.duplicateCheck(cand, [r], []);
    expect(out.exact).toEqual([]);
    expect(out.close).toEqual(['R-3']);
  });

  it('close on first + last name and unit when the record has no birth date (old-system rows)', () => {
    const c = { ...cand, scout_name: 'Owen Patrick Fairbanks', unit: 'T808', scout_email: 'new@x.org', bsa_id: '' };
    expect(Intake.duplicateCheck(c, [{ recordId: 'R-5', scout_name: 'Owen Fairbanks', unit: 'Troop 808' }], []).close).toEqual(['R-5']);
    expect(Intake.duplicateCheck(c, [{ recordId: 'R-6', scout_name: 'Owen Fairbanks', unit: 'T808', birth_date: '2001-01-01' }], []).close).toEqual([]);
    expect(Intake.duplicateCheck(c, [{ recordId: 'R-7', scout_name: 'Owen Fairbanks', unit: 'C808' }], []).close).toEqual([]);
    expect(Intake.duplicateCheck(c, [{ recordId: 'R-8', scout_name: 'Anil Fairbanks', unit: 'T808' }], []).close).toEqual([]);
    // Same name, both BSA IDs known and different: two Scouts.
    expect(Intake.duplicateCheck({ ...c, bsa_id: '111' }, [{ recordId: 'R-9', scout_name: 'Owen Fairbanks', unit: 'T808', bsa_id: '222' }], []).close).toEqual([]);
  });

  it('blank BSA IDs never match each other', () => {
    expect(Intake.duplicateCheck({ ...cand, bsa_id: '' }, [{ recordId: 'R-4', bsa_id: '' }], []).exact).toEqual([]);
  });

  it('only counts confirmed queue entries, never itself', () => {
    const q = [
      { queueId: 'Q-1', status: 'Confirmed', scout_email: 'a@x.org' },
      { queueId: 'Q-2', status: 'Unconfirmed', scout_email: 'a@x.org' },
      { queueId: 'Q-3', status: 'Promoted', scout_email: 'a@x.org' }
    ];
    expect(Intake.duplicateCheck(cand, [], q).exact).toEqual(['Q-3']);
  });
});

describe('Intake misc', () => {
  it('makes unique Queue IDs', () => {
    const id = Intake.makeQueueId(() => 0, [], NOW);
    expect(id).toBe('Q-2610120930-AAA');
    expect(Intake.makeQueueId(() => 0.5, [id], NOW)).not.toBe(id);
  });

  it('purges only unfinished entries past the cutoff', () => {
    const old = new Date(NOW.getTime() - 15 * 864e5);
    const rows = [
      { status: 'Unconfirmed', submitted: old },
      { status: 'Uploading', submitted: old },
      { status: 'Promoted', submitted: old },
      { status: 'Unconfirmed', submitted: NOW }
    ];
    expect(Intake.purgeIndexes(rows, NOW.getTime(), 14)).toEqual([0, 1]);
  });

  it('emails carry the link', () => {
    const url = Intake.confirmUrl('https://x.web.app/', 'abc');
    expect(url).toBe('https://x.web.app/confirm?c=abc');
    expect(Intake.confirmEmail('Scout Nine', url, 7).body).toContain(url);
    expect(Intake.receiptEmail('Scout Nine', ['A.pdf'], 'https://x/signin').body).toContain('A.pdf');
  });
  it('receipt lists what was entered', () => {
    const b = Intake.receiptEmail('Scout Nine', ['A.pdf'], 'https://x/signin',
      { scout_name: 'Scout Nine', unit: 'T999', birth_date: '2009-03-07', scout_email: 's@x.org' }).body;
    expect(b).toContain('Scout name: Scout Nine');
    expect(b).toContain('Birth date: 3/7/2009');
    expect(b).toContain('BSA ID: (not given)');
  });
});

describe('parent/guardian email (2026-11-08)', () => {
  const I = require('../apps-script/src/lib/intake.js');
  const now = new Date(2026, 10, 8);
  const ok = { scout_name: 'Theodore Sample', unit_type: 'T', unit_number: '999', birth_date: '2010-01-15', scout_email: 'teddy@example.org',
    parent_email: 'pat.parent@example.org', proj_title: 'Benches', beneficiary: 'Riverbend Park' };
  it('first-time form: required, and not the Scout\'s own address', () => {
    expect(I.validate(ok, now).ok).toBe(true);
    expect(I.validate({ ...ok, parent_email: '' }, now).errors.map(e => e.field)).toEqual(['parent_email']);
    expect(I.validate({ ...ok, parent_email: 'Teddy@Example.org' }, now).errors[0]).toMatchObject({ field: 'parent_email', message: /not the Scout's own/ });
  });
  it('needsParent: blank, or only the Scout\'s address(es)', () => {
    expect(I.needsParent({ scout_email: 'a@x.org', parent_email: '' })).toBe(true);
    expect(I.needsParent({ scout_email: 'a@x.org', parent_email: 'A@x.org' })).toBe(true);
    expect(I.needsParent({ scout_email: 'a@x.org, b@x.org', parent_email: 'b@x.org' })).toBe(true);
    expect(I.needsParent({ scout_email: 'a@x.org', parent_email: 'a@x.org; p@x.org' })).toBe(false);
    expect(I.needsParent({ scout_email: 'a@x.org', parent_email: 'p@x.org' })).toBe(false);
  });
  it('an update that only changes other fields is not blocked by the parent rule', () => {
    expect(I.validate({ beneficiary: 'Riverbend Parks' }, now, ['beneficiary']).ok).toBe(true);
  });
});
