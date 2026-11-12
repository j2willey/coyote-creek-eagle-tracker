/**
 * Remote EBoR signing (Jim W., 2026-11-12; vault ebor-remote-signing-design.md). Rules in lib/signatures.js.
 *
 * When the board's paperwork can't all be signed in the room, the member saves it partly signed (Save partial), then asks
 * the other signers by email (Send for signatures). A signer signs in with that address (a pending row puts it on file,
 * lib/access.js), opens /sign, signs their own boxes in the browser and saves. Saves are checked against the copies the
 * signer opened, so several signers can sign at the same time. When every box is signed, the member who asked is told;
 * Finish (the paperwork page) files the copies as the standard -Signed names and drafts the Council email.
 *
 * Committee (EBoR paperwork page, Dev):
 *   eborPaperworkSavePartial {session, uploadToken, layout?}  -> {message, status}   after eborPaperworkStart {partial: true} + Uploads;
 *                                                                layout: {report: {Signature1: rect}} kept on the Partial copies (Drive description)
 *   eborSignatureStatus      {session, recordId}              -> status (see signatureStatus_)
 *   eborSignatureRequest     {session, recordId, signers: [{name, email, slots, rep}]} -> {message, status}
 *   eborSignatureEdit        {session, rowId, email?, name?, cancel?, resend?}       -> {message, status}
 *   eborPaperworkFinishPartial {session, recordId, confirm?}   -> {message, outboxId} | {needsConfirm, warnings}
 * Signer (/sign):
 *   signerChoices {session}                                     -> {email, items: [{recordId, scout, unit, boxes}]}
 *   signerDocs    {session, recordId}                           -> {scout, unit, boardYmd, name, slots, files, signedBy}
 *   signerFetch   {session, recordId, kind}                     -> {id, name, mime, modified, data}
 *   signerStart   {session, recordId, base, name}               -> {uploadToken}
 *   signerUpload  {uploadToken, kind, name, data}               -> {stored}
 *   signerFinish  {session, uploadToken}                        -> {message, complete}
 */
var SIGN_TOKEN_SECONDS = 2 * 3600;

function signatureRows_() {
  try { return Signatures.list(Tabs.read(Signatures.TAB)); } catch (e) { return []; }   // no tab yet (before Setup / repair): nobody pending
}

/** Pending, unexpired signature rows for an email (lib/access.js uses this to put the address on file). */
function openSignaturesFor_(email) {
  return Signatures.openFor(signatureRows_(), email, Date.now());
}

function signatureTab_() {
  if (!SpreadsheetApp.getActive().getSheetByName(Signatures.TAB)) throw userError_('No _Signatures tab yet: an Admin runs Admin → System → Setup / repair, then try again.');
}

function newSignatureId_(prefix) { return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + Utilities.getUuid().slice(0, 4).toUpperCase(); }

/** The Partial copies at the top of the Scout's folder: {application: {id, name, modified, file}, report: ...} (newest of each). */
function partialFiles_(folder) {
  var out = {};
  listFolder_(folder).forEach(function (x) {
    var kind = /_EagleApplication-Partial\.pdf$/i.test(x.name) ? 'application' : /_AdvancementReport-Partial\.pdf$/i.test(x.name) ? 'report' : '';
    if (!kind) return;
    var t = x.file.getLastUpdated().getTime();
    if (!out[kind] || t > out[kind].modified) out[kind] = { id: String(x.id), name: String(x.name), modified: t, file: x.file };
  });
  return out;
}
function baseOf_(files) {
  var o = {};
  Signatures.DOCS.forEach(function (d) { o[d] = files[d] ? { id: files[d].id, modified: files[d].modified } : { id: '', modified: 0 }; });
  return o;
}

function eborRecord_(recordId) {
  var rec = Records.get(String(recordId || ''));
  if (!rec || EBOR_SECTIONS_.indexOf(rec.section) < 0) throw userError_('That Scout is no longer at EBoR Booked or EBoR Paused. Reload the page.');
  return rec;
}

