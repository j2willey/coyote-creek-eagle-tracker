// Remote EBoR signing (vault ebor-remote-signing-design.md): the whole server path through the real Apps Script files,
// with a fake Drive and in-memory tabs. Fictional people only.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../apps-script/src');
const listJs = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? listJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');
const GROUP = 'group@example.org';

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
    constructor(name, mime, bytes, parent) { this.id = 'F' + (++seq); this.name = name; this.mime = mime; this.bytes = bytes; this.parent = parent; this.t = 1000 + seq; byId[this.id] = this; }
    getId() { return this.id; } getName() { return this.name; } setName(n) { this.name = n; return this; }
    getMimeType() { return this.mime; } getSize() { return this.bytes.length; } getLastUpdated() { return new Date(this.t); }
    getBlob() { return { getBytes: () => this.bytes, getContentType: () => this.mime }; }
    moveTo(folder) { this.parent.files = this.parent.files.filter(f => f !== this); this.parent = folder; folder.files.push(this); this.t = 5000 + (++seq); return this; }
  }
  return { byId, Folder, File, api: { getFolderById: id => byId[id], getFileById: id => { if (!(byId[id] instanceof File)) throw new Error('no file ' + id); return byId[id]; } } };
}

describe('Remote EBoR signing: Save partial, ask, sign elsewhere, Finish', () => {
  let ctx, drive, log, folder, intake, tabs, who;
  const run = code => vm.runInContext(code, ctx);
  const call = req => { ctx.__req = req; return run('dispatch_(__req)'); };
  const sig = () => tabs['_Signatures'];
  const top = () => folder.files.map(f => f.name).sort();
  const archived = () => (folder.folders.find(f => f.name === 'Archive') || { files: [] }).files.map(f => f.name).sort();

  beforeEach(() => {
    seq = 0;
    drive = makeDrive();
    log = { sent: [], notes: [], council: [] };
    tabs = { '_Signatures': [], 'Uploads Log': [] };
    who = { s: 'ab@example.org', sam: 'sam@example.org', lee: 'lee@example.org', zed: 'zed@example.org' };
    ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
    for (const f of listJs(SRC).sort()) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
    folder = new drive.Folder('Teddy Sample - T999', null);
    intake = new drive.Folder('_Intake Queue', null);
    folder.files.push(new drive.File('Verified Eagle Application.pdf', 'application/pdf', [37, 80, 68, 70], folder));
    const rec = { recordId: 'R-1', section: 'ebor_booked', fields: { scout_name: 'Theodore Sample', unit: 'T999' } };
    const cache = {};
    const committee = [{ name: 'Pat Reviewer', initials: 'AB', email: 'ab@example.org', role: '' }];
    Object.assign(ctx, {
      DriveApp: drive.api,
      CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
      Utilities: { getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => Math.floor(Math.random() * 16).toString(16)),
        base64Decode: s => Array.from(Buffer.from(s, 'base64')), base64Encode: b => Buffer.from(b).toString('base64'), formatDate: () => '11/12/2026',
        newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
      Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
      SpreadsheetApp: { getActive: () => ({ getSheetByName: n => (tabs[n] ? {} : null) }) },
      getSettings_: () => ({ intakeFolderId: intake.id, committeeGroupEmail: GROUP, webOrigin: 'https://tracker.example.org', maxUploadMB: 20,
        signatureDays: 14, testMode: true, sections: [] }),
      todayYmd_: () => '2026-11-12',
      sessionEmail_: s => who[s],
      committeeMe_: s => { if (who[s] !== 'ab@example.org') throw Object.assign(new Error('not a member'), { userMessage: 'not a member' }); return { email: 'ab@example.org', me: committee[0], committee }; },
      committeeAll_: () => committee, committee_: () => committee,
      withLock_: fn => fn(),
      templateTabs_: () => null,
      sendMail_: m => { log.sent.push(m); return { send: true }; },
      Tabs: {
        read: n => (tabs[n] || []).map((r, i) => ({ ...r, _row: i + 2 })),
        append: (n, row) => { (tabs[n] = tabs[n] || []).push({ ...row }); return tabs[n].length + 1; },
        update: (n, rowNum, obj) => { Object.assign(tabs[n][rowNum - 2], obj); }
      },
      Records: { get: id => (id === 'R-1' ? rec : null), findByEmail: () => [] },
      units_: () => [],
      folderForRecord_: () => folder,
      addRecordNote_: (id, line) => { log.notes.push(line); },
      readSchedule_: () => ({ rows: [] }),
      stageColumns_: () => ({ ebor: 'ebor_date' }),
      draftCouncilPaperwork_: (c, r, ymd, files) => { log.council.push(files.map(f => f.name)); return { queued: true, id: 'OB-9' }; }
    });
    rec.fields.ebor_date = '2026-11-10';
  });

  const savePartial = () => {
    const st = call({ action: 'eborPaperworkStart', session: 's', recordId: 'R-1', boardYmd: '2026-11-10', partial: true,
      application: [{ name: 'Pat Reviewer', rep: true, signed: true }, { name: '', rep: true, signed: false }],
      report: [{ name: '', rep: true, signed: false }, { name: '', signed: false }, { name: '', signed: false }] });
    expect(st.error).toBeUndefined();
    for (const kind of ['application', 'report']) expect(call({ action: 'eborPaperworkUpload', uploadToken: st.uploadToken, kind, name: kind + '.pdf', data: PDF }).error).toBeUndefined();
    return call({ action: 'eborPaperworkSavePartial', session: 's', uploadToken: st.uploadToken });
  };
  const ask = () => call({ action: 'eborSignatureRequest', session: 's', recordId: 'R-1', signers: [
    { name: 'Sam Signer', email: 'Sam@Example.org', slots: ['application:rep', 'report:Signature1'], rep: true },
    { name: 'Lee Member', email: 'lee@example.org', slots: ['report:Signature2', 'report:Signature3'] }] });
  const sign = (s, base) => {
    const d = call({ action: 'signerDocs', session: s, recordId: 'R-1' });
    expect(d.error).toBeUndefined();
    const st = call({ action: 'signerStart', session: s, recordId: 'R-1', base: base || { application: d.files.application, report: d.files.report } });
    expect(st.error).toBeUndefined();
    for (const kind of st.kinds) expect(call({ action: 'signerUpload', uploadToken: st.uploadToken, kind, name: kind + '-' + s + '.pdf', data: PDF }).error).toBeUndefined();
    return { d, r: call({ action: 'signerFinish', session: s, uploadToken: st.uploadToken }) };
  };

  it('Save partial files two Partial copies, keeps the Verified Application, and records who signed in the room', () => {
    const r = savePartial();
    expect(r.error).toBeUndefined();
    expect(top()).toEqual(['Theodore_Sample-T999_AdvancementReport-Partial.pdf', 'Theodore_Sample-T999_EagleApplication-Partial.pdf', 'Verified Eagle Application.pdf'].sort());
    expect(sig()).toHaveLength(1);
    expect(sig()[0]).toMatchObject({ Name: 'Pat Reviewer', Slots: 'application:chair', Status: 'Signed', Email: '' });
    expect(r.status.missing.map(m => m.key)).toEqual(['application:rep', 'report:Signature1', 'report:Signature2', 'report:Signature3']);
  });

  it('asking emails each signer alone (never the group) and puts the address on file', () => {
    savePartial();
    const r = ask();
    expect(r.error).toBeUndefined();
    expect(log.sent.map(m => [m.to, m.cc || '', m.kind])).toEqual([['sam@example.org', '', 'private'], ['lee@example.org', '', 'private']]);
    expect(log.sent[0].body).toMatch(/https:\/\/tracker\.example\.org\/sign/);
    expect(log.sent[0].body).not.toMatch(/\?t=/);                     // no credential in the request email
    expect(run("whoIs_('sam@example.org').onFile")).toBe(true);
    expect(run("whoIs_('zed@example.org').onFile")).toBe(false);
    expect(ask().error).toMatch(/already asked of Sam Signer/);
  });

  it('signers sign in any order; a save on copies someone else changed is refused; the last one completes it', () => {
    savePartial(); ask();
    expect(call({ action: 'signerDocs', session: 'zed', recordId: 'R-1' }).error).toMatch(/Nothing is waiting/);
    const leeDocs = call({ action: 'signerDocs', session: 'lee', recordId: 'R-1' });
    expect(leeDocs.slots).toEqual({ application: [], report: ['Signature2', 'Signature3'] });
    const sam = sign('sam');
    expect(sam.r.error).toBeUndefined();
    expect(sam.r.complete).toBe(false);
    const stale = sign('lee', { application: leeDocs.files.application, report: leeDocs.files.report });
    expect(stale.r.error).toMatch(/Someone else saved/);
    const lee = sign('lee');
    expect(lee.r.error).toBeUndefined();
    expect(lee.r.complete).toBe(true);
    expect(sig().map(r => r.Status)).toEqual(['Signed', 'Signed', 'Signed']);
    expect(log.sent.at(-1)).toMatchObject({ to: 'ab@example.org', kind: 'private' });
    expect(log.sent.at(-1).subject).toMatch(/all signatures are in/);
    expect(archived().length).toBe(3);                                    // Sam replaced both, Lee the report
    expect(call({ action: 'signerDocs', session: 'sam', recordId: 'R-1' }).error).toMatch(/Nothing is waiting/);
    expect(run("whoIs_('sam@example.org').onFile")).toBe(false);          // access ends once signed
  });

  it('a wrong address is fixed (the old one loses access at once) or cancelled', () => {
    savePartial(); ask();
    const rowId = sig()[1]['Row ID'];
    const r = call({ action: 'eborSignatureEdit', session: 's', rowId, email: 'sam.new@example.org' });
    expect(r.error).toBeUndefined();
    expect(log.sent.at(-1).to).toBe('sam.new@example.org');
    expect(run("whoIs_('sam@example.org').onFile")).toBe(false);
    expect(run("whoIs_('sam.new@example.org').onFile")).toBe(true);
    call({ action: 'eborSignatureEdit', session: 's', rowId, cancel: true });
    expect(run("whoIs_('sam.new@example.org').onFile")).toBe(false);
    expect(call({ action: 'eborSignatureEdit', session: 'sam', rowId, cancel: true }).error).toMatch(/not a member/);
  });

  it('Finish files the -Signed copies, archives the Verified Application, closes the series and drafts the Council email', () => {
    savePartial(); ask();
    const early = call({ action: 'eborPaperworkFinishPartial', session: 's', recordId: 'R-1' });
    expect(early.needsConfirm).toBe(true);
    expect(early.warnings.join(' ')).toMatch(/Not signed yet/);
    sign('sam'); sign('lee');
    const r = call({ action: 'eborPaperworkFinishPartial', session: 's', recordId: 'R-1' });
    expect(r.error).toBeUndefined();
    expect(r.outboxId).toBe('OB-9');
    expect(top()).toEqual(['Theodore_Sample-T999_AdvancementReport-Signed.pdf', 'Theodore_Sample-T999_EagleApplication-Signed.pdf']);
    expect(archived()).toContain('Verified Eagle Application.pdf');
    expect(log.council).toEqual([['Theodore_Sample-T999_EagleApplication-Signed.pdf', 'Theodore_Sample-T999_AdvancementReport-Signed.pdf']]);
    expect(sig().every(r => r.Filed)).toBe(true);
    expect(call({ action: 'eborSignatureStatus', session: 's', recordId: 'R-1' }).requestId).toBe('');
  });

  it('Finish with signatures missing (confirmed) closes the pending requests', () => {
    savePartial(); ask();
    const r = call({ action: 'eborPaperworkFinishPartial', session: 's', recordId: 'R-1', confirm: true });
    expect(r.error).toBeUndefined();
    expect(sig().slice(1).map(x => x.Status)).toEqual(['Cancelled', 'Cancelled']);
    expect(run("whoIs_('lee@example.org').onFile")).toBe(false);
  });
});
