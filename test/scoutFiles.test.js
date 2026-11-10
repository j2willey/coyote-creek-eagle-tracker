import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ScoutFiles = require('../apps-script/src/lib/scoutFiles.js');
const Intake = require('../apps-script/src/lib/intake.js');

describe('ScoutFiles names and versions', () => {
  it('parses standard names only', () => {
    expect(ScoutFiles.parseStandardName('Scout_Nine-T109_ESSPP-V12.pdf')).toEqual({ tag: 'ESSPP', version: 12 });
    expect(ScoutFiles.parseStandardName('Scout_Nine-T109_Photo-V2.heic')).toEqual({ tag: 'Photo', version: 2 });
    expect(ScoutFiles.parseStandardName('Proposal final FINAL.pdf')).toBeNull();
  });

  it('versions continue across top level and Archive', () => {
    const names = ['S-T1_ESSPP-V2.pdf', 'S-T1_ESSPP-V1.pdf', 'S-T1_Slides-V1.pptx', 'Notes'];
    const v = Intake.assignVersions(ScoutFiles.existingVersions(names), ['ESSPP', 'Photo']);
    expect(v).toEqual([3, 1]);
  });

  it('archives older files of the new tags, keeps the batch and odd names', () => {
    const top = [
      { id: 'a', name: 'S-T1_ESSPP-V1.pdf' },
      { id: 'b', name: 'S-T1_Slides-V1.pptx' },
      { id: 'c', name: 'scan.pdf' },
      { id: 'n1', name: 'S-T1_ESSPP-V2.pdf' },
      { id: 'n2', name: 'S-T1_Photo-V1.jpg' },
      { id: 'n3', name: 'S-T1_Photo-V2.jpg' }
    ];
    expect(ScoutFiles.toArchive(top, ['n1', 'n2', 'n3'])).toEqual(['a']);
  });
});

describe('ScoutFiles changes', () => {
  it('diffs only edited keys that really changed', () => {
    const cur = { beneficiary: 'Everyone', proj_title: 'World Peas', est_fundraising: 500 };
    const edits = { beneficiary: 'All and Everyone', proj_title: 'World Peas', est_fundraising: '500' };
    const d = ScoutFiles.diff(cur, edits, Intake.FIELDS);
    expect(d).toEqual([{ key: 'beneficiary', label: 'Beneficiary', from: 'Everyone', to: 'All and Everyone' }]);
  });

  it('compares sheet dates as local calendar dates', () => {
    const d = ScoutFiles.diff({ birth_date: new Date(2010, 0, 1) }, { birth_date: '2010-01-01' }, Intake.FIELDS);
    expect(d).toEqual([]);
  });

  it('builds a dated note and prepends it', () => {
    const line = ScoutFiles.noteLine('10/12', 'Update', ['S-T1_ESSPP-V2.pdf'],
      [{ label: 'Beneficiary', from: 'Everyone', to: 'All' }]);
    expect(line).toBe('10/12 [tool] Update: ESSPP-V2; Beneficiary: "Everyone" → "All"');
    expect(ScoutFiles.prependNote('old note', line)).toBe(line + '\nold note');
    expect(ScoutFiles.prependNote('', line)).toBe(line);
  });

  it('validates a subset of fields for edits', () => {
    const v = Intake.validate({ beneficiary: '', bsa_id: '12' }, new Date(), ['beneficiary', 'bsa_id']);
    expect(v.errors.map(e => e.field)).toEqual(['bsa_id', 'beneficiary']);
    expect(Intake.validate({ proj_coach: '' }, new Date(), ['proj_coach']).ok).toBe(true);
  });
});

describe('Intake duplicate check with promoted queue entries', () => {
  it('does not list a promoted queue entry whose record is already checked', () => {
    const cand = { queueId: 'Q-2', scout_email: 'a@x.org' };
    const out = Intake.duplicateCheck(cand, [{ recordId: 'R-1', scout_email: 'a@x.org' }],
      [{ queueId: 'Q-1', status: 'Promoted', scout_email: 'a@x.org', recordId: 'R-1' }]);
    expect(out.exact).toEqual(['R-1']);
  });
});

