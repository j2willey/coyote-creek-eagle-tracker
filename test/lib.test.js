import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
const MailPlan = require('../apps-script/src/lib/mailPlan.js');
const SheetModel = require('../apps-script/src/lib/sheetModel.js');
const MigrationPlan = require('../apps-script/src/lib/migrationPlan.js');
const SheetKind = require('../apps-script/src/lib/sheetKind.js');
const { trackingRows } = require('./fixtures.js');

function seq() { let i = 0; return () => ((i++ * 7) % 30) / 30; }

describe('SettingsModel', () => {
  it('defaults when the tab is empty, with test mode ON', () => {
    const s = SettingsModel.parse([]);
    expect(s.testMode).toBe(true);
    expect(s.sections.map(x => x.key)).toContain('intake_to_book');
    expect(s._empty).toBe(true);
  });

  it('round-trips defaultRows', () => {
    const rows = SettingsModel.defaultRows({ testRecipient: 'me@example.com' });
    const s = SettingsModel.parse(rows);
    expect(s.testRecipient).toBe('me@example.com');
    expect(s.sessionDays).toBe(14);
    expect(s.sections.length).toBe(SettingsModel.DEFAULT_SECTIONS.length);
    expect(s._empty).toBe(false);
  });

  it('treats garbage testMode as ON (fail-safe) and accepts FALSE', () => {
    expect(SettingsModel.parse([['Key', 'Value'], ['testMode', 'maybe']]).testMode).toBe(true);
    expect(SettingsModel.parse([['Key', 'Value'], ['testMode', false]]).testMode).toBe(false);
    expect(SettingsModel.parse([['Key', 'Value'], ['testMode', 'FALSE']]).testMode).toBe(false);
  });

  it('maps section key to Scout status', () => {
    const s = SettingsModel.parse([]);
    expect(SettingsModel.scoutStatusFor(s, 'intake_to_book')).toMatch(/Pre-Review/);
    expect(SettingsModel.scoutStatusFor(s, 'nope')).toBe('Under committee review');
  });
});

describe('MailPlan', () => {
  const base = { testMode: true, testRecipient: 'jim@example.com', committeeGroupEmail: 'ccac@example.com' };

  it('redirects everything to the test recipient in test mode', () => {
    const p = MailPlan.plan({ to: 'scout@x.com', cc: 'ccac@example.com', subject: 'Hi', body: 'b' }, base);
    expect(p.send).toBe(true);
    expect(p.to).toEqual(['jim@example.com']);
    expect(p.cc).toEqual([]);
    expect(p.subject).toBe('[TEST] Hi');
    expect(p.body).toMatch(/Would have sent to: scout@x.com \| cc: ccac@example.com/);
  });

  it('sends nothing in test mode without a test recipient', () => {
    const p = MailPlan.plan({ to: 'a@x.com', subject: 's' }, { testMode: true, testRecipient: '' });
    expect(p.send).toBe(false);
  });

  it('treats a missing testMode as ON', () => {
    const p = MailPlan.plan({ to: 'a@x.com', subject: 's' }, { testRecipient: 'jim@example.com' });
    expect(p.to).toEqual(['jim@example.com']);
  });

  it('never copies sign-in links to the Committee Group', () => {
    const p = MailPlan.plan({ to: 'scout@x.com', cc: 'CCAC@example.com, parent@x.com', subject: 'Link', kind: 'signin' },
      { ...base, testMode: false });
    expect(p.cc).toEqual(['parent@x.com']);
  });

  it('dedupes and splits recipient lists when live', () => {
    const p = MailPlan.plan({ to: 'a@x.com; A@x.com, b@x.com', subject: 's' }, { testMode: false });
    expect(p.to).toEqual(['a@x.com', 'b@x.com']);
    expect(p.subject).toBe('s');
  });
});

