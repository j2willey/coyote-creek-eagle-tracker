/**
 * EBoR paperwork page (/committee/ebor-paperwork, Task 12, Jim W., 2026-11-11). Committee members only. Rules in
 * lib/eborPaperwork.js; the page signs both documents in the browser (Sign Workshop engine), then files them here.
 *
 * Router actions:
 *   eborPaperworkChoices  {session}                -> {me, today, scouts, selected, slots, repLabel, committee, settings, testMode}
 *   eborPaperworkScout    {session, recordId}      -> {name, unit, board, suggestions, fields, verified, pdfs, folderUrl, ...}
 *   eborPaperworkTemplate {session}                -> {name, mime, data (base64)}   the blank Advancement Report (Settings)
 *   eborPaperworkStart    {session, recordId, boardYmd, application: [signer], report: [signer], verifiedId}
 *                                                  -> {uploadToken}   (signer: {name, rep, signed})
 *   eborPaperworkUpload   {uploadToken, kind: application|report, name, data (base64)} -> {stored}
 *   eborPaperworkFinish   {session, uploadToken}   -> {message, outboxId}
 *
 * Finish: both signed PDFs go to the Scout's folder as <Name>-<Unit>_EagleApplication-Signed.pdf and
 * _AdvancementReport-Signed.pdf (the names Eagle earned uses); the Verified Application and earlier versions move to
 * Archive; the "Council: Eagle paperwork" email is drafted in the Outbox (rowActions.js draftCouncilPaperwork_). The row
 * does NOT move: Eagle earned stays its own step and finds the files already there.
 */
var EBOR_PAPERWORK_TOKEN_SECONDS = 2 * 3600;
var EBOR_SECTIONS_ = ['ebor_booked', 'ebor_paused'];

function eborRecords_() {
  return Records.all(['scout_name', 'preferred_name', 'unit']).filter(function (r) { return EBOR_SECTIONS_.indexOf(r.section) >= 0; })
    .map(function (r) { return { recordId: r.recordId, section: r.section, name: String(r.scout_name || ''), unit: String(r.unit || '') }; });
}

function actionEborPaperworkChoices_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var today = todayYmd_();
  var recs = eborRecords_(), boards = {};
  try {
    var rows = readSchedule_().rows;
    recs.forEach(function (r) { boards[r.recordId] = EborPaperwork.boardFor(rows, r.recordId, today); });
  } catch (e) { console.warn('ebor paperwork schedule: ' + e); }
  var ch = EborPaperwork.choices(recs, boards, function (k) { return SettingsModel.sectionLabel(s, k); });
  return {
    me: { name: String(c.me.name || ''), initials: String(c.me.initials || ''), email: c.email },
    today: today, scouts: ch.scouts, selected: ch.selected,
    slots: { application: EborPaperwork.signerSlots('application'), report: EborPaperwork.signerSlots('report') },
    repLabel: EborPaperwork.REP_LABEL, signatureFields: EborPaperwork.SIGNATURE_FIELDS,
    committee: c.committee.filter(function (m) { return String(m.name || '').trim(); }).map(function (m) { return { name: String(m.name), initials: String(m.initials || '') }; }),
    settings: { templateSet: !!String(s.advancementReportTemplateId || '').trim(), districtName: String(s.districtName || ''), advancementTitle: String(s.advancementTitle || '') },
    maxUploadMB: Number(s.maxUploadMB) || 20,
    testMode: s.testMode !== false
  };
}

/** The Scout's unit leader (name + address) from the Key 3 tab, else a Unit Leader on Unit Contacts. */
function unitLeaderFor_(unit) {
  var code = Units.code(unit);
  var out = { name: '', address: '', city: '', state: '', zip: '' };
  if (!code) return out;
  try {
    var k = UnitDirectory.key3For(key3Rows_(), code).filter(function (x) { return x.role === 'Unit Leader'; })[0];
    if (k) return { name: k.name, address: k.address, city: k.city, state: k.state, zip: k.zip };
  } catch (e) { console.warn('unitLeaderFor_ key3: ' + e); }
  try {
    var l = UnitDirectory.contactsFor(readTabOrEmpty_(UNIT_CONTACTS_TAB), code).filter(function (x) { return x.role.toLowerCase() === 'unit leader' && x.name; })[0];
    if (l) out.name = l.name;
  } catch (e) { console.warn('unitLeaderFor_ contacts: ' + e); }
  return out;
}

