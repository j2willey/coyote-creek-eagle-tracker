// The Eagle earned page (2026-11-17): the server path through the real Apps Script files, with stubs.
// Fictional Scouts and members only.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../apps-script/src');
const listJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? listJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);

describe('Eagle earned page: boards, warning, undo', () => {
  let ctx, recs, cache, log;
  const call = req => { ctx.__req = req; return vm.runInContext('dispatch_(__req)', ctx); };
  const fmt = (d, tz, pat) => {
    const p = n => String(n).padStart(2, '0');
    if (pat === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return 'when';
  };
  beforeEach(() => {
    ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
    for (const f of listJs(SRC).sort()) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    cache = {};
    log = { notes: [], moved: [], updates: [], unbump: [], discarded: [] };
    recs = {
      'R-5': { recordId: 'R-5', section: 'ebor_booked', fields: { scout_name: 'Teddy Sample', unit: 'T999', ebor_date: '2026-11-17' } },
      'R-7': { recordId: 'R-7', section: 'ebor_booked', fields: { scout_name: 'Owen Fairbanks', unit: 'T999', ebor_date: '2026-11-17' } }
    };
    const committee = [{ name: 'Pat Reviewer', initials: 'AB', email: 'ab@example.org', role: '' }, { name: 'Lee Member', initials: 'CD', email: 'cd@example.org', role: '' }];
    Object.assign(ctx, {
      Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
      Utilities: { formatDate: fmt },
      CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
      todayYmd_: () => '2026-11-17',
      committeeMe_: s => { const m = committee.find(x => x.initials === s); ctx.ACTOR_ = m.initials; return { email: m.email, me: m, committee }; },
      committee_: () => committee,
      getSettings_: () => ({ testMode: true, sections: [], adminEmail: 'admin@example.org' }),
      readSchedule_: () => ({ rows: [
        { _key: 'S5', record_id: 'R-5', slot_type: 'EBoR', date: '2026-11-17', time: '5:00 PM', reps: 'AB', board_members: 'Dan Example, dan@example.org' },
        { _key: 'S7', record_id: 'R-7', slot_type: 'EBoR', date: '2026-11-17', time: '7:00 PM', reps: 'CD', board_members: '' },
        { _key: 'S1', record_id: 'R-1', slot_type: 'EBoR', date: '2026-11-10', time: '7:00 PM', reps: 'AB', board_members: '' }] }),
      Records: { get: id => recs[id] || null, columns: () => ['_eagle_no'], update: (id, u) => log.updates.push([id, u]),
        move: (id, to) => { log.moved.push([id, to]); recs[id].section = to; } },
      stageColumns_: () => ({ ebor: 'ebor_date', signedSent: '' }),
      eagleAnnounce_: () => ({}),
      paintCell_: () => {},
      addRecordNote_: (id, line) => log.notes.push(line),
      unbumpEagleCounts_: (rec, nums) => { log.unbump.push(nums); return nums.map(x => ({ code: x.code, from: x.n, to: x.was })); },
      outboxFinish_: (id) => { if (id === 'OB-SENT') throw new Error('handled'); log.discarded.push(id); }
    });
  });

  it("starts from the member's own board, and warns (never redirects) for another Scout", () => {
    const own = call({ action: 'eagleBoards', session: 'AB' });
    expect(own.ok).toBe(true);
    expect(own.mine.map(b => b.recordId)).toEqual(['R-5']);              // last week's board is outside the window
    expect(own.decide).toMatchObject({ mode: 'own', recordId: 'R-5' });
    expect(own.scout).toMatchObject({ name: 'Teddy Sample', unit: 'T999', section: 'ebor_booked' });
    expect(own.scout.board).toMatchObject({ ymd: '2026-11-17', district: ['Pat Reviewer'], unitMembers: ['Dan Example'], onIt: true });
    expect(own.action.key).toBe('eagle_earned');
    const other = call({ action: 'eagleBoards', session: 'AB', recordId: 'R-7' });
    expect(other.decide).toMatchObject({ mode: 'warn', recordId: 'R-7', own: ['R-5'] });
    expect(other.scout.name).toBe('Owen Fairbanks');                     // the picked Scout stays picked
    expect(other.scout.board.onIt).toBe(false);
  });

  it('undo within the window: back to EBoR Booked, counts back, unsent drafts discarded', () => {
    recs['R-5'].section = 'eagle_earned';
    vm.runInContext("rememberEagleUndo_('R-5', { by: 'ab@example.org', at: Date.now(), nums: [{ code: 't999', n: 110, was: 109 }], outboxIds: ['OB-1', 'OB-SENT'], prevEbor: '2026-11-17', ebor: '2026-11-17' })", ctx);
    expect(call({ action: 'eagleBoards', session: 'AB', recordId: 'R-5' }).scout.undo.until).toBeGreaterThan(Date.now());
    expect(call({ action: 'eagleUndo', session: 'CD', recordId: 'R-5' }).error).toMatch(/Only the member who saved/);
    const r = call({ action: 'eagleUndo', session: 'AB', recordId: 'R-5' });
    expect(r.error).toBeUndefined();
    expect(r.message).toMatch(/back at EBoR Booked.*1 draft discarded.*already sent or handled/);
    expect(log.moved).toEqual([['R-5', 'ebor_booked']]);
    expect(log.discarded).toEqual(['OB-1']);
    expect(log.notes[0]).toMatch(/\[AB\] Eagle earned undone/);
    expect(call({ action: 'eagleUndo', session: 'AB', recordId: 'R-5' }).error).toMatch(/10 minutes/);   // once only
  });

  it('the Verified Application for the photo: the Scout\'s own; a blank stands in on STAGING only', () => {
    const file = (id, name) => ({ getName: () => name, getSize: () => 10, getBlob: () => ({ getBytes: () => [37, 80, 68, 70] }) });
    const files = { V1: file('V1', 'Verified Eagle Application.pdf'), B1: file('B1', 'Blank Eagle Application.pdf') };
    let sheetName = 'STAGING Tracker', folderFiles = [];
    Object.assign(ctx, {
      folderForRecord_: () => ({}), paperworkFiles_: () => folderFiles,
      formTemplateFiles_: () => [{ id: 'B1', name: 'Blank Eagle Application.pdf', mime: 'application/pdf', modified: 1 }],
      DriveApp: { getFileById: id => files[id] }, SpreadsheetApp: { getActive: () => ({ getName: () => sheetName }) },
      Utilities: { formatDate: fmt, base64Encode: b => Buffer.from(b).toString('base64') }
    });
    folderFiles = [{ id: 'V1', name: 'Verified Eagle Application.pdf', mime: 'application/pdf', modified: 5 }];
    expect(call({ action: 'eagleVerifiedPdf', session: 'AB', recordId: 'R-5' })).toMatchObject({ name: 'Verified Eagle Application.pdf', stand_in: false });
    folderFiles = [];
    expect(call({ action: 'eagleVerifiedPdf', session: 'AB', recordId: 'R-5' })).toMatchObject({ name: 'Blank Eagle Application.pdf', stand_in: true });
    sheetName = 'Coyote_Creek_Life_to_Eagle_Tracker';                  // production: never a blank
    expect(call({ action: 'eagleVerifiedPdf', session: 'AB', recordId: 'R-5' }).error).toMatch(/No Verified Application/);
  });
});