describe('SheetModel', () => {
  const keyCol = ['', '', '_key', 'S:a', 'R-1', 'R-2', '', 'S:b', 'S:c', 'R-3'];

  it('finds machine row and builds a header map', () => {
    const m = SheetModel.findMachineRow([['x'], ['scout_name', 'unit', '_key']]);
    expect(m.row).toBe(1);
    expect(m.keyCol).toBe(2);
    expect(m.map.unit).toBe(1);
  });

  it('rejects duplicate machine names', () => {
    expect(() => SheetModel.buildHeaderMap(['a', 'b', 'a'])).toThrow(/Duplicate/);
  });

  it('locates records, sections and a record\'s section', () => {
    expect(SheetModel.findRecordRow(keyCol, 'R-3')).toBe(9);
    expect(SheetModel.findRecordRow(keyCol, 'R-9')).toBe(-1);
    expect(SheetModel.sectionForRow(keyCol, 5)).toBe('a');
    expect(SheetModel.sectionForRow(keyCol, 9)).toBe('c');
    expect(SheetModel.sectionRows(keyCol)).toEqual({ a: 3, b: 7, c: 8 });
  });

  it('inserts after the last record of a section, or under an empty label', () => {
    expect(SheetModel.insertionRow(keyCol, 'a')).toBe(6);
    expect(SheetModel.insertionRow(keyCol, 'b')).toBe(8);
    expect(SheetModel.insertionRow(keyCol, 'c')).toBe(10);
    expect(SheetModel.insertionRow(keyCol, 'zz')).toBe(-1);
  });

  it('makes timestamped, unique Record IDs', () => {
    const now = new Date(2026, 9, 11, 9, 5); // local time
    expect(SheetModel.makeRecordId(() => 0, [], now)).toBe('R-2610110905-AAA');
    let n = 0;
    const id2 = SheetModel.makeRecordId(() => (n++ < 3 ? 0 : 0.5), ['R-2610110905-AAA'], now);
    expect(id2).toMatch(/^R-2610110905-[A-Z2-9]{3}$/);
    expect(id2).not.toBe('R-2610110905-AAA');
    expect(SheetModel.isRecordId(id2)).toBe(true);
    expect(SheetModel.isRecordId('R-ABCDEFGH')).toBe(true); // old format still valid
  });

  it('validates missing sections, order, columns and duplicate keys', () => {
    const settings = { sections: [{ key: 'a' }, { key: 'c' }, { key: 'b' }, { key: 'x' }] };
    const probs = SheetModel.validate(keyCol.concat(['R-1']), { scout_name: 0 }, settings, ['scout_name', 'unit']);
    expect(probs).toContain('Section key missing on sheet: S:x');
    expect(probs).toContain('Section out of order: S:b');
    expect(probs).toContain('Machine header missing: unit');
    expect(probs.some(p => p.startsWith('Duplicate key R-1'))).toBe(true);
  });

  it('proposes unique machine names, with group prefixes for repeats', () => {
    const names = SheetModel.proposeMachineNames(
      ['Scout Info', '', 'Pre-Screen / Intake Review', '', 'Proposal Review', ''],
      ['Eagle Candidate', 'Unit', 'Date', 'Who', 'Date', 'Who']);
    expect(names).toEqual(['scout_name', 'unit', 'pre_screen_intake_review.date', 'pre_screen_intake_review.who',
      'proposal_review.date', 'proposal_review.who']);
    expect(SheetModel.proposeMachineNames([], ['Date', 'Date', ''])).toEqual(['date', 'date_2', 'col_C']);
  });

  it('keeps names short: group prefix only for generic or repeated labels', () => {
    const long = 'Orig Approved Proposal of Eagle Project - Proposal section completely filled out, with signatures.';
    const names = SheetModel.proposeMachineNames(
      ['Eagle Project Info', 'Eagle Earned', '', '', '', ''],
      ['Approved Date', 'EBoR Date', 'Lien Doan Unit', long, 'notes', 'Parent Email']);
    expect(names).toEqual(['approved_date', 'ebor_date', 'lien_doan_unit',
      'orig_approved_proposal_of_eagle_project', 'notes', 'parent_email']);
    expect(names.every(n => n.length <= 70)).toBe(true);
  });

  it('fills machine names only for new, labelled columns', () => {
    const r = SheetModel.fillMissingNames(
      ['scout_name', '', 'proposal_review.date', '', '', '_key'],
      ['Scout Info', 'Pre-Screen / Intake Review', 'Proposal Review', '', '', ''],
      ['Eagle Candidate', 'Date', 'Date', '', 'Notes', '']);
    expect(r.added).toEqual([{ col: 1, name: 'pre_screen_intake_review.date' }, { col: 4, name: 'notes' }]);
    expect(r.row).toEqual(['scout_name', 'pre_screen_intake_review.date', 'proposal_review.date', '', 'notes', '_key']);
    const again = SheetModel.fillMissingNames(['notes', ''], [], ['Notes', 'Notes']);
    expect(again.added).toEqual([{ col: 1, name: 'notes_2' }]);
  });

  it('column letters', () => {
    expect(SheetModel.colLetter(0)).toBe('A');
    expect(SheetModel.colLetter(25)).toBe('Z');
    expect(SheetModel.colLetter(27)).toBe('AB');
    expect(SheetModel.colLetter(53)).toBe('BB');
  });
});