/** Top-level files of the Scout's folder for the paperwork page: id, name, mime, bytes, date, modified (ms). Google Docs left out. */
function paperworkFiles_(folder) {
  var tz = Session.getScriptTimeZone();
  return listFolder_(folder)
    .filter(function (x) { return String(x.file.getMimeType() || '').indexOf('application/vnd.google-apps') !== 0; })
    .map(function (x) {
      return { id: String(x.id), name: String(x.name || ''), mime: String(x.file.getMimeType() || ''), bytes: Number(x.file.getSize()) || 0,
        date: Utilities.formatDate(x.file.getLastUpdated(), tz, 'M/d/yyyy'), modified: x.file.getLastUpdated().getTime() };
    });
}

function actionEborPaperworkScout_(req) {
  committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec || EBOR_SECTIONS_.indexOf(rec.section) < 0) throw userError_('That Scout is no longer at EBoR Booked or EBoR Paused. Reload the page.');
  var s = getSettings_(), today = todayYmd_();
  var scout = String(rec.fields.scout_name || ''), unit = String(rec.fields.unit || '');
  var board = null;
  try { board = EborPaperwork.boardFor(readSchedule_().rows, rec.recordId, today); } catch (e) { console.warn('ebor paperwork board: ' + e); }
  // The board's date: the schedule row is the source of truth; the tracking EBoR date is the fallback.
  var cols = stageColumns_();
  var boardYmd = (EborPaperwork.parts(req.boardYmd) ? String(req.boardYmd) : '') || (board && board.ymd) || (cols.ebor ? Intake.dateKey(rec.fields[cols.ebor]) : '') || '';
  var committee = [];
  try { committee = committee_(); } catch (e) { /* suggestions only */ }
  var suggestions = { district: [], unit: [] };
  if (board) {
    suggestions.district = Booking.resolveWho(board.reps, committee).names;
    suggestions.unit = Units.parseBoard(board.boardMembers).map(function (m) { return m.name; }).filter(String);
  }
  var leader = unitLeaderFor_(unit);
  var fill = EborPaperwork.reportFields({ scout: scout, unit: unit, district: s.districtName, title: s.advancementTitle, leaderName: leader.name,
    address: leader.address, city: leader.city, state: leader.state, zip: leader.zip, boardYmd: boardYmd });
  var folder = folderForRecord_(rec, false), files = folder ? paperworkFiles_(folder) : [];
  var verified = EborPaperwork.pickVerified(files);
  var names = EagleDone.fileNames(scout, unit, boardYmd, Intake.namePart, Intake.unitPart);
  var ex = existingSigned_(rec);
  return {
    recordId: rec.recordId, name: scout, unit: unit, stage: SettingsModel.sectionLabel(s, rec.section),
    boardYmd: boardYmd, boardTime: board ? board.time : '', suggestions: suggestions,
    requirement7: EborPaperwork.mmddyy(boardYmd),
    fields: fill.text, radio: fill.radio, problems: fill.problems,
    leader: { name: leader.name, hasAddress: !!(leader.address || leader.city || leader.zip) },
    folderUrl: folder ? 'https://drive.google.com/drive/folders/' + folder.getId() : '',
    verifiedId: verified ? verified.id : '',
    pdfs: EborPaperwork.pdfChoices(files),
    fileNames: { application: names.application, report: names.report },
    alreadySigned: { application: !!ex.application, report: !!ex.report },
    councilEmail: String(s.councilEaglesEmail || '')
  };
}

function actionEborPaperworkTemplate_(req) {
  committeeMe_(req.session);
  var id = String(getSettings_().advancementReportTemplateId || '').trim();
  if (!id) throw userError_('Settings → advancementReportTemplateId is empty: put the Drive file id of the blank Advancement Report (form 34403) there.');
  var file;
  try { file = DriveApp.getFileById(id); }
  catch (e) { throw userError_('The Advancement Report template could not be opened. Check Settings → advancementReportTemplateId and that the tool\'s account can see that file.'); }
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (!(bytes.length > 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) {
    throw userError_('The Advancement Report template is not a PDF file.');
  }
  return { name: String(file.getName() || 'Advancement Report.pdf'), mime: 'application/pdf', data: Utilities.base64Encode(bytes) };
}

function eborPaperworkContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Session for this step not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('ep:' + token);
  if (!raw) throw userError_('This step expired. Please start again.');
  return JSON.parse(raw);
}