/** What the paperwork page shows for the Scout's signatures: the series, its rows, the Partial copies. */
function signatureStatus_(rec) {
  var now = Date.now(), rows = Signatures.series(signatureRows_(), rec.recordId), st = Signatures.state(rows, now);
  var folder = folderForRecord_(rec, false), files = folder ? partialFiles_(folder) : {};
  var fmt = function (t) { return t ? Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'M/d/yyyy') : ''; };
  return {
    recordId: rec.recordId, requestId: st.requestId, complete: st.complete, repOk: st.repOk, summary: Signatures.summary(st),
    missing: st.missing.map(function (k) { return { key: k, label: Signatures.slotLabel(k) }; }),
    slots: Signatures.slotKeys().map(function (k) { return { key: k, label: Signatures.slotLabel(k), signedBy: st.signed[k] ? st.signed[k].name : '' }; }),
    rows: rows.map(function (r) {
      return { id: r.id, name: r.name, email: r.email, keys: r.slots, slots: r.slots.map(Signatures.slotLabel), status: r.status === 'Pending' && !(r.expires > now) ? 'Expired' : r.status,
        asked: fmt(r.asked), signed: fmt(r.signed), expires: fmt(r.expires), room: !r.email };
    }),
    files: { application: files.application ? { id: files.application.id, name: files.application.name } : null,
      report: files.report ? { id: files.report.id, name: files.report.name } : null }
  };
}

// ---------- committee: Save partial ----------

function actionEborPaperworkSavePartial_(req) {
  var c = committeeMe_(req.session);
  var ctx = eborPaperworkContext_(req.uploadToken);
  if (!ctx.partial) throw userError_('This step was not started as a partial save. Please start again.');
  if (EborPaperwork.isDemo(ctx.recordId)) throw userError_('The Demo Scout can\'t be saved partly signed (it has no tracking row). Use a staging Scout.');
  signatureTab_();
  var rec = eborRecord_(ctx.recordId);
  var up = {};
  ctx.uploads.forEach(function (u) { up[u.kind] = u; });
  if (!up.application || !up.report) throw userError_('Both PDFs must arrive before saving. Please try again.');
  CacheService.getScriptCache().remove('ep:' + req.uploadToken);
  var by = c.me.initials || c.email, scout = String(rec.fields.scout_name || '');
  var room = Signatures.roomSigners(ctx.sign);
  var folder = folderForRecord_(rec, true);
  var names = Signatures.partialNames(EagleDone.fileNames(scout, rec.fields.unit, ctx.boardYmd, Intake.namePart, Intake.unitPart));
  var res = withLock_(function () {
    // 1. The two Partial copies (an earlier Partial goes to Archive; the Verified Application stays until Finish).
    var newIds = [];
    var layout = Signatures.layoutText(req.layout);
    ['application', 'report'].forEach(function (kind) {
      var f = DriveApp.getFileById(up[kind].fileId);
      f.setName(names[kind]);
      f.moveTo(folder);
      if (layout && f.setDescription) f.setDescription(layout);   // where the empty signature boxes are, for the signers' page
      newIds.push(f.getId());
    });
    var top = listFolder_(folder);
    var old = EborPaperwork.archivePlan(top.map(function (x) { return { id: x.id, name: x.name }; }), newIds, names, '');
    if (old.length) { var archive = childFolder_(folder, ScoutFiles.ARCHIVE); top.forEach(function (x) { if (old.indexOf(x.id) >= 0) x.file.moveTo(archive); }); }
    // 2. A new series: earlier open rows for this Scout are cancelled; the room's signers become Signed rows.
    var all = signatureRows_();
    Signatures.series(all, rec.recordId).forEach(function (r) {
      if (r.status === Signatures.STATUS.pending) Tabs.update(Signatures.TAB, r.row, { 'Status': Signatures.STATUS.cancelled, 'Note': 'replaced by a new Save partial' });
    });
    var requestId = newSignatureId_('SR');
    var rows = Signatures.newRows(room, { id: function () { return newSignatureId_('SG'); }, requestId: requestId, recordId: rec.recordId, scout: scout,
      askedBy: by, now: Date.now(), status: Signatures.STATUS.signed });
    if (!rows.length) {   // nobody signed in the room: still start the series (a placeholder row with no slots)
      rows = Signatures.newRows([{ name: '(nobody signed in the room)', slots: [] }], { id: function () { return newSignatureId_('SG'); }, requestId: requestId,
        recordId: rec.recordId, scout: scout, askedBy: by, now: Date.now(), status: Signatures.STATUS.signed });
    }
    rows.forEach(function (r) { Tabs.append(Signatures.TAB, r); });
    return { archived: old.length };
  });
  var line = Intake.shortDate(new Date()) + ' [' + by + '] EBoR paperwork saved partly signed (board ' + (EborPaperwork.mmddyy(ctx.boardYmd) || {}).text + '). ' +
    (room.length ? 'Signed in the room: ' + room.map(function (p) { return p.name; }).join(', ') : 'Nobody signed in the room') + '. Filed ' + names.application + ' and ' + names.report + '.';
  addRecordNote_(rec.recordId, line);
  return { message: scout + ': saved partly signed. Now send it to the other signers (below).' + (res.archived ? ' ' + res.archived + ' earlier copy(ies) to Archive.' : ''),
    status: signatureStatus_(rec) };
}

