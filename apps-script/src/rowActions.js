/**
 * Dashboard row actions (committee members). Rules in lib/stageActions.js (what each action does) and
 * lib/eagleDone.js (Eagle earned in one step, folder placement).
 *
 * Router actions:
 *   rowAction    {session, recordId, kind, date, note, files: [kinds], confirm}
 *                -> {needsConfirm, warnings} | {message, outboxId} | {uploadToken} (when files are coming)
 *   uploadRowFile {uploadToken, kind: application|report|photo, name, data (base64)} -> {stored}
 *   rowFinish    {session, uploadToken} -> {message, outboxId}
 *
 * Records the dates, moves the row, logs it, stops the "new files" clock, files any uploads, and sends or drafts the
 * action's emails. A "when sent" column (Emailed to set up EBoR, signed paperwork sent) is filled by the Outbox.
 */
var ROW_TOKEN_SECONDS = 2 * 3600;

function stageColumns_() { return StageActions.resolveColumns(Records.columns(), getSettings_()); }

/** Validate an action for a record. -> {a, rec, cols, dates, p, unit, warnings} (throws user errors). */
function rowCheck_(req) {
  var a = StageActions.get(String(req.kind || ''));   // req.action is the router's action name
  if (!a || a.page) throw userError_('Unknown action. Reload the page.');
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var cols = stageColumns_();
  var dates = {};
  Object.keys(cols).forEach(function (role) { if (cols[role]) dates[role] = Intake.dateKey(rec.fields[cols[role]]) || ''; });
  var p = StageActions.plan({ action: a.key, section: rec.section, date: req.date, today: todayYmd_(), dates: dates, cols: cols,
    note: req.note, pending: Pending.isPending(rec.fields[Pending.COLUMN]), files: a.files ? (req.files || []) : undefined });
  if (p.errors.length) throw userError_(p.errors.join(' '));
  var unit = (a.toUnit || a.eagleDone) ? Units.find(units_(), rec.fields.unit) : null;
  var warnings = p.warnings.slice();
  if ((a.toUnit || a.eagleDone) && (!unit || !unit.contacts.length)) {
    warnings.push('No unit contacts for ' + (rec.fields.unit || 'this unit') + ' (Key 3 / Unit Contacts tabs): add the unit leader in the Outbox if you know it.');
  }
  if (a.eagleDone && !String(getSettings_().councilEaglesEmail || '').trim()) {
    warnings.push('Settings → councilEaglesEmail is empty: the Council paperwork email will have no address (add it in the Outbox).');
  }
  return { a: a, rec: rec, cols: cols, dates: dates, p: p, unit: unit, warnings: warnings };
}

function actionRowAction_(req) {
  var c = committeeMe_(req.session);
  var ck = rowCheck_(req);
  if (ck.warnings.length && !req.confirm) return { needsConfirm: true, warnings: ck.warnings };
  if (ck.a.files && (req.files || []).length) {
    var token = Identity.makeToken(Utilities.getUuid);
    CacheService.getScriptCache().put('rw:' + token, JSON.stringify({ req: { recordId: ck.rec.recordId, kind: ck.a.key, date: req.date,
      note: String(req.note || '').slice(0, 2000), files: req.files }, email: c.email, batchId: 'E-' + Date.now().toString(36).toUpperCase(),
      uploads: [] }), ROW_TOKEN_SECONDS);
    return { uploadToken: token };
  }
  return rowExecute_(c, ck, req, []);
}

function rowContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Session for this step not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('rw:' + token);
  if (!raw) throw userError_('This step expired. Please start again.');
  return JSON.parse(raw);
}

