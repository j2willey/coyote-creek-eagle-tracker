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
    expect(StageActions.forSection('closed').map(a => a.key)).toEqual(['reopen']);
    expect(StageActions.forSection('proposal_not_approved').find(a => a.key === 'keep_open')).toMatchObject({ closing: 'keep', ifSuggest: true });
    expect(StageActions.forSection('beyond_age').map(a => a.key)).toEqual(['close']);
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