describe('MigrationPlan', () => {
  const settings = SettingsModel.parse([]);

  it('plans keys, Record IDs and the new Pre-Review Call section', () => {
    const p = MigrationPlan.plan(trackingRows(), settings, seq());
    expect(p.error).toBeUndefined();
    expect(p.labelRow).toBe(2);
    expect(p.keyCol).toBe(0);
    expect(p.machineNames.slice(0, 8)).toEqual(['_key', 'action', 'scout_name', 'unit', 'birth_date', 'female', 'scout_email', 'parent_email']);
    expect(p.addAction).toEqual({ col: 1, label: 'Action' });
    expect(SheetModel.findMachineRow([p.machineNames]).keyCol).toBe(0);
    expect(p.machineNames).toContain('proposal_review.date');
    expect(p.sectionWrites.map(w => w.key)).toEqual(['beyond_age', 'proposal_not_approved', 'proposal_incomplete',
      'review_to_book', 'review_booked', 'proposal_revisions', 'proposal_approved', 'app_submitted']);
    expect(p.insertPreReview).toMatchObject({ beforeRow: 9, labelCol: 2, text: 'Intake Review: To Book' });   // production's old headers are still found (aliases)
    expect(p.recordWrites.map(w => [w.row, w.section])).toEqual([
      [6, 'proposal_incomplete'], [7, 'proposal_incomplete'], [10, 'review_to_book'],
      [14, 'proposal_approved'], [16, 'app_submitted']]);
    expect(new Set(p.recordWrites.map(w => w.id)).size).toBe(5);
    expect(p.skipped).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it('does not add an Action column when the sheet already has one', () => {
    const rows = trackingRows().map((r, i) => (i === 2 ? ['Action'].concat(r) : [''].concat(r)));
    const p = MigrationPlan.plan(rows, settings, seq());
    expect(p.addAction).toBeNull();
    expect(p.machineNames.slice(0, 3)).toEqual(['_key', 'action', 'scout_name']);
    expect(p.insertPreReview.labelCol).toBe(2);
  });

  it('refuses to re-migrate', () => {
    const rows = trackingRows();
    rows.splice(2, 0, ['scout_name', '_key']);
    expect(MigrationPlan.plan(rows, settings).alreadyMigrated).toBe(true);
  });

  it('errors without a header row', () => {
    expect(MigrationPlan.plan([['x']], settings).error).toMatch(/Eagle Candidate/);
  });

  it('warns about missing sections', () => {
    const rows = trackingRows().filter(r => r[0] !== 'Approved Proposals');
    const p = MigrationPlan.plan(rows, settings, seq());
    expect(p.warnings).toContain('Section not found on sheet: proposal_approved');
  });
});

const Identity = require('../apps-script/src/lib/identity.js');

describe('Identity', () => {
  it('normalizes and validates email', () => {
    expect(Identity.normalizeEmail('  Pat.Tester+Scout_1@Example.com ')).toBe('pat.tester+scout_1@example.com');
    expect(Identity.isValidEmail('a@b.org')).toBe(true);
    expect(Identity.isValidEmail('nope')).toBe(false);
    expect(Identity.isValidEmail('a@b')).toBe(false);
  });

  it('rate-limits one request per window', () => {
    expect(Identity.rateLimitOk(null, 1000)).toBe(true);
    expect(Identity.rateLimitOk('1000', 1000 + Identity.RATE_LIMIT_MS - 1)).toBe(false);
    expect(Identity.rateLimitOk(1000, 1000 + Identity.RATE_LIMIT_MS)).toBe(true);
  });

  it('makes 64-hex tokens and checks their shape', () => {
    const t = Identity.makeToken(() => 'ABCDEF01-2345-6789-abcd-ef0123456789');
    expect(t).toHaveLength(64);
    expect(Identity.isTokenShape(t)).toBe(true);
    expect(Identity.isTokenShape('R-2610111009-XFV')).toBe(false);
  });

  it('hex-encodes signed digest bytes', () => {
    expect(Identity.bytesToHex([0, 15, 16, -1, -128, 127])).toBe('000f10ff807f');
  });

  it('builds the link and refuses an empty origin', () => {
    expect(Identity.linkUrl('https://x.web.app/', 'ab')).toBe('https://x.web.app/signin?t=ab');
    expect(() => Identity.linkUrl('', 'ab')).toThrow(/webOrigin/);
  });

  it('finds live sessions and ignores expired ones', () => {
    const now = Date.UTC(2026, 9, 11);
    const live = Identity.newSessionRow('h1', 'A@x.com', ['R-1'], now, 14);
    const old = Identity.newSessionRow('h2', 'b@x.com', [], now - 15 * 864e5, 14);
    expect(live[1]).toBe('a@x.com');
    expect(live[2]).toBe('R-1');
    expect(Identity.findSession([old, live], 'h1', now)).toMatchObject({ index: 1 });
    expect(Identity.findSession([old, live], 'h2', now)).toBeNull();
    expect(Identity.findSession([old, live], 'zz', now)).toBeNull();
    expect(Identity.expiredIndexes([old, live], now)).toEqual([0]);
  });
});

describe('Hand-inserted rows and the Action column', () => {
  it('keys named rows without a key, below the first section only', () => {
    const keys = ['', '_key', 'S:a', 'R-1', '', '', 'S:b', ''];
    const names = ['Title', '', 'Section A', 'Scout 1', 'Scout 2', '', 'Section B', 'Scout 3'];
    const out = SheetModel.missingRecordKeys(keys, names, seq(), new Date(2026, 9, 12, 15, 0));
    expect(out.map(o => o.row)).toEqual([4, 7]);
    expect(out[0].id).toMatch(/^R-2610121500-/);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('flags keys left on rows with no name', () => {
    expect(SheetModel.orphanKeys(['S:a', 'R-1', 'R-2'], ['Sec', '', 'Scout'])).toEqual([1]);
  });

  it('maps Action dropdown labels to sections', () => {
    const s = SettingsModel.parse([]);
    expect(SettingsModel.actionOptions(s)).toContain('Intake Review: To Book');
    expect(SettingsModel.sectionForAction(s, 'intake review: to book')).toBe('intake_to_book');
    expect(SettingsModel.sectionForAction(s, 'nope')).toBeNull();
    expect(SettingsModel.sectionLabel(s, 'proposal_approved')).toBe('Proposal Approved');
  });
});

describe('SheetKind', () => {
  it('treats Test Copy and STAGING sheets as non-production', () => {
    for (const n of ['Test Copy of Coyote_Creek_Eagles_and_Contacts', 'Shared Test Copy of X',
      'STAGING Coyote_Creek_Eagles_and_Contacts', 'STAGING']) expect(SheetKind.isNonProduction(n), n).toBe(true);
  });
  it('treats everything else as production', () => {
    for (const n of ['Coyote_Creek_Eagles_and_Contacts', 'Copy of Coyote_Creek_Eagles_and_Contacts',
      'Coyote STAGING notes', 'Staging-ish', '', null]) expect(SheetKind.isNonProduction(n), String(n)).toBe(false);
  });
});

describe('SheetModel.insertAfterFor (Setup adds missing columns)', () => {
  const SheetModel = require('../apps-script/src/lib/sheetModel.js');
  const row = ['_key', 'action', 'scout_name', 'unit', 'scout_email', 'scout_phone', 'notes', '_folder_id', '_log_id'];
  it('goes right after Scout Email', () => {
    expect(SheetModel.insertAfterFor(row, 'parent_email', ['scout_email', 'scout_phone'])).toBe(4);
  });
  it('nothing to do when the column exists', () => {
    expect(SheetModel.insertAfterFor(row.concat('parent_email'), 'parent_email', ['scout_email'])).toBe(-1);
  });
  it('falls back to the last visible column, never among the hidden ones', () => {
    expect(SheetModel.insertAfterFor(row, 'parent_email', ['nope'])).toBe(6);
  });
});

describe('Pre-Review Call Scheduled + Awaiting Update sections (2026-10-19)', () => {
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  it('sit between Pre-Review Call and Pending Review Date', () => {
    const keys = SettingsModel.parse([]).sections.map(s => s.key);
    const i = keys.indexOf('intake_to_book');
    expect(keys.slice(i, i + 4)).toEqual(['intake_to_book', 'intake_booked', 'intake_revisions', 'review_to_book']);
    expect(SettingsModel.pagePhase('intake_revisions')).toBe('proposal');   // Scout can upload the update
  });
});

describe('approval representative settings', () => {
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  it('exist (blank by default) and read from the Settings tab', () => {
    expect(SettingsModel.parse([]).approvalRepName).toBe('');
    const s = SettingsModel.parse([['Key', 'Value'], ['approvalRepName', 'Pat Chair'], ['approvalRepZip', 95000]]);
    expect(s.approvalRepName).toBe('Pat Chair');
    expect(s.approvalRepZip).toBe('95000');
  });
});

describe('section order (Jim W., 2026-10-18)', () => {
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  it('New Submissions first; Beyond Age and Unapproved last', () => {
    const keys = SettingsModel.parse([]).sections.map(s => s.key);
    expect(keys[0]).toBe('proposal_received');
    expect(keys.slice(-6)).toEqual(['ebor_paused', 'eagle_earned', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved', 'closed']);   // Closed last (2026-11-10)
    expect(SettingsModel.pagePhase('ebor_paused')).toBe('status');
    expect(SettingsModel.pagePhase('eagle_not_awarded')).toBe('status');
    expect(SettingsModel.pagePhase('eagle_earned')).toBe('status');
    expect(SettingsModel.pagePhase('proposal_received')).toBe('proposal');   // Scout can still update files
  });
});

describe('moves land at the top; section-row actions (Jim W., 2026-10-19)', () => {
  const SheetModel = require('../apps-script/src/lib/sheetModel.js');
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  const keys = ['_key', '', 'S:a', 'R-1', '', 'R-2', 'S:b', 'S:c', 'R-3'];
  it('topRow = right under the section label', () => {
    expect(SheetModel.topRow(keys, 'a')).toBe(3);
    expect(SheetModel.topRow(keys, 'b')).toBe(7);          // empty section
    expect(SheetModel.topRow(keys, 'zz')).toBe(-1);
    expect(SheetModel.insertionRow(keys, 'a')).toBe(6);    // new submissions still go after the last record
  });
  it('recordSpan covers the records (blank rows between included), null when empty', () => {
    expect(SheetModel.recordSpan(keys, 'a')).toEqual({ first: 3, last: 5 });
    expect(SheetModel.recordSpan(keys, 'b')).toBeNull();
    expect(SheetModel.recordSpan(keys, 'c')).toEqual({ first: 8, last: 8 });
  });
  it('section rows offer tools, not moves', () => {
    expect(SettingsModel.sectionActionOptions()).toEqual(['Sort by age (oldest first)']);
    expect(SettingsModel.sectionActionFor('sort by age (oldest first)')).toBe('sort_age');
    expect(SettingsModel.sectionActionFor('Pre-Review Call')).toBeNull();
  });
});

describe('SheetKind.accountProblem (menu items need the Council account on staging/prod)', () => {
  const SheetKind = require('../apps-script/src/lib/sheetKind.js');
  it('Council account passes; personal account is stopped on staging and production', () => {
    expect(SheetKind.accountProblem('STAGING Coyote_Creek_Life_to_Eagle_Tracker', 'council-account@council.example.org', 'council.example.org')).toBe('');
    expect(SheetKind.accountProblem('Coyote_Creek_Life_to_Eagle_Tracker', 'Someone@COUNCIL.example.org', 'council.example.org')).toBe('');
    expect(SheetKind.accountProblem('Coyote_Creek_Life_to_Eagle_Tracker', 'me@gmail.com', 'council.example.org')).toMatch(/Council account/);
    expect(SheetKind.accountProblem('STAGING x', '', 'council.example.org')).toMatch(/unknown account/);
    expect(SheetKind.accountProblem('Coyote_Creek', 'x@notcouncil.example.org', 'council.example.org')).toMatch(/Council account/);
  });
  it('dev sheets and a blank domain are not checked', () => {
    expect(SheetKind.accountProblem('Test Copy of Coyote_Creek', 'me@gmail.com', 'council.example.org')).toBe('');
    expect(SheetKind.accountProblem('Coyote_Creek', 'me@gmail.com', '')).toBe('');
  });
});

describe('Resend booking link in the Action dropdown', () => {
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  it('is recognized, and is never mistaken for a section', () => {
    expect(SettingsModel.isResendLink('✉ Email status + page link')).toBe(true);
    expect(SettingsModel.isResendLink('↻ Resend booking link')).toBe(true);           // old dropdown value still works
    expect(SettingsModel.sectionForAction(SettingsModel.parse([]), '✉ Email status + page link')).toBeNull();
    expect(SettingsModel.offersStatusEmail('review_booked')).toBe(true);
    expect(SettingsModel.offersStatusEmail('proposal_not_approved')).toBe(true);
    expect(SettingsModel.offersStatusEmail('eagle_earned')).toBe(false);
    expect(SettingsModel.offersStatusEmail('eagle_not_awarded')).toBe(false);
    expect(SettingsModel.offersStatusEmail(null)).toBe(false);
  });
});

describe('section names (Jim W., 10/20) and old header texts', () => {
  const SheetModel = require('../apps-script/src/lib/sheetModel.js');
  const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
  const s = SettingsModel.parse([]);
  it('finds old and new headers; the longest match wins', () => {
    const rows = [['Something missing from Scout before scheduling review'], ['Pre-Review Call'], ['Pre-Review Call Scheduled'],
      ['In-Person Review: To Book'], ['Unapproved Proposals']];
    expect(SheetModel.detectSectionRows(rows, s.sections)).toEqual({
      proposal_incomplete: 0, intake_to_book: 1, intake_booked: 2, review_to_book: 3, proposal_not_approved: 4 });
  });
  it('sections read from a Settings tab keep their aliases', () => {
    const t = SettingsModel.parse([['Key', 'Value', '', 'Section key', 'Label', 'Scout status', 'Order'],
      ['', '', '', 'review_to_book', 'In-Person Review: To Book', 'x', 50]]);
    expect(SheetModel.detectSectionRows([['Proposals Pending Review Date']], t.sections)).toEqual({ review_to_book: 0 });
  });
});

describe('MailPlan test-mode pass-through (staging playground)', () => {
  const s = { testMode: true, testRecipient: 'dev@example.org', testAllow: ['member@example.org'] };
  it('delivers mail addressed only to allowed members', () => {
    const p = MailPlan.plan({ to: 'Member@example.org', subject: 'Sign in', kind: 'signin' }, s);
    expect(p.to).toEqual(['Member@example.org']);
    expect(p.subject).toBe('[TEST SITE] Sign in');
  });
  it('anything else still goes to the test recipient', () => {
    const p = MailPlan.plan({ to: 'member@example.org', cc: 'group@example.org', subject: 'Booked' }, s);
    expect(p.to).toEqual(['dev@example.org']);
  });
});

import MailPlanF from '../apps-script/src/lib/mailPlan.js';
describe('MailPlan.family (To the Scout, Cc the parent)', () => {
  it('To Scout, Cc parent + committee', () => {
    expect(MailPlanF.family('S@x.org', 'p@x.org', 'ccac@x.org')).toEqual({ to: ['s@x.org'], cc: ['p@x.org', 'ccac@x.org'], keepCc: ['p@x.org'] });
  });
  it('no Scout email: To the parent; same address once; extra To follows the Scout', () => {
    expect(MailPlanF.family('', 'p@x.org', 'ccac@x.org')).toEqual({ to: ['p@x.org'], cc: ['ccac@x.org'], keepCc: [] });
    expect(MailPlanF.family('a@x.org', 'a@x.org', '')).toEqual({ to: ['a@x.org'], cc: [], keepCc: [] });
    // No parent/guardian email on file: the committee group is copied instead (kept even on "Cc: none" templates).
    expect(MailPlanF.family('s@x.org', '', '', undefined, 'group@x.org')).toEqual({ to: ['s@x.org'], cc: ['group@x.org'], keepCc: ['group@x.org'] });
    expect(MailPlanF.family('s@x.org', 'p@x.org', '', undefined, 'group@x.org')).toEqual({ to: ['s@x.org'], cc: ['p@x.org'], keepCc: ['p@x.org'] });
    expect(MailPlanF.family('s@x.org', 'p@x.org', ['u@x.org', 's@x.org'], ['b@x.org']).to).toEqual(['s@x.org', 'b@x.org']);
  });
});

describe('Sign-in links: same-browser check (2026-10-29)', () => {
  it('log mode records but never blocks; enforce blocks a mismatch or a missing id; old links pass', () => {
    expect(Identity.browserCheck('h1', 'h1', 'log')).toEqual({ result: 'match', allow: true });
    expect(Identity.browserCheck('h1', 'h2', 'log')).toEqual({ result: 'mismatch', allow: true });
    expect(Identity.browserCheck('h1', 'h2', 'enforce')).toEqual({ result: 'mismatch', allow: false });
    expect(Identity.browserCheck('h1', '', 'Enforce')).toEqual({ result: 'no-id', allow: false });
    expect(Identity.browserCheck('', 'h2', 'enforce')).toEqual({ result: 'old-link', allow: true });
    expect(Identity.browserCheck('h1', 'h2', 'off')).toEqual({ result: 'off', allow: true });
    expect(Identity.browserCheck('h1', 'h2', '').allow).toBe(true);   // blank setting = log
  });
  it('accepts only well-formed browser ids', () => {
    expect(Identity.cleanBrowserId('0f8e2c1a-1234-4abc-9def-0123456789ab')).toBe('0f8e2c1a-1234-4abc-9def-0123456789ab');
    expect(Identity.cleanBrowserId('short')).toBe('');
    expect(Identity.cleanBrowserId('<script>alert(1)</script>xxxxxxx')).toBe('');
    expect(Identity.cleanBrowserId(undefined)).toBe('');
  });
  it('describes devices and browsers for the log', () => {
    const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const iosWebView = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
    const androidWv = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36';
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    expect(Identity.describeAgent(iosSafari)).toBe('iPhone · Safari');
    expect(Identity.describeAgent(iosWebView)).toBe('iPhone · in-app (Gmail/Outlook?)');
    expect(Identity.describeAgent(iosChrome)).toBe('iPhone · Chrome');
    expect(Identity.describeAgent(androidWv)).toBe('Android · in-app (Android)');
    expect(Identity.describeAgent(win)).toBe('Windows · Edge');
    expect(Identity.describeAgent('')).toBe('');
  });
});

describe('Sign-in code (2026-10-29, Settings signinCode)', () => {
  it('makes 6 digits from random bytes, keeping leading zeros', () => {
    expect(Identity.makeCode([0, 0, 0, 7])).toBe('000007');
    expect(Identity.makeCode([-1, -1, -1, -1])).toBe(String(4294967295 % 1000000).padStart(6, '0'));
    expect(Identity.makeCode([18, -52, 3, 99, 5])).toMatch(/^\d{6}$/);
  });
  it('accepts a typed code with spaces or a dash, nothing else', () => {
    expect(Identity.cleanCode('482 913')).toBe('482913');
    expect(Identity.cleanCode(' 482-913 ')).toBe('482913');
    expect(Identity.cleanCode('48291')).toBe('');
    expect(Identity.cleanCode('48291a')).toBe('');
  });
  it('5 tries, then the code is dead', () => {
    const p = { codeHash: 'H', tries: 0 };
    expect(Identity.codeTry(p, 'H')).toMatchObject({ ok: true, dead: false });
    expect(Identity.codeTry(p, 'x')).toMatchObject({ ok: false, tries: 1, left: 4, dead: false });
    expect(Identity.codeTry({ codeHash: 'H', tries: 4 }, 'x')).toMatchObject({ ok: false, left: 0, dead: true });
    expect(Identity.codeTry({ codeHash: 'H', tries: 4 }, 'H').ok).toBe(true);   // the last try can still be right
    expect(Identity.codeTry(null, 'H').ok).toBe(false);
  });
  it('the code line is in the email only when there is a code', () => {
    expect(Identity.linkEmail('https://x/s?t=1', 60, '482 913').body).toContain('type this code on the page where you asked for the link: 482 913');
    expect(Identity.linkEmail('https://x/s?t=1', 60, '').body).not.toContain('code');
    expect(Identity.linkEmail('https://x/s?t=1', 60).body).toContain("please don't forward it");
  });
});

