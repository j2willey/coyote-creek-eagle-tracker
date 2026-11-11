/**
 * Scout folders and Scout Updates (M7). Rules in lib/scoutFiles.js.
 *
 * attachFiles_ is the ONE place files reach a Scout folder: promotion,
 * duplicate intakes and Scout Updates all use it. New files get the next
 * version per type; older versions of those types move to Archive/, and the
 * row's _pending_since starts (new files waiting on the committee).
 *
 * Router actions (all need a session from sign-in or confirm):
 *   myRecord         {session, recordId}            -> {recordId, status, fields, files}
 *   startUpdate      {session, recordId, fields}    -> {uploadToken, changes}
 *   uploadUpdateFile {uploadToken, name, tag, data} -> {stored}
 *   finishUpdate     {uploadToken}                  -> {message, files, changes}
 */
var UPDATE_TOKEN_SECONDS = 2 * 3600;

/**
 * The Scout's folder: the linked one (hidden _folder_id column, set by the
 * folder reconcile or when the tool first finds/makes it), else where their
 * uploaded files are, else 202x/<Name> - <Unit> (found by name or created).
 */
function folderForRecord_(rec, create) {
  var linked = linkedFolder_(rec);
  if (linked) return linked;
  var found = findFolderForRecord_(rec, create);
  if (found) linkFolder_(rec.recordId, found);
  return found;
}

function linkedFolder_(rec) {
  var id = String(rec.fields._folder_id || '').trim();
  if (!id) return null;
  try { var f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; }
  catch (e) { return null; }
}

/** Remember the folder in the hidden column and make the Scout name a link to it (text unchanged). */
function linkFolder_(recordId, folder) {
  try {
    if (Records.columns().indexOf('_folder_id') >= 0) Records.update(recordId, { _folder_id: folder.getId() });
    linkCellText_(recordId, 'scout_name', folder.getUrl());
  } catch (e) { console.warn('linkFolder_: ' + e); }
}

/** Make a record's cell (by machine name) a link, keeping its text. Re-reads the row (it may have moved). */
function linkCellText_(recordId, column, url, newText) {
  var sh = getTrackingSheet_();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  var rec = Records.get(recordId);
  if (!rec || m.map[column] === undefined) return;
  var cell = sh.getRange(rec.row, m.map[column] + 1);
  var text = newText != null ? String(newText) : String(cell.getDisplayValue());
  cell.setRichTextValue(text ? SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(url).build()
                             : SpreadsheetApp.newRichTextValue().setText('').build());
}

function findFolderForRecord_(rec, create) {
  var logs = Tabs.read(UPLOADS_TAB).filter(function (u) { return u['Record ID'] === rec.recordId && u['Drive file ID']; });
  for (var i = logs.length - 1; i >= 0; i--) {
    try {
      var parents = DriveApp.getFileById(String(logs[i]['Drive file ID'])).getParents();
      if (!parents.hasNext()) continue;
      var p = parents.next();
      if (p.getName() === ScoutFiles.ARCHIVE) { var up = p.getParents(); if (up.hasNext()) p = up.next(); }
      if (p.getId() !== getSettings_().intakeFolderId) return p;
    } catch (e) { /* file deleted or no access: keep looking */ }
  }
  var s = getSettings_();
  if (!s.scoutsFolderId) throw new Error('Settings → scoutsFolderId is empty');
  var root = DriveApp.getFolderById(s.scoutsFolderId);
  var name = Intake.folderName(rec.fields.scout_name, rec.fields.unit);
  var it = root.getFoldersByName(s.inProgressFolder || '202x');
  if (it.hasNext()) {
    var inProgress = it.next();
    var f = inProgress.getFoldersByName(name);
    if (f.hasNext()) return f.next();
    if (create) return inProgress.createFolder(name);
  } else if (create) {
    return root.createFolder(s.inProgressFolder || '202x').createFolder(name);
  }
  return null;
}

