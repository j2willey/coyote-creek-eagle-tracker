import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Closing = require('../apps-script/src/lib/closing.js');
const SettingsModel = require('../apps-script/src/lib/settingsModel.js');
const StageActions = require('../apps-script/src/lib/stageActions.js');
const EagleDone = require('../apps-script/src/lib/eagleDone.js');
const Board = require('../apps-script/src/lib/board.js');

describe('Closed section (settings)', () => {
  const s = SettingsModel.parse([]);
  it('is the last side section, status only, with the neutral Scout text', () => {
    const keys = s.sections.map(x => x.key);
    expect(keys.slice(-2)).toEqual(['proposal_not_approved', 'closed']);
    expect(SettingsModel.scoutStatusFor(s, 'closed')).toBe('Your record is closed. Questions? Reply to the committee.');
    expect(SettingsModel.pagePhase('closed')).toBe('status');
    expect(SettingsModel.sectionLabel(s, 'closed')).toBe('Closed');
  });
  it('has the new Settings keys with defaults', () => {
    expect(s.closeReviewDays).toBe(180);
    expect(s.closeSnoozeDays).toBe(90);
    expect(s.closedFolder).toBe('Archive/Closed');
  });
  it('Setup can offer the section in the Action dropdown, and the folder does not move on close', () => {
    expect(SettingsModel.actionOptions(s)).toContain('Closed');
    expect(EagleDone.placeFor('closed', '', s)).toBeNull();
    expect(EagleDone.placeFor('proposal_not_approved', '', s)).toBe('Exceptions');
  });
});

describe('Closing: the _closed cell', () => {
  it('round-trips and ignores junk', () => {
    const cell = Closing.closedCell({ r: 'Withdrew', d: '2026-11-10', by: 'JW', from: 'proposal_not_approved', n: 'family moved' });
    expect(Closing.parseClosed(cell)).toEqual({ reason: 'Withdrew', date: '2026-11-10', by: 'JW', from: 'proposal_not_approved', note: 'family moved' });
    expect(Closing.parseClosed('')).toBeNull();
    expect(Closing.parseClosed('not json')).toBeNull();
    expect(Closing.parseClosed('{"d":"2026-01-01"}')).toBeNull();
    expect(Closing.closedCell({ r: '' })).toBe('');
    expect(Closing.parseClosed('{"r":"Withdrew","d":"soon"}').date).toBe('');
  });
  it('counts "Other: text" as Other', () => {
    expect(Closing.reasonKey('Other: moved abroad')).toBe('Other');
    expect(Closing.reasonKey('Withdrew')).toBe('Withdrew');
    expect(Closing.reasonKey('aged out (no extension)')).toBe('Aged out (no extension)');
    expect(Closing.reasonKey('')).toBe('');
  });
});

describe('Closing.closePlan', () => {
  const ok = { section: 'proposal_not_approved', reason: 'Withdrew', date: '2026-11-09', today: '2026-11-10', note: ' family  moved ', by: 'JW' };
  it('builds the _closed content', () => {
    const p = Closing.closePlan(ok);
    expect(p.errors).toEqual([]);
    expect(p.closed).toEqual({ r: 'Withdrew', d: '2026-11-09', by: 'JW', from: 'proposal_not_approved', n: 'family moved' });
  });
  it('needs a reason from the list; Other needs text', () => {
    expect(Closing.closePlan({ ...ok, reason: '' }).errors).toContain('Pick the reason.');
    expect(Closing.closePlan({ ...ok, reason: 'Bored' }).errors).toContain('Pick the reason.');
    expect(Closing.closePlan({ ...ok, reason: 'Other', reasonText: ' ' }).errors[0]).toMatch(/Other/);
    expect(Closing.closePlan({ ...ok, reason: 'Other', reasonText: 'moved abroad' }).closed.r).toBe('Other: moved abroad');
  });
  it('date: required, not in the future', () => {
    expect(Closing.closePlan({ ...ok, date: '' }).errors).toContain('Pick the date.');
    expect(Closing.closePlan({ ...ok, date: '2026-11-11' }).errors[0]).toMatch(/future/);
    expect(Closing.closePlan({ ...ok, date: '2026-11-10' }).errors).toEqual([]);
  });
  it('only from the Exceptions stages', () => {
    Closing.FROM_SECTIONS.forEach(k => expect(Closing.closePlan({ ...ok, section: k }).errors).toEqual([]));
    ['proposal_received', 'eagle_earned', 'closed', 'ebor_booked'].forEach(k => expect(Closing.closePlan({ ...ok, section: k }).errors[0]).toMatch(/no longer at a stage/));
  });
  it('writes the log line', () => {
    expect(Closing.closeLine('11/10', 'JW', 'Withdrew', 'family moved')).toBe('11/10 [JW] Closed: Withdrew (family moved)');
    expect(Closing.closeLine('11/10', '', 'Withdrew', '')).toBe('11/10 [committee] Closed: Withdrew');
  });
});

