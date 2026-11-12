// The Demo Scout on the EBoR paperwork page (Task 14b): the whole server path through the real Apps Script files, with a
// fake Drive. The tracking tab, Scout logs and Council are guarded: any touch fails the test.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../apps-script/src');
const listJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? listJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);

const COUNCIL = 'council-eagles@example.org';
const GROUP = 'group@example.org';
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

// ---- a tiny in-memory Drive ----
let seq = 0;
function makeDrive() {
  const byId = {};
  const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  class Folder {
    constructor(name, parent) { this.id = 'D' + (++seq); this.name = name; this.parent = parent; this.folders = []; this.files = []; byId[this.id] = this; }
    getId() { return this.id; } getName() { return this.name; } isTrashed() { return false; }
    getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); }
    createFolder(n) { const f = new Folder(n, this); this.folders.push(f); return f; }
    getFiles() { return iter(this.files.slice()); }
    createFile(blob) { const f = new File(blob.name, 'application/pdf', blob.bytes, this); this.files.push(f); return f; }
  }
  class File {
    constructor(name, mime, bytes, parent) { this.id = 'F' + (++seq); this.name = name; this.mime = mime; this.bytes = bytes; this.parent = parent; this.t = Date.now() + seq; byId[this.id] = this; }
    getId() { return this.id; } getName() { return this.name; } setName(n) { this.name = n; return this; }
    getMimeType() { return this.mime; } getSize() { return this.bytes.length; } getLastUpdated() { return new Date(this.t); }
    getBlob() { return { getBytes: () => this.bytes, getContentType: () => this.mime }; }
    moveTo(folder) { this.parent.files = this.parent.files.filter(f => f !== this); this.parent = folder; folder.files.push(this); return this; }
    makeCopy(name, folder) { const f = new File(name, this.mime, this.bytes, folder); folder.files.push(f); return f; }
  }
  return { byId, Folder, File, api: { getFolderById: id => { if (!byId[id] || !(byId[id] instanceof Folder)) throw new Error('no folder ' + id); return byId[id]; },
    getFileById: id => { if (!byId[id] || !(byId[id] instanceof File)) throw new Error('no file ' + id); return byId[id]; } } };
}