function listFolder_(folder) {
  var out = [];
  if (!folder) return out;
  var it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); out.push({ id: f.getId(), name: f.getName(), file: f }); }
  return out;
}

/**
 * items: Uploads Log rows (file in _Intake Queue). Renames to the standard
 * with the record's own name + unit, moves into the Scout folder, archives
 * superseded versions, fills Record ID / Version / Stored name on the log.
 * Returns { folder, names }.
 */
function attachFiles_(rec, items) {
  var folder = folderForRecord_(rec, true);
  if (!items.length) return { folder: folder, names: [] };
  var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
  var existing = listFolder_(folder).concat(listFolder_(archive)).map(function (f) { return f.name; });
  var versions = Intake.assignVersions(ScoutFiles.existingVersions(existing), items.map(function (u) { return u['File type']; }));
  var newIds = [];
  var names = items.map(function (u, i) {
    var name = Intake.standardName(rec.fields.scout_name, rec.fields.unit, u['File type'], versions[i], originalName_(u));
    var f = DriveApp.getFileById(String(u['Drive file ID']));
    f.setName(name);
    f.moveTo(folder);
    newIds.push(f.getId());
    return name;
  });
  var top = listFolder_(folder);
  ScoutFiles.toArchive(top, newIds).forEach(function (id) {
    top.filter(function (f) { return f.id === id; })[0].file.moveTo(archive);
  });
  withLock_(function () {
    items.forEach(function (u, i) {
      Tabs.update(UPLOADS_TAB, u._row, { 'Record ID': rec.recordId, 'Version': versions[i], 'Stored name': names[i] });
    });
  });
  raisePending_(rec.recordId);                               // new files: the committee's move (state-model-v3)
  return { folder: folder, names: names };
}

/**
 * A dated line for the record's history: top of the Scout's Life to Eagle
 * Log (M6); the Notes cell shows that line, linked to the log. If the log
 * can't be reached, fall back to prepending in the cell so nothing is lost (R1).
 */
function addRecordNote_(recordId, line) {
  var rec = Records.get(recordId);
  if (!rec) return;
  recordActivity_(rec, line);                            // committee digest (Activity tab)
  var hasCell = Records.columns().indexOf('notes') >= 0;
  try {
    postNote_(rec, line, hasCell ? rec.fields.notes : '');
  } catch (err) {
    console.error('Notes doc failed for ' + recordId + ': ' + (err && err.stack || err));
    if (hasCell) Records.update(recordId, { notes: ScoutFiles.prependNote(rec.fields.notes, line) });
  }
}

// ---------- session + ownership ----------

function sessionEmail_(session) {
  var found = findSession_(session);
  if (!found) throw userError_('Signed out. Request a new sign-in link.');
  return String(found.row[1]);
}

function ownedRecord_(session, recordId) {
  var email = sessionEmail_(session);
  if (Records.findByEmail(email).indexOf(String(recordId)) < 0) throw userError_('That record is not linked to your email address.');
  var rec = Records.get(String(recordId));
  if (!rec) throw userError_('Record not found.');
  return { email: email, rec: rec };
}

function displayValue_(v) {
  return v instanceof Date ? Intake.dateKey(v) : String(v == null ? '' : v);
}

// ---------- actions ----------