// ---------- committee: ask, edit, finish ----------

function actionEborSignatureStatus_(req) {
  committeeMe_(req.session);
  return signatureStatus_(eborRecord_(req.recordId));
}

/** The request email to one signer (template 4.4.a), To that signer only (kind private: never Cc the group). */
function sendSignatureRequest_(c, rec, row, boardYmd) {
  var s = getSettings_();
  var link = String(s.webOrigin || '').replace(/\/+$/, '') + '/sign';
  var d = EborPaperwork.parts(boardYmd);
  var vars = { signer: row.name, scout: String(rec.fields.scout_name || ''), unit: String(rec.fields.unit || ''),
    boardDate: d ? d.m + '/' + d.d + '/' + d.y : '(see the paperwork)', boxes: row.slots.map(function (k) { return '- ' + Signatures.slotLabel(k); }).join('\n'),
    member: String(c.me.name || c.email), link: link, days: String(Number(s.signatureDays) || 14) };
  var subject = 'Eagle Scout paperwork for ' + vars.scout + ': your signature is needed';
  var body = 'Hello ' + vars.signer + ',\n\n' + vars.member + ' of the District Advancement Committee asks you to sign the Eagle Scout paperwork for ' +
    vars.scout + ' (' + vars.unit + '), Board of Review on ' + vars.boardDate + ':\n\n' + vars.boxes + '\n\nTo sign: open ' + link +
    ' , enter this email address, and click the sign-in link we email you.\n\nThis request is open for ' + vars.days + ' days.';
  return mailFromTemplate_('Signature request', vars, { to: row.email, subject: subject, body: body, kind: 'private' });
}

function boardYmdFor_(rec) {
  try { var b = EborPaperwork.boardFor(readSchedule_().rows, rec.recordId, todayYmd_()); if (b) return b.ymd; } catch (e) { console.warn('boardYmdFor_: ' + e); }
  var cols = stageColumns_();
  return cols.ebor ? Intake.dateKey(rec.fields[cols.ebor]) : '';
}

function actionEborSignatureRequest_(req) {
  var c = committeeMe_(req.session);
  signatureTab_();
  var rec = eborRecord_(req.recordId);
  var by = c.me.initials || c.email, s = getSettings_();
  var added = withLock_(function () {
    var st = Signatures.state(Signatures.series(signatureRows_(), rec.recordId), Date.now());
    var ck = Signatures.checkRequest(req.signers, st, Identity.isValidEmail);
    if (ck.errors.length) throw userError_(ck.errors.join(' '));
    var rows = Signatures.newRows(ck.clean, { id: function () { return newSignatureId_('SG'); }, requestId: st.requestId, recordId: rec.recordId,
      scout: String(rec.fields.scout_name || ''), askedBy: by, now: Date.now(), days: s.signatureDays });
    rows.forEach(function (r) { Tabs.append(Signatures.TAB, r); });
    return ck.clean;
  });
  var boardYmd = boardYmdFor_(rec), failed = [];
  added.forEach(function (p) {
    try { sendSignatureRequest_(c, rec, p, boardYmd); } catch (e) { console.error('signature request mail: ' + e); failed.push(p.email); }
  });
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + by + '] EBoR paperwork sent for signatures: ' +
    added.map(function (p) { return p.name + ' (' + p.email + ': ' + p.slots.map(Signatures.slotLabel).join(', ') + ')'; }).join('; ') + '.');
  return { message: 'Asked ' + added.length + ' signer(s).' + (failed.length ? ' The email to ' + failed.join(', ') + ' could not be sent: use Resend.' : ''),
    status: signatureStatus_(rec) };
}