describe('Closing.reopenPlan', () => {
  const keys = SettingsModel.parse([]).sections.map(x => x.key);
  const closed = { from: 'ebor_paused' };
  it('goes back where it came from, or to the chosen stage', () => {
    expect(Closing.reopenPlan({ closed, reason: 'EBoR rebooked', sectionKeys: keys })).toEqual({ errors: [], to: 'ebor_paused' });
    expect(Closing.reopenPlan({ closed, to: 'app_verified', reason: 'EBoR rebooked', sectionKeys: keys }).to).toBe('app_verified');
  });
  it('needs a reason, a real stage, and not Closed', () => {
    expect(Closing.reopenPlan({ closed, reason: '', sectionKeys: keys }).errors[0]).toMatch(/why/);
    expect(Closing.reopenPlan({ closed, to: 'closed', reason: 'x y z', sectionKeys: keys }).errors[0]).toMatch(/other than Closed/);
    expect(Closing.reopenPlan({ closed, to: 'nowhere', reason: 'x y z', sectionKeys: keys }).errors[0]).toMatch(/not on the tracking tab/);
  });
  it('a record moved to Closed by hand has no stage to go back to', () => {
    expect(Closing.reopenPlan({ closed: null, reason: 'oops, mistake', sectionKeys: keys }).errors[0]).toMatch(/Pick the stage/);
    expect(Closing.reopenPlan({ closed: null, to: 'proposal_received', reason: 'oops, mistake', sectionKeys: keys }).to).toBe('proposal_received');
  });
  it('writes the log line', () => {
    expect(Closing.reopenLine('11/10', 'JW', 'EBoR Paused', 'EBoR rebooked')).toBe('11/10 [JW] Reopened to EBoR Paused: EBoR rebooked');
  });
});

describe('Closing row actions', () => {
  it('Close is offered on every Exceptions stage, Reopen on Closed, Keep open on the two reviewable stages', () => {
    ['ebor_paused', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved'].forEach(k =>
      expect(StageActions.forSection(k).find(a => a.key === 'close')).toMatchObject({ closing: 'close', dateLabel: 'Date closed' }));
    expect(StageActions.forSection('closed').map(a => a.key)).toEqual(['reopen', 'followup']);
    expect(StageActions.forSection('proposal_not_approved').find(a => a.key === 'keep_open')).toMatchObject({ closing: 'keep', ifSuggest: true });
    expect(StageActions.forSection('beyond_age').map(a => a.key)).toEqual(['close', 'followup']);
    expect(StageActions.forSection('eagle_earned').some(a => a.closing)).toBe(false);
    expect(StageActions.forSection('proposal_received').some(a => a.closing)).toBe(false);
  });
  it('none of them sends an email', () => {
    ['close', 'keep_open', 'reopen'].forEach(k => {
      const a = StageActions.get(k);
      expect(a.template).toBeUndefined();
      expect(a.booking).toBeUndefined();
      expect(StageActions.forSection(a.sections[0]).find(x => x.key === k).emailHint).toMatch(/No email is sent/);
    });
  });
});