function actionMyRecord_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  var phase = SettingsModel.pagePhase(o.rec.section);
  // EBoR not booked online yet: no "others to invite" form (they'd never get the tool's invitation).
  if (phase === 'ebor' && Booking.committeeType(o.rec.section, getSettings_())) phase = 'status';
  var cols = Records.columns();
  // No parent/guardian email of its own on the row (old-system or hand-made rows): the Scout adds one here, and must
  // before any update goes in (2026-11-08).
  var askParent = Intake.needsParent(o.rec.fields);
  var fields = Intake.FIELDS.filter(function (f) { return cols.indexOf(f.key) >= 0; }).map(function (f) {
    var ask = askParent && f.key === 'parent_email';
    return { key: f.key, label: f.label, value: displayValue_(o.rec.fields[f.key]),
      editable: ScoutFiles.EDITABLE.indexOf(f.key) >= 0 || ask, required: ask };
  });
  var folder = folderForRecord_(o.rec, false);
  var tz = Session.getScriptTimeZone();
  var files = listFolder_(folder)
    .filter(function (f) { return f.file.getMimeType().indexOf('application/vnd.google-apps') !== 0; })   // not the Notes doc
    .map(function (f) { return { name: f.name, date: Utilities.formatDate(f.file.getLastUpdated(), tz, 'M/d/yyyy') }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  var b = bookingInfo_(o.rec);
  var status = scoutStatusOf_(getSettings_(), o.rec);
  if (b.booking) status = b.booking.type + ' booked: ' + b.booking.when;
  else if (b.byCommittee) status = Booking.committeeStatus(Booking.bookableType(o.rec.section));
  // The page follows the stage (Jim W., 2026-10-12): project details and files only while the Proposal is in play;
  // at the EBoR stage only booking + others to invite; after approval, status only.
  var out = { recordId: o.rec.recordId, status: status, phase: phase, scoutName: String(o.rec.fields.scout_name || ''),
    canBook: b.canBook, booking: b.booking, followups: b.followups || [], request: ScoutFiles.requestFor(o.rec.fields._request, o.rec.section) };
  if (phase === 'proposal') { out.fields = fields; out.files = files; out.tags = Intake.TAGS; }
  if (phase === 'ebor') out.cc = Units.parseCc(o.rec.fields._cc);
  return out;
}

function actionStartUpdate_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  if (SettingsModel.pagePhase(o.rec.section) !== 'proposal') throw userError_('Your Proposal is approved, so there is nothing to update here. Email the committee if something is wrong.');
  var input = req.fields || {};
  var askParent = Intake.needsParent(o.rec.fields);
  var keys = ScoutFiles.EDITABLE.concat(askParent ? ['parent_email'] : []).filter(function (k) {
    return Object.prototype.hasOwnProperty.call(input, k) && Records.columns().indexOf(k) >= 0;
  });
  // Checked against the Scout's email on file, so "the Scout's own address" is caught here too.
  var v = Intake.validate(Object.assign({ scout_email: o.rec.fields.scout_email }, input), new Date(), keys.concat(askParent ? ['scout_email'] : []));
  var errs = v.errors.filter(function (e) { return e.field !== 'scout_email'; });   // the Scout's own cell is only for comparing
  if (errs.length) throw userError_(errs.map(function (e) { return e.message; }).join(' '));
  if (askParent && Intake.needsParent({ scout_email: o.rec.fields.scout_email, parent_email: v.clean.parent_email })) {
    throw userError_('Please add a parent or guardian email first: an adult is copied on every email from the committee.');
  }
  delete v.clean.scout_email;
  var changes = ScoutFiles.diff(o.rec.fields, v.clean, Intake.FIELDS.filter(function (f) { return keys.indexOf(f.key) >= 0; }));
  var batchId = Intake.makeQueueId(null, [], new Date()).replace(/^Q-/, 'U-');
  var token = Identity.makeToken(Utilities.getUuid);
  CacheService.getScriptCache().put('uu:' + token,
    JSON.stringify({ recordId: o.rec.recordId, email: o.email, batchId: batchId, changes: changes,
      description: ScoutFiles.cleanDescription(req.description) }), UPDATE_TOKEN_SECONDS);
  return { uploadToken: token, changes: ScoutFiles.describeChanges(changes) };
}

function updateContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Update session not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('uu:' + token);
  if (!raw) throw userError_('Update session expired. Please start again.');
  return JSON.parse(raw);
}

function actionUploadUpdateFile_(req) {
  var ctx = updateContext_(req.uploadToken);
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, ctx.recordId, req);
  return { stored: String(req.name || '') };
}