function actionEborSignatureEdit_(req) {
  var c = committeeMe_(req.session);
  signatureTab_();
  var by = c.me.initials || c.email;
  var out = withLock_(function () {
    var r = signatureRows_().filter(function (x) { return x.id === String(req.rowId || ''); })[0];
    if (!r) throw userError_('That signer is no longer on the list. Reload the page.');
    if (r.filed || r.status !== Signatures.STATUS.pending) throw userError_('Only a pending request can be changed (this one is ' + r.status + ').');
    var rec = eborRecord_(r.recordId);
    var upd = {}, what = [];
    if (req.cancel) { upd['Status'] = Signatures.STATUS.cancelled; upd['Note'] = 'cancelled by ' + by; what.push('cancelled ' + r.name); }
    else {
      var email = Identity.normalizeEmail(req.email == null ? r.email : req.email), name = String(req.name == null ? r.name : req.name).replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!Identity.isValidEmail(email)) throw userError_('Not an email address.');
      if (name.length < 2) throw userError_('Type the signer\'s name.');
      if (email !== r.email) { upd['Email'] = email; what.push(r.name + ': email ' + r.email + ' → ' + email); }
      if (name !== r.name) { upd['Name'] = name; what.push('name ' + r.name + ' → ' + name); }
      // A fixed address or a resend restarts the clock.
      if (upd['Email'] || req.resend) upd['Expires'] = new Date(Date.now() + (Number(getSettings_().signatureDays) || 14) * 86400000);
      if (req.resend && !upd['Email']) what.push('resent to ' + r.name);
    }
    if (!what.length) return { rec: rec, row: r, what: what, send: false };
    Tabs.update(Signatures.TAB, r.row, upd);
    return { rec: rec, row: { name: upd['Name'] || r.name, email: upd['Email'] || r.email, slots: r.slots }, what: what, send: !req.cancel && (!!upd['Email'] || !!req.resend) };
  });
  if (!out.what.length) return { message: 'Nothing changed.', status: signatureStatus_(out.rec) };
  if (out.send) sendSignatureRequest_(c, out.rec, out.row, boardYmdFor_(out.rec));
  addRecordNote_(out.rec.recordId, Intake.shortDate(new Date()) + ' [' + by + '] EBoR paperwork signatures: ' + out.what.join('; ') + '.');
  return { message: out.what.join('; ') + (out.send ? '. Email sent.' : '.'), status: signatureStatus_(out.rec) };
}