function actionUploadRowFile_(req) {
  var ctx = rowContext_(req.uploadToken);
  var kind = String(req.kind || '');
  if (['application', 'report', 'photo'].indexOf(kind) < 0) throw userError_('Unknown file.');
  var name = String(req.name || '');
  if (kind !== 'photo' && !/\.pdf$/i.test(name)) throw userError_('The signed scans must be PDFs.');
  if (kind === 'photo' && !/\.(jpe?g|png)$/i.test(name)) throw userError_('Photos must be JPEG or PNG.');
  if (ctx.uploads.length >= 25) throw userError_('At most 25 files at a time.');
  var rec = Records.get(ctx.req.recordId);
  if (!rec) throw userError_('Record not found.');
  var id = storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, rec.recordId,
    { name: name, tag: kind === 'photo' ? 'Photo' : 'Other', data: req.data });
  ctx.uploads.push({ kind: kind, fileId: id, name: name });
  CacheService.getScriptCache().put('rw:' + req.uploadToken, JSON.stringify(ctx), ROW_TOKEN_SECONDS);
  return { stored: name };
}

function actionRowFinish_(req) {
  var c = committeeMe_(req.session);
  var ctx = rowContext_(req.uploadToken);
  var ck = rowCheck_(ctx.req);                                // the sheet may have changed meanwhile
  var kinds = ctx.uploads.map(function (u) { return u.kind; });
  (ck.a.requireFiles || []).forEach(function (k) { if (kinds.indexOf(k) < 0) throw userError_('The ' + StageActions.FILE_LABELS[k] + ' did not arrive. Please try again.'); });
  CacheService.getScriptCache().remove('rw:' + req.uploadToken);
  return rowExecute_(c, ck, ctx.req, ctx.uploads);
}

/** Paint one tracking cell (the old "EBoR done" green). */
function paintCell_(recordId, column, color) {
  try {
    var sh = getTrackingSheet_();
    var m = SheetModel.findMachineRow(sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues());
    var rec = Records.get(recordId);
    if (!m || !rec || m.map[column] === undefined) return;
    sh.getRange(rec.row, m.map[column] + 1).setBackground(color);
  } catch (e) { console.warn('paintCell_: ' + e); }
}

/** The Scout's last EBoR slot on the schedule (past or future): reps and Unit Board Members. */
function lastEborSlot_(recordId) {
  var rows = [];
  try { rows = readSchedule_().rows; } catch (e) { return null; }
  var mine = rows.filter(function (r) { return String(r.record_id || '').trim() === recordId && Booking.typeCode(r.slot_type) === 'EBoR'; })
    .map(function (r) { return { r: r, start: Booking.slotStart(r.date, r.time) || 0 }; })
    .sort(function (x, y) { return y.start - x.start; });
  return mine.length ? mine[0].r : null;
}