/** EBoR stage: people the Scout/parent want on the EBoR invite (a parent, a new Scoutmaster...). */
function actionSaveCc_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  if (SettingsModel.pagePhase(o.rec.section) !== 'ebor') throw userError_('This is available once your Eagle application is verified.');
  if (Records.columns().indexOf('_cc') < 0) throw new Error('No _cc column: run Admin → Setup / repair tabs');
  var v = Units.validateCc(req.people);
  if (!v.ok) throw userError_(v.errors.join(' '));
  var before = Units.parseCc(o.rec.fields._cc).map(function (x) { return x.email; });
  Records.update(o.rec.recordId, { _cc: Units.formatCc(v.list) });
  var added = v.list.filter(function (x) { return before.indexOf(x.email) < 0; });
  var desc = v.list.map(function (x) { return x.email + (x.note ? ' (' + x.note + ')' : ''); }).join(', ') || '(none)';
  addRecordNote_(o.rec.recordId, Intake.shortDate(new Date()) + ' [Scout] Others to invite to the EBoR: ' + desc + ' (by ' + o.email + ')');
  if (added.length) {
    var s = getSettings_();
    notifyCommittee_('EBoR guests added for ' + o.rec.fields.scout_name + ' (' + o.rec.fields.unit + ')',
      'The Scout/parent (' + o.email + ') asked to also invite:\n  ' +
      added.map(function (x) { return x.email + (x.note ? ' (' + x.note + ')' : ''); }).join('\n  ') +
      '\n\nIf one of them is a new unit leader, add them to the Unit Contacts tab.');
  }
  try { syncInvites_(); } catch (e) { console.warn('saveCc sync: ' + e); }
  return { message: 'Saved. They will get the calendar invitation once your board is booked.', cc: v.list };
}

function actionFinishUpdate_(req) {
  var ctx = updateContext_(req.uploadToken);
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  var uploads = uploadsFor_(ctx.batchId);
  if (!uploads.length && !ctx.changes.length) throw userError_('Nothing to send: change a field or add a file.');

  if (ctx.changes.length) {
    var set = {};
    ctx.changes.forEach(function (c) { set[c.key] = c.to; });
    Records.update(ctx.recordId, set);
  }
  var res = attachFiles_(rec, uploads);
  addRecordNote_(ctx.recordId, ScoutFiles.noteLine(Intake.shortDate(new Date()), 'Scout Update', res.names, ctx.changes));
  var dLine = ScoutFiles.descriptionLine(Intake.shortDate(new Date()), ctx.description);
  if (dLine) addRecordNote_(ctx.recordId, dLine);                  // the Scout's own words, on top of the log
  var restarted = ScoutFiles.restartsReview(rec.section, ctx.changes);
  if (restarted) {
    var to = 'proposal_received';
    try { Records.move(ctx.recordId, to); }
    catch (e) { to = 'proposal_incomplete'; Records.move(ctx.recordId, to); }   // tab without New Submissions yet
    addRecordNote_(ctx.recordId, Intake.shortDate(new Date()) + ' [tool] New project title on an Unapproved Proposal: moved to ' +
      SettingsModel.sectionLabel(getSettings_(), to) + ' (review starts over)');
  }
  CacheService.getScriptCache().remove('uu:' + req.uploadToken);

  var s = getSettings_();
  var m = ScoutFiles.updateReceipt(rec.fields.scout_name, res.names, ctx.changes,
    String(s.webOrigin).replace(/\/+$/, '') + '/signin', ctx.description);
  mailFromTemplate_('Update received', { scout: String(rec.fields.scout_name), files: res.names,
    changes: ScoutFiles.describeChanges(ctx.changes), description: ctx.description || '', pageLink: String(s.webOrigin).replace(/\/+$/, '') + '/signin' }, { to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: m.subject, body: m.body });
  return { message: 'Thank you. Your update is in, and we emailed a receipt.' +
      (restarted ? ' Because the project title changed, the committee will review it as a new Proposal.' : ''), files: res.names,
    changes: ScoutFiles.describeChanges(ctx.changes) };
}