function actionEborPaperworkFinishPartial_(req) {
  var c = committeeMe_(req.session);
  var rec = eborRecord_(req.recordId);
  var now = Date.now(), rows = Signatures.series(signatureRows_(), rec.recordId), st = Signatures.state(rows, now);
  if (!st.requestId) throw userError_('Nothing is in progress for this Scout: there is no partly signed paperwork.');
  var folder = folderForRecord_(rec, true), files = partialFiles_(folder);
  if (!files.application || !files.report) throw userError_('The Partial copies are not in the Scout\'s folder any more (moved by hand?).');
  var warnings = [];
  if (st.missing.length) warnings.push('Not signed yet: ' + st.missing.map(Signatures.slotLabel).join('; ') + '.');
  Signatures.DOCS.forEach(function (d) { if (!st.repOk[d]) warnings.push(Signatures.DOC_LABEL[d] + ': no District Advancement Committee / Council representative has signed.'); });
  if (st.pending.length) warnings.push('Still waiting on: ' + st.pending.map(function (r) { return r.name; }).join(', ') + ' (their requests will be closed).');
  if (warnings.length && !req.confirm) return { needsConfirm: true, warnings: warnings };
  var by = c.me.initials || c.email, scout = String(rec.fields.scout_name || '');
  var boardYmd = boardYmdFor_(rec);
  var names = EagleDone.fileNames(scout, rec.fields.unit, boardYmd, Intake.namePart, Intake.unitPart);
  var filed = withLock_(function () {
    var out = {}, keep = [];
    Signatures.DOCS.forEach(function (d) { files[d].file.setName(names[d]); out[d] = { id: files[d].id, name: names[d] }; keep.push(files[d].id); });
    // Earlier -Signed copies and the Verified Application go to Archive (as the in-room Finish).
    var top = listFolder_(folder);
    var verified = EborPaperwork.pickVerified(top.map(function (x) { return { id: x.id, name: x.name, mime: 'application/pdf', modified: x.file.getLastUpdated().getTime() }; }));
    var toArchive = EborPaperwork.archivePlan(top.map(function (x) { return { id: x.id, name: x.name }; }), keep, names, verified ? verified.id : '');
    if (toArchive.length) { var archive = childFolder_(folder, ScoutFiles.ARCHIVE); top.forEach(function (x) { if (toArchive.indexOf(x.id) >= 0) x.file.moveTo(archive); }); }
    rows.forEach(function (r) {
      var upd = { 'Filed': new Date() };
      if (r.status === Signatures.STATUS.pending) { upd['Status'] = Signatures.STATUS.cancelled; upd['Note'] = 'closed at Finish by ' + by; }
      Tabs.update(Signatures.TAB, r.row, upd);
    });
    return { files: out, archived: toArchive.length };
  });
  var unit = Units.find(units_(), rec.fields.unit), res = null, note = '';
  try { res = draftCouncilPaperwork_(c, rec, boardYmd, [filed.files.application, filed.files.report], unit ? unit.contacts : [], stageColumns_()); }
  catch (e) { console.error('finish partial email: ' + (e && e.stack || e)); note = ' The Council email could not be drafted (' + e.message + '): use "Send signed paperwork to Council…" on the dashboard.'; }
  var queued = !!(res && res.queued);
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + by + '] EBoR paperwork filed after signing outside the room. ' + Signatures.summary(st) +
    '. Filed ' + names.application + ' and ' + names.report + (warnings.length ? ' (finished with missing signatures)' : '') +
    (queued ? '; Council email drafted in the Outbox' : '; no Council email drafted') + '.');
  return { message: scout + ': signed paperwork filed.' + (queued ? ' The Council email is ready in the Outbox.' : '') + note +
    ' The row has not moved: use Eagle earned… on the dashboard.', outboxId: queued ? res.id : '' };
}

// ---------- signer ----------

/** The signed-in signer and their open rows for one Scout (or all Scouts). Throws when nothing is waiting. */
function signerMe_(session, recordId) {
  var email = sessionEmail_(session);
  var rows = openSignaturesFor_(email).filter(function (r) { return !recordId || r.recordId === String(recordId); });
  if (recordId && !rows.length) throw userError_('Nothing is waiting for your signature for this Scout: it may have been signed, cancelled or expired. Reload the page.');
  return { email: email, rows: rows };
}

function slotsByDoc_(rows) {
  var all = [];
  rows.forEach(function (r) { r.slots.forEach(function (k) { if (all.indexOf(k) < 0) all.push(k); }); });
  return { application: Signatures.slotsOf('application', all), report: Signatures.slotsOf('report', all) };
}

function actionSignerChoices_(req) {
  var me = signerMe_(req.session, '');
  var by = {};
  me.rows.forEach(function (r) {
    var x = by[r.recordId] = by[r.recordId] || { recordId: r.recordId, scout: r.scout, unit: '', boxes: [] };
    r.slots.forEach(function (k) { x.boxes.push(Signatures.slotLabel(k)); });
  });
  Object.keys(by).forEach(function (k) { var rec = Records.get(k); if (rec) by[k].unit = String(rec.fields.unit || ''); });
  return { email: me.email, items: Object.keys(by).map(function (k) { return by[k]; }) };
}