function actionEborPaperworkStart_(req) {
  var c = committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec || EBOR_SECTIONS_.indexOf(rec.section) < 0) throw userError_('That Scout is no longer at EBoR Booked or EBoR Paused. Reload the page.');
  var boardYmd = String(req.boardYmd || '');
  if (!EborPaperwork.parts(boardYmd)) throw userError_('The EBoR date is missing. Pick it on the page.');
  var app = EborPaperwork.checkSigners('application', req.application);
  var rep = EborPaperwork.checkSigners('report', req.report);
  var errors = app.errors.concat(rep.errors);
  if (errors.length) throw userError_(errors.join(' '));
  var token = Identity.makeToken(Utilities.getUuid);
  CacheService.getScriptCache().put('ep:' + token, JSON.stringify({ recordId: rec.recordId, boardYmd: boardYmd, email: c.email,
    sign: { application: app.clean, report: rep.clean }, verifiedId: String(req.verifiedId || ''), batchId: 'EP-' + Date.now().toString(36).toUpperCase(), uploads: [] }),
    EBOR_PAPERWORK_TOKEN_SECONDS);
  return { uploadToken: token };
}

function actionEborPaperworkUpload_(req) {
  var ctx = eborPaperworkContext_(req.uploadToken);
  var kind = String(req.kind || '');
  if (['application', 'report'].indexOf(kind) < 0) throw userError_('Unknown file.');
  var name = String(req.name || '');
  if (!/\.pdf$/i.test(name)) throw userError_('The signed documents must be PDFs.');
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  ctx.uploads = ctx.uploads.filter(function (u) { return u.kind !== kind; });          // a second try replaces the first
  var id = storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, rec.recordId, { name: name, tag: 'Other', data: req.data });
  ctx.uploads.push({ kind: kind, fileId: id, name: name });
  CacheService.getScriptCache().put('ep:' + req.uploadToken, JSON.stringify(ctx), EBOR_PAPERWORK_TOKEN_SECONDS);
  return { stored: name };
}

function actionEborPaperworkFinish_(req) {
  var c = committeeMe_(req.session);
  var ctx = eborPaperworkContext_(req.uploadToken);
  var rec = Records.get(ctx.recordId);
  if (!rec || EBOR_SECTIONS_.indexOf(rec.section) < 0) throw userError_('That Scout is no longer at EBoR Booked or EBoR Paused. Reload the page.');
  var up = {};
  ctx.uploads.forEach(function (u) { up[u.kind] = u; });
  if (!up.application || !up.report) throw userError_('Both signed PDFs must arrive before filing. Please try again.');
  CacheService.getScriptCache().remove('ep:' + req.uploadToken);
  var s = getSettings_();
  var scout = String(rec.fields.scout_name || '');
  var by = c.me.initials || c.email;

  // 1. File both under the standard names; the Verified Application and earlier versions go to Archive.
  var folder = folderForRecord_(rec, true);
  var names = EagleDone.fileNames(scout, rec.fields.unit, ctx.boardYmd, Intake.namePart, Intake.unitPart);
  var filed = {}, newIds = [];
  ['application', 'report'].forEach(function (kind) {
    var f = DriveApp.getFileById(up[kind].fileId);
    f.setName(names[kind]);
    f.moveTo(folder);
    filed[kind] = { id: f.getId(), name: f.getName() };
    newIds.push(f.getId());
  });
  var top = listFolder_(folder);
  var toArchive = EborPaperwork.archivePlan(top.map(function (x) { return { id: x.id, name: x.name }; }), newIds, names, ctx.verifiedId);
  if (toArchive.length) {
    var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
    top.forEach(function (x) { if (toArchive.indexOf(x.id) >= 0) x.file.moveTo(archive); });
  }

  // 2. The Council email, as an Outbox draft (the existing path); "signed paperwork sent" is filled when it is sent.
  var unit = Units.find(units_(), rec.fields.unit);
  var res = null, note = '';
  try { res = draftCouncilPaperwork_(c, rec, ctx.boardYmd, [filed.application, filed.report], unit ? unit.contacts : [], stageColumns_()); }
  catch (e) { console.error('ebor paperwork email: ' + (e && e.stack || e)); note = ' The Council email could not be drafted (' + e.message + '): use "Send signed paperwork to Council…" on the dashboard.'; }
  var queued = !!(res && res.queued);
  if (res && !queued) note = ' No Council email was drafted (' + (res.reason || 'template Off') + ').';
  if (!String(s.councilEaglesEmail || '').trim()) note += ' Settings → councilEaglesEmail is empty: add the address in the Outbox.';

  // 3. Log (Notes cell + Life to Eagle Log + digest).
  addRecordNote_(rec.recordId, EborPaperwork.logLine(Intake.shortDate(new Date()), by, ctx.boardYmd, ctx.sign,
    [names.application, names.report], toArchive.length, queued));
  var msg = scout + ': signed Eagle application and Advancement Report filed' + (toArchive.length ? ' (' + toArchive.length + ' earlier file(s) to Archive)' : '') + '.' +
    (queued ? ' The Council email is ready in the Outbox.' : '') + note + ' The row has not moved: use Eagle earned… on the dashboard when the board is done.';
  return { message: msg, outboxId: queued ? res.id : '' };
}