describe('Notes (M6)', () => {
  it('dates a typed note unless it already starts with a date', () => {
    expect(ScoutFiles.datedNote('called parent', '10/12')).toBe('10/12 called parent');
    expect(ScoutFiles.datedNote('10/9 left msg', '10/12')).toBe('10/9 left msg');
    expect(ScoutFiles.datedNote('  ', '10/12')).toBe('');
    expect(ScoutFiles.notesDocName('Scout Nine', 'T109')).toBe('Scout Nine - T109 - Life to Eagle Log');
  });
});

describe('ScoutFiles.restartsReview (new title on an Unapproved Proposal)', () => {
  const ScoutFiles = require('../apps-script/src/lib/scoutFiles.js');
  const title = [{ key: 'proj_title', from: 'Old bench', to: 'Library garden' }];
  it('only in Unapproved, only for a new title', () => {
    expect(ScoutFiles.restartsReview('proposal_not_approved', title)).toBe(true);
    expect(ScoutFiles.restartsReview('proposal_incomplete', title)).toBe(false);
    expect(ScoutFiles.restartsReview('proposal_not_approved', [{ key: 'beneficiary', from: 'A', to: 'B' }])).toBe(false);
    expect(ScoutFiles.restartsReview('proposal_not_approved', [{ key: 'proj_title', from: 'Old', to: '' }])).toBe(false);
    expect(ScoutFiles.restartsReview('proposal_not_approved', [])).toBe(false);
  });
});

describe('The committee request shown on the Scout page', () => {
  it('kept per section; shown only while the row is still there', () => {
    const cell = ScoutFiles.requestCell('proposal_incomplete', 'Beneficiary signature missing', '2026-10-24');
    expect(ScoutFiles.requestFor(cell, 'proposal_incomplete')).toEqual({ text: 'Beneficiary signature missing', date: '2026-10-24' });
    expect(ScoutFiles.requestFor(cell, 'intake_to_book')).toBeNull();
    expect(ScoutFiles.requestCell('proposal_incomplete', '  ', '2026-10-24')).toBe('');
    expect(ScoutFiles.requestFor('', 'proposal_incomplete')).toBeNull();
    expect(ScoutFiles.requestFor('garbage', 'proposal_incomplete')).toBeNull();
  });
  it('Scout description of updates: one line, at most 500 characters', () => {
    expect(ScoutFiles.descriptionLine('10/26', ' Added the letter.\n\nFixed the list. ')).toBe('10/26 Scout description of updates: "Added the letter. / Fixed the list."');
    expect(ScoutFiles.descriptionLine('10/26', '   ')).toBe('');
    const long = ScoutFiles.cleanDescription('x'.repeat(800));
    expect(long.length).toBe(500);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('files follow a new name / unit (2026-11-04)', () => {
  const S = require('../apps-script/src/lib/scoutFiles.js');
  it('only the tool\'s own names, prefix replaced', () => {
    const files = [{ id: 1, name: 'Owen_Fairbanks-T808_ESSPP-V1.pdf' }, { id: 2, name: 'Owen_Fairbanks-T808_ESSPP-ApprovedAndSignedBy-AB.pdf' },
      { id: 3, name: 'Owen_Fairbanks-T808-Application_Workbook.pdf' }, { id: 4, name: 'Owen_Fairbanks-T808_EBoR-20261116-01.jpg' },
      { id: 5, name: 'Proposal from 2025.pdf' }, { id: 6, name: 'Owen_Fairbanks-T8080_ESSPP-V1.pdf' }, { id: 7, name: 'Owen_Fairbanks - T808 Life to Eagle Log' }];
    expect(S.renamePlan(files, 'Owen_Fairbanks-T808', 'Owen_Patrick_Fairbanks-T808').map(p => [p.id, p.to])).toEqual([
      [1, 'Owen_Patrick_Fairbanks-T808_ESSPP-V1.pdf'], [2, 'Owen_Patrick_Fairbanks-T808_ESSPP-ApprovedAndSignedBy-AB.pdf'],
      [3, 'Owen_Patrick_Fairbanks-T808-Application_Workbook.pdf'], [4, 'Owen_Patrick_Fairbanks-T808_EBoR-20261116-01.jpg']]);
    expect(S.renamePlan(files, 'A-T1', 'A-T1')).toEqual([]);
  });
});