function actionSignerDocs_(req) {
  var me = signerMe_(req.session, req.recordId);
  var rec = eborRecord_(req.recordId);
  var folder = folderForRecord_(rec, false), files = folder ? partialFiles_(folder) : {};
  if (!files.application || !files.report) throw userError_('The paperwork is not ready to sign yet. Please reply to the committee member who asked you.');
  var st = Signatures.state(Signatures.series(signatureRows_(), rec.recordId), Date.now());
  var signedBy = Object.keys(st.signed).map(function (k) { return { label: Signatures.slotLabel(k), name: st.signed[k].name }; });
  var slots = slotsByDoc_(me.rows);
  return {
    recordId: rec.recordId, scout: String(rec.fields.scout_name || ''), unit: String(rec.fields.unit || ''), boardYmd: boardYmdFor_(rec),
    name: me.rows[0].name, rep: me.rows.some(function (r) { return r.rep; }),
    slots: slots, labels: { application: EborPaperwork.signerSlots('application'), report: EborPaperwork.signerSlots('report') },
    files: { application: { id: files.application.id, name: files.application.name, modified: files.application.modified },
      report: { id: files.report.id, name: files.report.name, modified: files.report.modified } },
    signedBy: signedBy, maxUploadMB: Number(getSettings_().maxUploadMB) || 20,
    layout: Signatures.parseLayout(files.report.file.getDescription ? files.report.file.getDescription() : '')
  };
}

function actionSignerFetch_(req) {
  signerMe_(req.session, req.recordId);
  var kind = String(req.kind || '');
  if (Signatures.DOCS.indexOf(kind) < 0) throw userError_('Unknown document.');
  var rec = eborRecord_(req.recordId);
  var folder = folderForRecord_(rec, false), f = folder ? partialFiles_(folder)[kind] : null;
  if (!f) throw userError_('The paperwork is not ready to sign yet.');
  return { id: f.id, name: f.name, mime: 'application/pdf', modified: f.modified, data: Utilities.base64Encode(f.file.getBlob().getBytes()) };
}

function actionSignerStart_(req) {
  var me = signerMe_(req.session, req.recordId);
  var rec = eborRecord_(req.recordId);
  var name = String(req.name || me.rows[0].name).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2) throw userError_('Type your name as you signed.');
  var kinds = Signatures.DOCS.filter(function (d) { return slotsByDoc_(me.rows)[d].length; });
  var token = Identity.makeToken(Utilities.getUuid);
  CacheService.getScriptCache().put('sg:' + token, JSON.stringify({ recordId: rec.recordId, email: me.email, name: name, base: req.base || {}, kinds: kinds,
    batchId: 'SG-' + Date.now().toString(36).toUpperCase(), uploads: [] }), SIGN_TOKEN_SECONDS);
  return { uploadToken: token, kinds: kinds };
}

function signContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Session for this step not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('sg:' + token);
  if (!raw) throw userError_('This step expired. Please start again.');
  return JSON.parse(raw);
}

function actionSignerUpload_(req) {
  var ctx = signContext_(req.uploadToken);
  var kind = String(req.kind || '');
  if (ctx.kinds.indexOf(kind) < 0) throw userError_('You have no box to sign on that document.');
  if (!/\.pdf$/i.test(String(req.name || ''))) throw userError_('The signed documents must be PDFs.');
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  ctx.uploads = ctx.uploads.filter(function (u) { return u.kind !== kind; });
  var id = storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, rec.recordId, { name: String(req.name), tag: 'Other', data: req.data });
  ctx.uploads.push({ kind: kind, fileId: id });
  CacheService.getScriptCache().put('sg:' + req.uploadToken, JSON.stringify(ctx), SIGN_TOKEN_SECONDS);
  return { stored: String(req.name) };
}

