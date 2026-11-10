import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FolderMatch = require('../apps-script/src/lib/folderMatch.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');

// All names fake; the quirks mirror what real folders look like.
describe('FolderMatch.parseFolderName', () => {
  it('reads the convention and its drift', () => {
    expect(FolderMatch.parseFolderName('Scout Nine - T109')).toEqual({ name: 'Scout Nine', unit: 'T109' });
    expect(FolderMatch.parseFolderName('Scout Nine - T-2163')).toEqual({ name: 'Scout Nine', unit: 'T-2163' });
    expect(FolderMatch.parseFolderName('Scout Nine-C917')).toEqual({ name: 'Scout Nine', unit: 'C917' });
    expect(FolderMatch.parseFolderName('Scout Nine T109')).toEqual({ name: 'Scout Nine', unit: 'T109' });
    expect(FolderMatch.parseFolderName('Mary-Jane Fake - T5')).toEqual({ name: 'Mary-Jane Fake', unit: 'T5' });
    expect(FolderMatch.parseFolderName('Scout Nine')).toEqual({ name: 'Scout Nine', unit: '' });
    expect(FolderMatch.parseFolderName('___Scout Nine - T109').name).toBe('Scout Nine');
  });

  it('normalizes units', () => {
    expect(FolderMatch.normUnit('T-2163')).toBe('t2163');
    expect(FolderMatch.normUnit('Troop 910')).toBe('t910');
    expect(FolderMatch.normUnit('C917')).not.toBe(FolderMatch.normUnit('T917'));
  });
});

describe('FolderMatch.match', () => {
  const recs = [
    { recordId: 'R-1', scout_name: 'Alpha Fakename', unit: 'T109' },
    { recordId: 'R-2', scout_name: 'Bravo Tue-Duc Fakeson', unit: 'T917' },
    { recordId: 'R-3', scout_name: 'Charlie Fakerton', unit: 'C745' },
    { recordId: 'R-4', scout_name: 'Delta Fake', unit: 'T1' },
    { recordId: 'R-5', scout_name: 'Echo Same', unit: 'T2' },
    { recordId: 'R-6', scout_name: 'Echo Same', unit: 'T3' },
    { recordId: 'R-7', scout_name: 'Foxtrot Nofolder', unit: 'T9' }
  ];
  const folders = [
    { id: 'f1', name: 'Alpha Fakename - T109' },        // exact
    { id: 'f2', name: 'Bravo Fakeson - T-917' },        // middle name missing, unit typo'd format
    { id: 'f3', name: 'Charlie Fakertn - C745' },       // typo
    { id: 'f4', name: 'Delta Fake - T1' },
    { id: 'f5', name: 'Delta Fake (old) - T1' },        // two folders for one Scout
    { id: 'f6', name: 'Echo Same' },                    // two Scouts, no unit
    { id: 'f7', name: 'Unknown Person - T5' }
  ];
  const out = FolderMatch.match(folders, recs);
  const by = Object.fromEntries(out.folders.map(f => [f.id, f]));

  it('accepts unique best matches only', () => {
    expect(by.f1).toMatchObject({ recordId: 'R-1', kind: 'exact name' });
    expect(by.f2).toMatchObject({ recordId: 'R-2', kind: 'name words' });
    expect(by.f3).toMatchObject({ recordId: 'R-3', kind: 'name typo' });
  });

  it('leaves duplicates, ties and strangers for a person', () => {
    expect(by.f4.kind).toBe('ambiguous');
    expect(by.f5.kind).toBe('ambiguous');
    expect(by.f6.kind).toBe('ambiguous');
    expect(by.f6.candidates.sort()).toEqual(['R-5', 'R-6']);
    expect(by.f7).toMatchObject({ recordId: null, kind: 'none' });
  });

  it('lists Scouts with no folder', () => {
    expect(out.recordsWithoutFolder).toEqual(expect.arrayContaining(['R-4', 'R-5', 'R-6', 'R-7']));
    expect(out.recordsWithoutFolder).not.toContain('R-1');
  });
});

describe('Action dropdown marks the current section', () => {
  it('marks only the current section and still maps back', () => {
    const s = SettingsModel.parse([]);
    const opts = SettingsModel.actionOptionsFor(s, 'proposal_incomplete');
    const i = opts.findIndex(o => o.startsWith('●'));
    expect(opts[i]).toMatch(/Proposal Incomplete.*here now/);
    expect(opts[i + 1]).toBe('Intake Review: To Book');
    expect(SettingsModel.sectionForAction(s, opts[i])).toBe('proposal_incomplete');
  });
});