describe('Dashboard: Closed stays out of the Exceptions tab count', () => {
  const sections = SettingsModel.parse([]).sections;
  const recs = [
    { recordId: 'R1', section: 'proposal_not_approved', scout_name: 'Scout_1', unit: 'T910', birth: '2009-01-01', closeWhy: 'Age 18 or older' },
    { recordId: 'R2', section: 'closed', scout_name: 'Scout_2', unit: 'T910', birth: '2008-05-01',
      closed: { reason: 'Withdrew', date: '2026-03-04', by: 'JW', from: 'proposal_not_approved' }, closeWhy: 'ignored' },
    { recordId: 'R3', section: 'closed', scout_name: 'Scout_3', unit: 'T911', birth: '2008-05-01' }
  ];
  const t = Board.build(recs, sections, '2026-11-10').find(x => x.key === 'exceptions');
  it('has Closed as the last group, counted separately', () => {
    expect(t.groups.map(g => g.key)).toEqual(['ebor_paused', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved', 'closed']);
    expect(t.count).toBe(1);
    expect(t.closedCount).toBe(2);
    expect(t.closedGroup).toBe('closed');
    expect(t.closeReview).toBe(1);
  });
  it('rows carry why they were closed, and the Close? text only while open', () => {
    const rows = t.groups.find(g => g.key === 'closed').rows;
    expect(rows[0].closed).toEqual({ reason: 'Withdrew', date: '2026-03-04', by: 'JW', from: 'Proposal Not Approved' });
    expect(rows[0].closeWhy).toBe('');
    expect(rows[1].closed).toBeNull();
    expect(t.groups.find(g => g.key === 'proposal_not_approved').rows[0].closeWhy).toBe('Age 18 or older');
  });
  it('other tabs have no closed group', () => {
    const p = Board.build(recs, sections, '2026-11-10').find(x => x.key === 'proposals');
    expect(p.closedGroup).toBe('');
    expect(p.closedCount).toBe(0);
  });
});

describe('Closing.suggest: rows that look terminal (a person decides)', () => {
  const Nudges = require('../apps-script/src/lib/nudges.js');
  const base = { section: 'proposal_not_approved', birth: '2009-06-01', lastActivity: '2026-10-01', stageSince: '2026-05-01', snoozeUntil: '' };
  const opts = { today: '2026-11-10', reviewDays: 180 };
  it('age 18 or older in Proposal Not Approved or EBoR Paused', () => {
    expect(Closing.suggest({ ...base, birth: '2008-11-10' }, opts)).toBe('Age 18: 18 or older');           // the birthday itself
    expect(Closing.suggest({ ...base, birth: '2008-11-11' }, opts)).toBe('');                              // day before the 18th birthday
    expect(Closing.suggest({ ...base, section: 'ebor_paused', birth: '2007-01-01' }, opts)).toBe('Age 19: 18 or older');
  });
  it('no log line or update for closeReviewDays', () => {
    expect(Closing.suggest({ ...base, lastActivity: '2026-05-10', stageSince: '2026-05-01' }, opts)).toBe('No log line or update in 184 days');
    expect(Closing.suggest({ ...base, lastActivity: '2026-05-14', stageSince: '2026-05-01' }, opts)).toBe('No log line or update in 180 days');
    expect(Closing.suggest({ ...base, lastActivity: '2026-05-15' }, opts)).toBe('');                       // 179 days
  });
  it('counts from the later of the last activity and the day it reached the stage', () => {
    expect(Closing.suggest({ ...base, lastActivity: '2025-01-01', stageSince: '2026-10-20' }, opts)).toBe('');
    expect(Closing.suggest({ ...base, lastActivity: '', stageSince: '2026-01-01' }, opts)).toMatch(/^No log line or update in 313 days/);
    expect(Closing.suggest({ ...base, lastActivity: '', stageSince: '' }, opts)).toBe('');                  // nothing known: no guess
  });
  it('uses Settings closeReviewDays, defaulting to 180', () => {
    expect(Closing.suggest({ ...base, lastActivity: '2026-09-01', stageSince: '' }, { ...opts, reviewDays: 60 })).toMatch(/70 days/);
    expect(Closing.suggest({ ...base, lastActivity: '2026-09-01', stageSince: '' }, { ...opts, reviewDays: '' })).toBe('');
    expect(Closing.suggest({ ...base, lastActivity: '2026-01-01', stageSince: '' }, { today: '2026-11-10' })).toMatch(/313 days/);
  });
  it('never suggests Beyond Age, Eagle Not Awarded, Closed or an active stage', () => {
    ['beyond_age', 'eagle_not_awarded', 'closed', 'proposal_received', 'ebor_booked'].forEach(k =>
      expect(Closing.suggest({ ...base, section: k, birth: '2000-01-01', lastActivity: '2020-01-01' }, opts)).toBe(''));
  });
  it('Keep open snoozes until the date, then it is suggested again', () => {
    const old = { ...base, birth: '2000-01-01' };
    expect(Closing.suggest({ ...old, snoozeUntil: '2026-11-11' }, opts)).toBe('');
    expect(Closing.suggest({ ...old, snoozeUntil: '2026-11-10' }, opts)).not.toBe('');   // the snooze ran out today
    expect(Closing.suggest({ ...old, snoozeUntil: 'junk' }, opts)).not.toBe('');
    expect(Closing._util.addDays('2026-11-10', 90)).toBe('2027-02-08');
  });
  it('suggestions() lists the ids', () => {
    const list = Closing.suggestions([{ recordId: 'R-1', ...base, birth: '2000-01-01' }, { recordId: 'R-2', ...base }], opts);
    expect(list).toEqual([{ recordId: 'R-1', why: 'Age 26: 18 or older' }]);
  });
  it('reads _stage_since only for the stage the row is in', () => {
    expect(Closing.stageSinceDate('proposal_not_approved 2026-05-01', 'proposal_not_approved')).toBe('2026-05-01');
    expect(Closing.stageSinceDate('ebor_paused 2026-05-01', 'proposal_not_approved')).toBe('');
    expect(Closing.stageSinceDate('', 'proposal_not_approved')).toBe('');
  });
  it('the digest lists them under "Exceptions to review (n)"', () => {
    const g = Nudges.awaiting({ closeReview: [{ title: 'Scout_1 (T910)', why: 'Age 18: 18 or older' }, { title: 'Pat Q (T999)', why: 'No log line or update in 200 days' }] });
    expect(g).toHaveLength(1);
    expect(g[0].title).toMatch(/^Exceptions to review \(2\)/);
    expect(g[0].items).toEqual(['Scout_1 (T910): Age 18: 18 or older', 'Pat Q (T999): No log line or update in 200 days']);
    expect(Nudges.awaiting({ closeReview: [] })).toEqual([]);
  });
});

describe('Closing: January archive', () => {
  const rec = (id, o = {}) => ({ recordId: id, section: 'closed', scout_name: 'Scout ' + id, unit: 'T910',
    closed: { reason: 'Withdrew', date: '2025-06-01', by: 'JW', from: 'proposal_not_approved', note: '' }, ...o });
  const recs = [
    rec('R-1', { closed: { reason: 'Withdrew', date: '2025-06-01', by: 'JW', from: 'ebor_paused', note: 'family moved' } }),
    rec('R-2', { closed: { reason: 'Aged out (no extension)', date: '2024-12-31', by: 'AB', from: 'proposal_not_approved', note: '' } }),
    rec('R-3', { closed: { reason: 'Other: x', date: '2026-02-01', by: 'AB', from: 'beyond_age', note: '' } }),      // this year: stays
    rec('R-4', { closed: null }),                                                                                   // moved by hand: no date
    rec('R-5', { section: 'proposal_not_approved' }),                                                               // not closed
    rec('R-6', { scout_name: '' })
  ];
  it('picks the Closed rows closed in a past year, oldest first', () => {
    const c = Closing.archiveCandidates(recs, 2026);
    expect(c.ids).toEqual(['R-2', 'R-1']);
    expect(c.rows[0]).toEqual({ recordId: 'R-2', name: 'Scout R-2', unit: 'T910', closed: '2024-12-31', reason: 'Aged out (no extension)' });
    expect(c.years).toEqual([{ year: '2024', count: 1 }, { year: '2025', count: 1 }]);
    expect(c.noDate).toBe(1);
  });
  it('next January the 2026 ones follow; nothing closed this year is archived', () => {
    expect(Closing.archiveCandidates(recs, 2027).ids).toEqual(['R-2', 'R-1', 'R-3']);
    expect(Closing.archiveCandidates(recs, 2024).ids).toEqual([]);
  });
  it('Settings closedFolder -> folder path', () => {
    expect(Closing.folderPath('Archive/Closed')).toEqual(['Archive', 'Closed']);
    expect(Closing.folderPath(' Old\\Done / 2026 ')).toEqual(['Old', 'Done', '2026']);
    expect(Closing.folderPath('')).toEqual(['Archive', 'Closed']);
  });
  it('the Closed Archive row has the agreed columns and NO contact details', () => {
    const full = { ...recs[0], approved: '2025-01-15', ebor: '2025-05-10', folderId: 'FOLDER1',
      scout_email: 'scout@example.org', parent_email: 'parent@example.org', scout_phone: '555-0100', birth: '2008-01-01', birth_date: '2008-01-01',
      bsa_id: '12345678', address: '1 Sample St', notes: 'private log' };
    const row = Closing.archiveRow(full, { stageLabel: k => ({ ebor_paused: 'EBoR Paused' })[k], archivedOn: '2026-01-05' });
    expect(Object.keys(row)).toEqual(Closing.ARCHIVE_HEADERS);
    expect(Closing.ARCHIVE_HEADERS).toEqual(['Record ID', 'Scout', 'Unit', 'Closed', 'Reason', 'Note', 'Closed by', 'Stage before closing',
      'Proposal approved', 'EBoR date', 'Folder', 'Archived on']);
    expect(row).toEqual({ 'Record ID': 'R-1', 'Scout': 'Scout R-1', 'Unit': 'T910', 'Closed': '2025-06-01', 'Reason': 'Withdrew', 'Note': 'family moved',
      'Closed by': 'JW', 'Stage before closing': 'EBoR Paused', 'Proposal approved': '2025-01-15', 'EBoR date': '2025-05-10',
      'Folder': 'https://drive.google.com/drive/folders/FOLDER1', 'Archived on': '2026-01-05' });
    const text = JSON.stringify(row);
    ['example.org', '555-0100', '2008-01-01', '12345678', 'Sample St', 'private log'].forEach(x => expect(text).not.toContain(x));
    expect(Closing.ARCHIVE_HEADERS.join(' ')).not.toMatch(/mail|phone|birth|address|BSA/i);
  });
  it('a row with no dates or folder leaves those cells empty', () => {
    const row = Closing.archiveRow({ recordId: 'R-9', scout_name: 'Scout_9', unit: 'T999', closed: { reason: 'Withdrew', date: '2025-02-02', by: '', from: '', note: '' } }, { archivedOn: '2026-01-05' });
    expect(row['Proposal approved']).toBe('');
    expect(row['EBoR date']).toBe('');
    expect(row['Folder']).toBe('');
    expect(row['Stage before closing']).toBe('');
  });
});

describe('Closing: Stats', () => {
  const Stats = require('../apps-script/src/lib/stats.js');
  const recs = [
    { section: 'closed', closed: { reason: 'Withdrew', date: '2026-03-01' } },
    { section: 'closed', closed: { reason: 'Withdrew', date: '2026-04-01' } },
    { section: 'closed', closed: { reason: 'Other: moved abroad', date: '2026-05-01' } },
    { section: 'closed', closed: { reason: 'Extension denied', date: '2026-06-01' } },
    { section: 'closed', closed: { reason: 'Withdrew', date: '2025-06-01' } },      // last year: Stats History has it
    { section: 'closed', closed: null },
    { section: 'proposal_not_approved', closed: { reason: 'Withdrew', date: '2026-06-01' } }   // reopened rows don't count
  ];
  it('closures by reason this year, biggest first', () => {
    const z = Closing.closuresByReason(recs, 2026);
    expect(z.total).toBe(4);
    expect(z.byReason).toEqual([{ reason: 'Withdrew', count: 2 }, { reason: 'Extension denied', count: 1 }, { reason: 'Other', count: 1 }]);
    expect(z.reasons).toBe('Withdrew 2; Extension denied 1; Other 1');
    expect(Closing.closuresByReason([], 2026)).toEqual({ year: '2026', total: 0, byReason: [], reasons: '' });
  });
  it('is part of the live Stats and the year\'s Stats History row', () => {
    const cur = Stats.current(recs.map(r => ({ ...r, recordId: 'x', unit: 'T910' })), '2026-12-31');
    expect(cur.closures.total).toBe(4);
    const row = Stats.historyRow(cur, 'note');
    expect(row).toHaveLength(Stats.HISTORY_HEADERS.length);
    expect(row.slice(-2)).toEqual([4, 'Withdrew 2; Extension denied 1; Other 1']);
    Stats.HISTORY_SEED.forEach(r => expect(r).toHaveLength(Stats.HISTORY_HEADERS.length));
  });
  it('Stats History rows carry closures for past years', () => {
    const h = Stats.history([{ Year: '2026', 'Total Eagles': 90, Closed: 5, 'Closed Reasons': 'Withdrew 5' }, { Year: '2025', 'Total Eagles': 87 }]);
    expect(h.map(x => [x.year, x.closed, x.closedReasons])).toEqual([['2025', null, ''], ['2026', 5, 'Withdrew 5']]);
  });
  it('Closed Scouts are not on the age-out watch', () => {
    const cur = Stats.current([{ recordId: 'a', section: 'closed', birth: '2008-11-01', unit: 'T910' }, { recordId: 'b', section: 'app_verified', birth: '2008-11-01', unit: 'T910' }], '2026-06-01');
    expect(cur.ageWatch.count).toBe(1);
  });
});