describe('EBoR paperwork: the Demo Scout never touches real records or Council', () => {
  let ctx, drive, log, root, templates, intake;
  const run = code => vm.runInContext(code, ctx);
  const call = req => { ctx.__req = req; return run('dispatch_(__req)'); };
  const forbidden = name => (...a) => { log.forbidden.push(name + '(' + JSON.stringify(a).slice(0, 80) + ')'); throw new Error('FORBIDDEN ' + name); };

  beforeEach(() => {
    seq = 0;
    drive = makeDrive();
    log = { forbidden: [], tabs: [], outbox: [], sent: [], notes: [] };
    ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
    for (const f of listJs(SRC).sort()) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    root = new drive.Folder('Scouts', null);
    templates = new drive.Folder('Form Templates', null);
    intake = new drive.Folder('_Intake Queue', null);
    templates.files.push(new drive.File('Blank Eagle Application.pdf', 'application/pdf', [37, 80, 68, 70, 1], templates));
    templates.files.push(new drive.File('Advancement Form 34403.pdf', 'application/pdf', [37, 80, 68, 70, 2], templates));
    const cache = {};
    Object.assign(ctx, {
      DriveApp: drive.api,
      CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
      Utilities: { getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => Math.floor(Math.random() * 16).toString(16)),
        base64Decode: s => Array.from(Buffer.from(s, 'base64')), base64Encode: b => Buffer.from(b).toString('base64'), formatDate: () => '11/11/2026',
        newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
      Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
      getSettings_: () => ({ scoutsFolderId: root.id, intakeFolderId: intake.id, formTemplatesFolderId: templates.id, councilEaglesEmail: COUNCIL,
        committeeGroupEmail: GROUP, districtName: 'Coyote Creek', advancementTitle: 'Coyote Creek Advancement', maxUploadMB: 20, testMode: true, sections: [] }),
      todayYmd_: () => '2026-11-11',
      committeeMe_: () => ({ email: 'ab@example.org', me: { name: 'Pat Reviewer', initials: 'AB' }, committee: [{ name: 'Pat Reviewer', initials: 'AB', email: 'ab@example.org' }] }),
      committee_: () => [{ name: 'Pat Reviewer', initials: 'AB', email: 'ab@example.org' }],
      withLock_: fn => fn(),
      templateTabs_: () => null,                                   // built-in wording
      queueOutbox_: (key, out, msg) => { log.outbox.push({ key, out, msg }); return 'OB-1'; },
      sendMail_: m => { log.sent.push(m); return { send: true }; },
      Tabs: { append: (tab, row) => { log.tabs.push({ tab, row }); }, read: () => [], update: forbidden('Tabs.update'), sheet: forbidden('Tabs.sheet') },
      // the tracking tab / Scout log / Council paths: any call is a failure
      Records: new Proxy({}, { get: (_, k) => forbidden('Records.' + String(k)) }),
      addRecordNote_: forbidden('addRecordNote_'), recordActivity_: forbidden('recordActivity_'), folderForRecord_: forbidden('folderForRecord_'),
      linkFolder_: forbidden('linkFolder_'), getTrackingSheet_: forbidden('getTrackingSheet_'), draftCouncilPaperwork_: forbidden('draftCouncilPaperwork_'),
      readSchedule_: forbidden('readSchedule_'), key3Rows_: forbidden('key3Rows_'), stageColumns_: forbidden('stageColumns_')
    });
  });

  const savedFlow = (extra = {}) => {
    const v = demoFolder().files.find(f => /verified/i.test(f.name));       // the page sends the Verified file it used
    const st = call({ action: 'eborPaperworkStart', session: 's', recordId: 'DEMO', boardYmd: '2026-11-11',
      application: [{ name: 'Pat Reviewer', rep: false, signed: true }, { name: 'Jordan Example', rep: true, signed: true }],
      report: [{ name: 'Jordan Example', rep: true, signed: true }, { name: 'Pat Reviewer', rep: false, signed: true }, { name: 'Sam Sample', rep: false, signed: true }],
      verifiedId: v ? v.id : '', ...extra });
    expect(st.error).toBeUndefined();
    for (const kind of ['application', 'report']) {
      const up = call({ action: 'eborPaperworkUpload', uploadToken: st.uploadToken, kind, name: kind + '-signed.pdf', data: PDF });
      expect(up.error).toBeUndefined();
    }
    return call({ action: 'eborPaperworkFinish', session: 's', uploadToken: st.uploadToken });
  };
  const demoFolder = () => root.folders.find(f => f.name === '2026').folders.find(f => f.name === 'Demo Scout - T999 (test)');

  it('the dropdown lists the Demo Scout first without reading the schedule being required', () => {
    ctx.Records = { all: () => [{ recordId: 'R-1', section: 'ebor_booked', scout_name: 'Owen Fairbanks', preferred_name: '', unit: 'T1' }] };
    ctx.readSchedule_ = () => ({ rows: [] });
    const ch = call({ action: 'eborPaperworkChoices', session: 's' });
    expect(ch.scouts.map(s => s.recordId)).toEqual(['DEMO', 'R-1']);
    expect(ch.scouts[0].label).toMatch(/Demo Scout/);
  });

  it('opening the demo makes <Scouts>/<year>/Demo Scout - T999 (test)/ and copies the blank application in as the Verified one', () => {
    const sc = call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    expect(sc.error).toBeUndefined();
    expect(sc).toMatchObject({ recordId: 'DEMO', demo: true, unit: 'T999', boardYmd: '2026-11-11', councilEmail: '' });
    expect(sc.fields).toMatchObject({ Leader: 'Pat Q Leader', Address: '1 Example Way', City: 'San Jose', State: 'CA', Zip: '95100', No: '999' });
    expect(sc.suggestions).toEqual({ district: ['Pat Reviewer'], unit: [] });
    const files = demoFolder().files.map(f => f.name);
    expect(files).toEqual(['Verified Eagle Application (demo).pdf']);
    expect(sc.verifiedId).toBe(demoFolder().files[0].id);
    call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    expect(demoFolder().files).toHaveLength(1);                       // not copied twice
    expect(templates.files).toHaveLength(2);                          // the blank stays in Form Templates
    expect(log.forbidden).toEqual([]);
  });

  it('the page can open the demo\'s Verified PDF (fetchScoutFile with recordId DEMO reads the demo folder, not the tracking tab)', () => {
    const sc = call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    const r = call({ action: 'fetchScoutFile', session: 's', recordId: 'DEMO', fileId: sc.verifiedId });
    expect(r.error).toBeUndefined();
    expect(r.name).toBe('Verified Eagle Application (demo).pdf');
    const bad = call({ action: 'fetchScoutFile', session: 's', recordId: 'DEMO', fileId: 'NOT-IN-DEMO' });
    expect(String(bad.error || '')).toMatch(/not in the demo Scout/);
    expect(log.forbidden).toEqual([]);
  });

  it('asks for the blank when Form Templates has no Eagle Application', () => {
    templates.files.length = 0;
    expect(call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' }).error).toMatch(/blank Eagle Application/);
  });

  it('Save: two signed files in the demo folder, Verified to Archive, a [DEMO] draft To the member only, no tracking tab, no Scout log', () => {
    call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    const r = savedFlow();
    expect(r.error).toBeUndefined();
    expect(r.outboxId).toBe('OB-1');
    expect(r.message).toMatch(/Nothing was sent to Council/);
    const f = demoFolder();
    expect(f.files.map(x => x.name).sort()).toEqual(['Theodore_Teddy_Sample-T999_AdvancementReport-Signed.pdf', 'Theodore_Teddy_Sample-T999_EagleApplication-Signed.pdf']);
    expect(f.folders.find(x => x.name === 'Archive').files.map(x => x.name)).toEqual(['Verified Eagle Application (demo).pdf']);
    // the one email
    expect(log.outbox).toHaveLength(1);
    const { out, msg } = log.outbox[0];
    expect(out.to).toEqual(['ab@example.org']);
    expect(out.cc).toBe('');
    expect(out.subject).toMatch(/^\[DEMO\] /);
    expect(out.body).toMatch(/^\[DEMO\]/);
    expect(msg.attachments.map(a => a.name)).toEqual(['Theodore_Teddy_Sample-T999_EagleApplication-Signed.pdf', 'Theodore_Teddy_Sample-T999_AdvancementReport-Signed.pdf']);
    expect(msg.recordId).toBe('');
    // nothing addressed to Council or the group, nothing sent directly
    expect(JSON.stringify(log.outbox)).not.toContain(COUNCIL);
    expect(JSON.stringify(log.outbox)).not.toContain(GROUP);
    expect(log.sent).toEqual([]);
    // no tracking / Scout log / Council path touched
    expect(log.forbidden).toEqual([]);
    // tabs written: the Uploads Log (the same upload path) and one Activity line
    expect(log.tabs.map(t => t.tab).sort()).toEqual(['Activity']);   // no Uploads Log rows for the demo
    const act = log.tabs.find(t => t.tab === 'Activity').row;
    expect(act.Entry).toBe('EBoR paperwork demo run by AB');
    expect(act['Record ID']).toBe('DEMO');                            // kept out of the digest by Digest.select
    expect(log.tabs.filter(t => t.tab === 'Uploads Log')).toEqual([]);
  });

  it('a Template tab saying Review/Off or a Doc with a Cc line still cannot widen the demo email', () => {
    // exercise the real Doc path: a template tab whose Cc line is "group" and Mode: Review
    ctx.templateTabs_ = () => ({ T: [] });
    ctx.TemplateCatalog.findTab = () => 'T';
    ctx.Templates.parseTab = () => ({ mode: 'review', cc: 'group' });
    ctx.Templates.render = () => ({ errors: [], subject: 'Eagle paperwork from the Doc', text: 'Doc body', html: '<p>Doc body</p>' });
    call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    const r = savedFlow();
    expect(r.error).toBeUndefined();
    const { out } = log.outbox[0];
    expect(out).toMatchObject({ to: ['ab@example.org'], cc: '', bcc: '' });
    expect(out.subject).toBe('[DEMO] Eagle paperwork from the Doc');
    expect(JSON.stringify(log.outbox)).not.toContain(GROUP);
    expect(JSON.stringify(log.outbox)).not.toContain(COUNCIL);
  });

  it('Save again archives the earlier signed pair; Reset demo moves the signed files to Archive and the next open restores the Verified copy', () => {
    call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    savedFlow();
    const again = call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    expect(again.alreadySigned).toEqual({ application: true, report: true });
    expect(again.verifiedId).not.toBe('');                           // the blank was copied in again (the first one went to Archive)
    // Save a second time: earlier signed files archived (same standard names)
    savedFlow();
    expect(demoFolder().files.filter(f => /-Signed\.pdf$/.test(f.name))).toHaveLength(2);
    expect(demoFolder().folders.find(x => x.name === 'Archive').files.filter(f => /-Signed\.pdf$/.test(f.name))).toHaveLength(2);
    const reset = call({ action: 'eborPaperworkDemoReset', session: 's' });
    expect(reset.message).toMatch(/Demo reset: 2 signed file/);
    expect(demoFolder().files.filter(f => /-Signed\.pdf$/.test(f.name))).toHaveLength(0);
    const fresh = call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    expect(fresh.alreadySigned).toEqual({ application: false, report: false });
    expect(fresh.verifiedId).not.toBe('');                           // the blank was copied in again
    expect(call({ action: 'eborPaperworkDemoReset', session: 's' }).message).toMatch(/already fresh/);
    expect(log.forbidden).toEqual([]);
  });

  it('Reset before any demo run is harmless', () => {
    expect(call({ action: 'eborPaperworkDemoReset', session: 's' }).message).toMatch(/already fresh/);
    expect(root.folders).toHaveLength(0);
  });

  it('mailFromTemplate_ refuses a demo message that is not a single-recipient Outbox draft', () => {
    ctx.__m = { demo: true, outbox: false, committee: true, demoTo: 'ab@example.org', to: [COUNCIL] };
    expect(() => run("mailFromTemplate_('Council: Eagle paperwork', {}, __m)")).toThrow(/demo email must be an Outbox draft/);
    ctx.__m = { demo: true, outbox: true, committee: true, demoTo: '', to: [COUNCIL] };
    expect(() => run("mailFromTemplate_('Council: Eagle paperwork', {}, __m)")).toThrow(/demo email must be an Outbox draft/);
    expect(log.sent).toEqual([]);
  });

  it('a template turned Off drafts nothing and says so (the files are still filed)', () => {
    ctx.templateTabs_ = () => ({ T: [] });
    ctx.TemplateCatalog.findTab = () => 'T';
    ctx.Templates.parseTab = () => ({ mode: 'off', cc: 'none' });
    call({ action: 'eborPaperworkScout', session: 's', recordId: 'DEMO' });
    const r = savedFlow();
    expect(r.message).toMatch(/No \[DEMO\] email was drafted/);
    expect(r.outboxId).toBe('');
    expect(log.outbox).toEqual([]);
    expect(log.sent).toEqual([]);
  });
});