function rowExecute_(c, ck, req, uploads) {
  var s = getSettings_();
  var a = ck.a, rec = ck.rec, p = ck.p, cols = ck.cols, unit = ck.unit;
  var by = c.me.initials || c.email;
  var scout = String(rec.fields.scout_name || '');

  // "✓ Checked": only stops the new-files clock.
  if (a.key === 'checked') {
    clearPending_(rec.recordId, by, 'no change' + (String(req.note || '').trim() ? '; ' + String(req.note).trim() : ''));
    return { message: scout + ': new files marked as checked.', outboxId: '' };
  }

  // 1. Dates / flags, row, log.
  var upd = {};
  Object.keys(p.set).forEach(function (role) { upd[cols[role]] = ymdToDate_(p.set[role]); });
  if (a.setTrue) upd[cols[a.setTrue]] = String(s.svmbcReceivedMark || '*');   // the sheet's own mark for "received"
  if (Object.keys(upd).length) Records.update(rec.recordId, upd);
  if (p.to) Records.move(rec.recordId, p.to);
  if (a.paint && cols[a.paint] && String(s.eborDoneColor || '').trim()) paintCell_(rec.recordId, cols[a.paint], String(s.eborDoneColor).trim());
  var checked = clearPending_(rec.recordId);
  if (a.email === 'note') saveRequest_(rec.recordId, p.to || rec.section, req.note);
  var msg = scout + ': ' + a.past + (a.dateRole ? ' (' + StageActions.nice(req.date) + ')' : '') +
    (p.to ? '; moved to ' + SettingsModel.sectionLabel(s, p.to) : '') + '.';

  // 2. Files (Eagle earned / paperwork): signed scans into the folder, photos into "EBoR Photos".
  var filed = { application: null, report: null, photos: [] };
  if (uploads.length) {
    var r2 = Records.get(rec.recordId) || rec;
    var folder = folderForRecord_(r2, true);
    var eborYmd = cols.ebor ? (Intake.dateKey(r2.fields[cols.ebor]) || todayYmd_()) : todayYmd_();
    var names = EagleDone.fileNames(r2.fields.scout_name, r2.fields.unit, eborYmd, Intake.namePart, Intake.unitPart);
    var photoFolder = null, n = 0;
    uploads.forEach(function (u) {
      var f = DriveApp.getFileById(u.fileId);
      if (u.kind === 'photo') {
        if (!photoFolder) { photoFolder = childFolder_(folder, 'EBoR Photos'); var it = photoFolder.getFiles(); while (it.hasNext()) { it.next(); n++; } }
        n++;
        f.setName(names.photo(n)); f.moveTo(photoFolder);
        filed.photos.push({ id: f.getId(), name: f.getName() });
      } else {
        f.setName(names[u.kind]); f.moveTo(folder);
        filed[u.kind] = { id: f.getId(), name: f.getName() };
      }
    });
    msg += ' Filed: ' + [filed.application && 'application', filed.report && 'Advancement Report',
      filed.photos.length && filed.photos.length + ' photo' + (filed.photos.length > 1 ? 's' : '')].filter(Boolean).join(', ') + '.';
  }
  addRecordNote_(rec.recordId, StageActions.logLine(Intake.shortDate(new Date()), by, a.key, req.date, req.note) +
    (filed.application ? '; signed scans filed' : '') + (filed.photos.length ? '; ' + filed.photos.length + ' EBoR photo(s) filed' : '') +
    (checked ? '; new files checked' : ''));

  // 3. Emails.
  var outboxIds = [], notes = [];
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail);   // To the Scout, Cc the parent/guardian + committee
  var unitContacts = unit ? unit.contacts : [];
  var record = function (res) {
    if (!res) return;
    if (res.queued) outboxIds.push(res.id);
    else if (res.send) notes.push('email sent');
    else notes.push('no email (' + (res.reason || 'template Off') + ')');
  };
  // Eagles to Date (2026-11-01): +1 on each of the Scout's units that keeps a count, before the emails use it.
  var eagleNums = [];
  if (a.key === 'eagle_earned') {
    try { eagleNums = bumpEagleCounts_(rec, by); } catch (e) { console.warn('bumpEagleCounts_: ' + e); notes.push('Eagles to Date not updated: ' + e.message); }
    if (eagleNums.length) msg += ' ' + EagleCount.phrase(eagleNums).replace(/^./, function (ch) { return ch.toUpperCase(); }) + '.';
  }
  if (a.eagleDone) {
    var after = Records.get(rec.recordId) || rec;
    var boardYmd = cols.ebor ? (Intake.dateKey(after.fields[cols.ebor]) || req.date) : req.date;
    var common = { scout: scout, firstName: EagleDone.firstName(scout, rec.fields.preferred_name), unitName: EagleDone.unitName(rec.fields.unit),
      date: EagleDone.longDate(boardYmd), senderName: String(c.me.name || c.email),
      photosLine: filed.photos.length ? 'Photos from your Board of Review are attached.' : '',
      eagleNumberLine: EagleCount.emailLine(eagleNums) };
    // Council: signed paperwork (when both scans are here).
    if (filed.application && filed.report) {
      var cp = reviewBuiltIn_(TemplateCatalog.get('Council: Eagle paperwork'), common);
      record(mailFromTemplate_('Council: Eagle paperwork', common, {
        committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout,
        to: [String(s.councilEaglesEmail || '')].filter(String), cc: [s.committeeGroupEmail].concat(unitContacts).filter(String).join(', '),
        subject: cp.subject, body: cp.body, attachments: [filed.application, filed.report],
        onSent: cols.signedSent ? { column: cols.signedSent, label: StageActions.COLUMNS.signedSent.label } : null }));
    }
    // Congratulations: Scout, family, unit, the board (district reps + Unit Board Members), others to invite.
    if (a.key === 'eagle_earned') {
      var slot = lastEborSlot_(rec.recordId);
      var reps = slot ? Booking.resolveWho(Booking.splitWho(slot.reps), committee_()).emails : [];
      var board = slot ? Units.parseBoard(slot.board_members).map(function (m) { return m.email; }) : [];
      var others = Units.parseCc(rec.fields._cc).map(function (x) { return x.email; });
      // To the new Eagle; Cc the parent, unit, the board, others to invite and the committee.
      var cg = familyMsg_(rec.fields, [].concat(unitContacts, reps, board, others, [s.committeeGroupEmail]));
      var gp = reviewBuiltIn_(TemplateCatalog.get('New Eagle Scout'), common);
      record(mailFromTemplate_('New Eagle Scout', common, {
        committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout, to: cg.to, cc: cg.cc, keepCc: cg.keepCc,
        subject: gp.subject, body: gp.body, attachments: filed.photos }));
    }
  } else if (a.booking) {
    var online = Booking.onlineType(p.to || rec.section, s);
    if (online) {
      record(sendBookingInvite_(Records.get(rec.recordId) || rec, a.booking, c.email));     // like the sheet's Action: template Mode decides
    } else {
      var key = 'Book: ' + Booking.label(a.booking);
      var bv = { scout: scout, pageLink: pageUrl_(), scheduleLink: String((a.booking === 'ESSPPR' && s.reviewSignupUrl) || s.eborSignupUrl || '') };
      var bp = reviewBuiltIn_(TemplateCatalog.get(key), bv);
      record(mailFromTemplate_(key, bv, { committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout,
        to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: bp.subject, body: bp.body }));
    }
  } else if (a.template) {
    var vars = { scout: scout, firstName: EagleDone.firstName(scout, rec.fields.preferred_name), unit: String(rec.fields.unit || ''), pageLink: pageUrl_(), note: String(req.note || ''),
      date: StageActions.nice(a.emailDate ? (ck.dates[a.emailDate] || todayYmd_()) : (req.date || todayYmd_())),
      verifiedDate: StageActions.nice(a.dateRole === 'verified' ? req.date : ck.dates.verified),
      scheduleLink: String(s.eborSignupUrl || ''), committeeEmail: String(s.committeeGroupEmail || '') };
    var plain = reviewBuiltIn_(TemplateCatalog.get(a.template), vars);
    // To the Scout; Cc the parent, the committee and (EBoR next steps) the unit contacts.
    var f2 = familyMsg_(rec.fields, [s.committeeGroupEmail].concat(a.toUnit ? unitContacts : []));
    record(mailFromTemplate_(a.template, vars, {
      committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout, to: f2.to, cc: f2.cc, keepCc: f2.keepCc,
      subject: plain.subject, body: plain.body,
      onSent: a.onSent && cols[a.onSent] ? { column: cols[a.onSent], label: StageActions.COLUMNS[a.onSent].label } : null }));
  }
  if (outboxIds.length) msg += ' ' + (outboxIds.length === 1 ? 'The email is' : outboxIds.length + ' emails are') + ' ready in the Outbox.';
  if (notes.length) msg += ' (' + notes.join('; ') + ')';
  return { message: msg, outboxId: outboxIds[0] || '', outboxIds: outboxIds };
}

/** Keep the note the family was sent, for their page (hidden _request column; see ScoutFiles.requestFor). */
function saveRequest_(recordId, sectionKey, note) {
  try {
    if (Records.columns().indexOf('_request') < 0) return;
    Records.update(recordId, { _request: ScoutFiles.requestCell(sectionKey, note, todayYmd_()) });
  } catch (e) { console.warn('saveRequest_: ' + e); }
}