function actionSignerFinish_(req) {
  var ctx = signContext_(req.uploadToken);
  var email = sessionEmail_(req.session);
  if (email !== ctx.email) throw userError_('Signed in as someone else. Please start again.');
  var rec = eborRecord_(ctx.recordId);
  var up = {};
  ctx.uploads.forEach(function (u) { up[u.kind] = u; });
  if (ctx.kinds.some(function (k) { return !up[k]; })) throw userError_('Your signed copy did not arrive. Please try again.');
  var folder = folderForRecord_(rec, true);
  var res = withLock_(function () {
    var mine = openSignaturesFor_(email).filter(function (r) { return r.recordId === rec.recordId; });
    if (!mine.length) throw userError_('Nothing is waiting for your signature for this Scout any more (signed, cancelled or expired).');
    var files = partialFiles_(folder);
    var changed = Signatures.baseChanged(ctx.base, baseOf_(files));
    if (changed) throw userError_(changed + ' Reloading: your signature stays placed, then save again.');
    // The signer's copies replace the Partials (the old ones go to Archive); their rows → Signed.
    var archive = null;
    ctx.kinds.forEach(function (kind) {
      var f = DriveApp.getFileById(up[kind].fileId);
      f.setName(files[kind].name);
      f.moveTo(folder);
      try { var desc = files[kind].file.getDescription && files[kind].file.getDescription(); if (desc && f.setDescription) f.setDescription(desc); } catch (e) { /* layout is a convenience */ }
      archive = archive || childFolder_(folder, ScoutFiles.ARCHIVE);
      files[kind].file.moveTo(archive);
    });
    mine.forEach(function (r) { Tabs.update(Signatures.TAB, r.row, { 'Status': Signatures.STATUS.signed, 'Signed': new Date(), 'Name': ctx.name }); });
    var st = Signatures.state(Signatures.series(signatureRows_(), rec.recordId), Date.now());
    return { mine: mine, st: st };
  });
  CacheService.getScriptCache().remove('sg:' + req.uploadToken);
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + ctx.name + '] signed the EBoR paperwork outside the room: ' +
    res.mine.map(function (r) { return r.slots.map(Signatures.slotLabel).join(', '); }).join(', ') + (res.st.complete ? '. Every box is signed.' : '. ' + Signatures.summary(res.st)) + '.');
  if (res.st.complete || !res.st.pending.length) notifySignaturesDone_(rec, res.mine[0].askedBy, res.st.complete);
  return { message: 'Thank you: your signature is saved.' + (res.st.complete ? ' Every signature is in; the committee will file the paperwork.' : ''), complete: res.st.complete };
}

/** Close the Scout's open series (in-room Finish after a partial save): every row Filed, pending ones Cancelled. */
function closeSignatureSeries_(recordId, by) {
  try {
    if (!SpreadsheetApp.getActive().getSheetByName(Signatures.TAB)) return;
    withLock_(function () {
      Signatures.series(signatureRows_(), recordId).forEach(function (r) {
        var upd = { 'Filed': new Date() };
        if (r.status === Signatures.STATUS.pending) { upd['Status'] = Signatures.STATUS.cancelled; upd['Note'] = 'closed when ' + by + ' filed the paperwork'; }
        Tabs.update(Signatures.TAB, r.row, upd);
      });
    });
  } catch (e) { console.warn('closeSignatureSeries_: ' + e); }
}

/** The member who asked hears once every box is signed (or nobody is left to ask). */
function notifySignaturesDone_(rec, askedBy, complete) {
  try {
    var s = getSettings_();
    var m = committeeAll_().filter(function (x) { return String(x.initials) === String(askedBy) || String(x.email).toLowerCase() === String(askedBy).toLowerCase(); })[0];
    var to = m ? m.email : s.adminEmail;
    if (!to) return;
    var link = String(s.webOrigin || '').replace(/\/+$/, '') + '/committee/ebor-paperwork';
    var scout = String(rec.fields.scout_name || '');
    mailFromTemplate_('Signatures complete', { scout: scout, link: link }, { to: to, kind: 'private',
      subject: 'Eagle Scout paperwork for ' + scout + ': ' + (complete ? 'all signatures are in' : 'nobody left to ask'),
      body: (complete ? 'Every signature on the Eagle Scout paperwork for ' + scout + ' is in.' : 'No signer is left to ask for ' + scout + ', but some boxes are still empty.') +
        '\n\nOpen the EBoR paperwork page, check both documents and click Finish: ' + link });
  } catch (e) { console.error('notifySignaturesDone_: ' + e); }
}
