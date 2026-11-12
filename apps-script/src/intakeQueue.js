/**
 * Intake adapter (M3). Rules live in lib/intake.js; this file talks to the
 * Intake Queue / Uploads Log tabs, Drive, CacheService and mail.
 *
 * Email-first (email-first-intake-design.md, Jim W. 2026-10-28): the address is proven BEFORE the form.
 * requestLink for an address not on file emails a "Start your Proposal" link (/intake?t=…); the form's Scout
 * email is that address, and Finish promotes at once (no confirmation step).
 *
 * Router actions:
 *   startIntake      {token}                -> {email, formToken}   (token from the emailed link)
 *   submitIntake     {formToken, fields..., website} -> {queueId, uploadToken}
 *   uploadIntakeFile {uploadToken, name, tag, data(base64)} -> {stored}
 *   finishIntake     {uploadToken, formToken} -> {status: 'promoted'|'attached'|'held', message, session?, email?}
 *   confirmIntake    {token}                -> legacy: submissions made before email-first, still Unconfirmed
 *
 * Locks are never nested: Records.insert and startSession_ take their own.
 */
var QUEUE_TAB = 'Intake Queue';
var UPLOADS_TAB = 'Uploads Log';
var UPLOAD_TOKEN_SECONDS = 2 * 3600;
var INTAKE_HOURLY_CAP = 30;

/** Address not on file: email a link to the first-time Proposal form. */
function sendStartLink_(email) {
  var s = getSettings_();
  var hours = Math.max(1, Math.min(Number(s.intakeLinkHours) || 6, 6));      // CacheService max is 6 h
  var token = Identity.makeToken(Utilities.getUuid);
  CacheService.getScriptCache().put('it:' + token, JSON.stringify({ email: email }), hours * 3600);
  var url = String(s.webOrigin || '').replace(/\/+$/, '') + '/intake?t=' + encodeURIComponent(token);
  var m = Identity.startEmail(url, hours);
  mailFromTemplate_('Start your Proposal', { link: url, hours: String(hours) }, { to: email, subject: m.subject, body: m.body, kind: 'signin' });
}

var FORM_TOKEN_SECONDS = 6 * 3600;

/** The emailed link opens the form: -> {email, formToken}. The link stays usable (reload) until a submission finishes. */
function actionStartIntake_(req) {
  var token = String(req.token || '');
  if (!Identity.isTokenShape(token)) throw userError_('That link is not valid. Enter your email to get a new one.');
  var raw = CacheService.getScriptCache().get('it:' + token);
  if (!raw) throw userError_('That link has expired or was already used. Enter your email to get a new one.');
  var email = JSON.parse(raw).email;
  var formToken = Identity.makeToken(Utilities.getUuid);
  CacheService.getScriptCache().put('if:' + formToken, JSON.stringify({ email: email, start: token }), FORM_TOKEN_SECONDS);
  return { email: email, formToken: formToken };
}

function formEmail_(formToken) {
  if (!Identity.isTokenShape(formToken)) throw userError_('Please start by entering your email: we email you a link to this form.');
  var raw = CacheService.getScriptCache().get('if:' + formToken);
  if (!raw) throw userError_('This form has expired. Enter your email again to get a new link.');
  return JSON.parse(raw);
}

function actionSubmitIntake_(req) {
  if (String(req.website || '').trim()) {                  // honeypot: bots fill every field
    console.warn('Intake honeypot tripped');
    return { queueId: 'Q-0', uploadToken: Identity.makeToken(Utilities.getUuid) };
  }
  var proven = formEmail_(req.formToken).email;
  req = Object.assign({}, req, { scout_email: proven });    // the Scout email IS the proven address
  var v = Intake.validate(req, new Date());
  if (!v.ok) throw userError_(v.errors.map(function (e) { return e.message; }).join(' '));

  var cache = CacheService.getScriptCache();
  var hourKey = 'intake:n:' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(hourKey) || 0);
  if (n >= INTAKE_HOURLY_CAP) {
    notifyAdmin_('Intake hourly cap reached', 'More than ' + INTAKE_HOURLY_CAP + ' submissions this hour. Possible spam.');
    throw userError_('We are receiving a lot of submissions right now. Please try again in an hour.');
  }
  cache.put(hourKey, String(n + 1), 3600);

  if (v.clean.preferred_name) ensureTabColumn_(QUEUE_TAB, 'Preferred Name');   // tabs set up before 2026-11-04
  var queueId = withLock_(function () {
    var existing = Tabs.read(QUEUE_TAB).map(function (r) { return r['Queue ID']; });
    var id = Intake.makeQueueId(null, existing, new Date());
    var row = { 'Submitted': new Date(), 'Queue ID': id, 'Status': Intake.STATUS.UPLOADING, 'Path': 'verified' };
    Intake.FIELDS.forEach(function (f) {
      if (f.key === 'preferred_name' && !v.clean[f.key]) return;      // optional column: only written when filled
      row[f.header] = f.key === 'bsa_id' && v.clean[f.key] ? "'" + v.clean[f.key] : v.clean[f.key];
    });
    Tabs.append(QUEUE_TAB, row);
    return id;
  });

  var token = Identity.makeToken(Utilities.getUuid);
  cache.put('ut:' + token, queueId, UPLOAD_TOKEN_SECONDS);
  cache.put('uv:' + queueId, proven, UPLOAD_TOKEN_SECONDS);   // proven address for Finish
  return { queueId: queueId, uploadToken: token };
}

function queueIdForUpload_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Upload session not valid. Please start again.');
  var id = CacheService.getScriptCache().get('ut:' + token);
  if (!id) throw userError_('Upload session expired. Please start again.');
  return id;
}

function actionUploadIntakeFile_(req) {
  var queueId = queueIdForUpload_(req.uploadToken);
  var q = findQueue_(queueId);
  if (!q) throw new Error('Queue row vanished: ' + queueId);
  storeUpload_(queueId, q['Eagle Candidate'], q['Unit'], '', req);
  return { stored: String(req.name || '') };
}

/**
 * One uploaded file → _Intake Queue folder + Uploads Log row. batchId is the
 * Queue ID (intake) or U-… (Scout Update). Shared by intake and updates.
 */
function storeUpload_(batchId, scoutName, unit, recordId, req, opts) {
  var s = getSettings_();
  var name = String(req.name || '').slice(0, 200);
  var bytes = Utilities.base64Decode(String(req.data || ''));
  var problem = Intake.checkFile({ name: name, tag: req.tag, bytes: bytes.length }, s.maxUploadMB);
  if (problem) throw userError_(name + ': ' + problem);
  if (uploadsFor_(batchId).length >= Intake.MAX_FILES) throw userError_('At most ' + Intake.MAX_FILES + ' files at a time.');
  if (!s.intakeFolderId) throw new Error('Settings → intakeFolderId is empty: run Admin → Setup / repair tabs');
  var stored = Intake.queueFileName(batchId, scoutName, unit, req.tag, name);
  var file = DriveApp.getFolderById(s.intakeFolderId)
    .createFile(Utilities.newBlob(bytes, Intake.mimeFor(name), stored));
  if (opts && opts.noLog) return file.getId();                       // EBoR paperwork demo: no Uploads Log row
  withLock_(function () {
    Tabs.append(UPLOADS_TAB, { 'Received': new Date(), 'Record ID': recordId || '', 'Queue ID': batchId, 'File type': req.tag,
      'Stored name': stored, 'Drive file ID': file.getId(), 'Bytes': bytes.length, 'Original name': name });
  });
  return file.getId();
}

function actionFinishIntake_(req) {
  var queueId = queueIdForUpload_(req.uploadToken);
  var uploads = uploadsFor_(queueId);
  if (!uploads.some(function (u) { return u['File type'] === 'ESSPP'; })) {
    throw userError_('Please attach the signed Proposal (file type ESSPP).');
  }
  var q = findQueue_(queueId);
  if (!q) throw new Error('Queue row vanished: ' + queueId);
  var summary = Intake.filesSummary(uploads.map(function (u) {
    return { tag: u['File type'], name: originalName_(u) };
  }));
  var cache = CacheService.getScriptCache();
  var proven = cache.get('uv:' + queueId);
  if (!proven) throw userError_('Upload session expired. Please start again.');
  // Single use: this link and form are done (a second submission needs a new link).
  var claimed = withLock_(function () {
    var cur = findQueue_(queueId);
    if (!cur || cur['Status'] !== Intake.STATUS.UPLOADING) return null;
    Tabs.update(QUEUE_TAB, cur._row, { 'Status': Intake.STATUS.CONFIRMED, 'Confirmed': new Date(), 'Files': summary });
    cur['Status'] = Intake.STATUS.CONFIRMED; cur['Files'] = summary;
    return cur;
  });
  if (!claimed) throw userError_('This submission was already finished.');
  cache.remove('ut:' + req.uploadToken);
  cache.remove('uv:' + queueId);
  try {
    var f = Identity.isTokenShape(req.formToken) ? JSON.parse(cache.get('if:' + req.formToken) || 'null') : null;
    if (f) { cache.remove('if:' + req.formToken); if (f.start) cache.remove('it:' + f.start); }
  } catch (e) {}
  claimed._clicker = proven;
  return processConfirmed_(claimed, true);
}

/** Addresses that get a confirmation link, in a fixed order (index = which hash). */
function confirmRecipients_(q) {
  var out = [];
  [q['Scout Email'], q['Parent/Guardian Email']].forEach(function (e) {
    e = String(e || '').trim().toLowerCase();
    if (e && out.indexOf(e) < 0) out.push(e);
  });
  return out;
}

/**
 * New confirmation links for queue row q (+ extra fields to write). Each
 * address gets its OWN link, so confirmIntake knows which address clicked.
 */
function sendIntakeConfirmation_(q, extra) {
  var s = getSettings_();
  var days = Number(s.intakeConfirmDays) || 7;
  var to = confirmRecipients_(q);
  var tokens = to.map(function () { return Identity.makeToken(Utilities.getUuid); });
  var fields = extra || {};
  fields['_confirm_hash'] = tokens.map(hash_).join(' ');
  fields['_confirm_expires'] = new Date(Date.now() + days * 864e5);
  withLock_(function () { Tabs.update(QUEUE_TAB, q._row, fields); });
  to.forEach(function (addr, i) {
    var mail = Intake.confirmEmail(q['Eagle Candidate'], Intake.confirmUrl(s.webOrigin, tokens[i]), days);
    // Carries a working link: kind 'signin' keeps it off the Committee Group.
    mailFromTemplate_('Confirm your submission', { scout: String(q['Eagle Candidate'] || ''), link: Intake.confirmUrl(s.webOrigin, tokens[i]), days: String(days) },
      { to: addr, subject: mail.subject, body: mail.body, kind: 'signin' });
  });
}

/** Called by requestLink when the address has no Candidate Record yet. */
function resendIntakeConfirmation_(email) {
  var e = String(email).toLowerCase();
  var rows = Tabs.read(QUEUE_TAB).filter(function (r) {
    return r['Status'] === Intake.STATUS.UNCONFIRMED &&
      (String(r['Scout Email']).toLowerCase() === e || String(r['Parent/Guardian Email']).toLowerCase() === e);
  });
  if (!rows.length) return false;
  sendIntakeConfirmation_(rows[rows.length - 1]);
  return true;
}

function actionConfirmIntake_(req) {
  var token = String(req.token || '');
  if (!Identity.isTokenShape(token)) throw userError_('That link is not valid.');
  var h = hash_(token);

  // Claim the row (single use; a double click can't promote twice).
  var q = withLock_(function () {
    var row = Tabs.read(QUEUE_TAB).filter(function (r) {
      return String(r['_confirm_hash'] || '').split(' ').indexOf(h) >= 0;
    })[0];
    if (!row) return null;
    row._clicker = confirmRecipients_(row)[String(row['_confirm_hash']).split(' ').indexOf(h)];
    if (row['Status'] !== Intake.STATUS.UNCONFIRMED) return row;
    if (!(new Date(row['_confirm_expires']).getTime() > Date.now())) return 'expired';
    Tabs.update(QUEUE_TAB, row._row, { 'Status': Intake.STATUS.CONFIRMED, 'Confirmed': new Date(), '_confirm_hash': '' });
    row['Status'] = Intake.STATUS.CONFIRMED;
    row._claimed = true;
    return row;
  });
  if (q === 'expired') throw userError_('That link has expired. Use "Check status or send an update" to get a new one.');
  if (!q || !q._claimed) throw userError_('That link was already used or is not valid. Sign in to see your status.');
  return processConfirmed_(q, false);
}

/**
 * A submission whose address is proven (email-first Finish, or a legacy confirmation click): q._clicker = that address.
 * Exactly one record by Scout email / BSA ID and the address is on it → files attached. Any other match → held.
 * Email-first (holdClose): a name + unit match (old-system Scouts, a parent's address not on file) is held too.
 */
function processConfirmed_(q, holdClose) {
  var cand = queueToClean_(q);
  var dup = Intake.duplicateCheck(cand,
    Records.all(['scout_name', 'unit', 'birth_date', 'scout_email', 'bsa_id']),
    Tabs.read(QUEUE_TAB).map(function (r) {
      return { queueId: r['Queue ID'], status: r['Status'], scout_email: r['Scout Email'], bsa_id: r['BSA ID'], recordId: r['Record ID'] };
    }));

  var s = getSettings_();
  var signin = String(s.webOrigin).replace(/\/+$/, '') + '/signin';
  if (dup.exact.length === 1 && SheetModel.isRecordId(dup.exact[0]) && clickerOnRecord_(q._clicker, dup.exact[0])) {
    try {
      return attachQueueToRecord_(q, cand, dup.exact[0]);
    } catch (err) {
      console.error('Attach failed for ' + q['Queue ID'] + ': ' + (err && err.stack || err));
      notifyAdmin_('Intake attach failed: ' + q['Queue ID'], String(err && err.stack || err));
      // fall through: hold for a person
    }
  }
  var held = dup.exact.length ? dup.exact : holdClose ? dup.close : [];
  if (held.length) {
    var matches = describeMatches_(held);
    withLock_(function () {
      Tabs.update(QUEUE_TAB, q._row, { 'Status': Intake.STATUS.DUPLICATE, 'Note': 'Matches ' + matches.join('; ') });
    });
    var m = Intake.heldEmail(cand.scout_name, signin);
    mailFromTemplate_('Received, held (possible duplicate)', { scout: cand.scout_name, pageLink: signin },
      { to: familyMsg_(cand, s.committeeGroupEmail).to, cc: familyMsg_(cand, s.committeeGroupEmail).cc, keepCc: familyMsg_(cand).keepCc, subject: m.subject, body: m.body });
    notifyCommittee_('Intake held: possible duplicate (' + cand.scout_name + ')', heldBody_(q, cand, matches));
    return { status: 'held', message: 'Thank you, your Proposal is in. It looks like we may already have a record for this Scout, ' +
      'so a committee member will check and get back to you by email.' };
  }

  try {
    promoteQueueRow_(q, dup.close);
  } catch (err) {
    console.error('Promotion failed for ' + q['Queue ID'] + ': ' + (err && err.stack || err));
    withLock_(function () { Tabs.update(QUEUE_TAB, q._row, { 'Status': Intake.STATUS.ERROR, 'Note': String(err && err.message || err) }); });
    notifyAdmin_('Intake promotion failed: ' + q['Queue ID'], String(err && err.stack || err));
    return { status: 'held', message: 'Thank you, your Proposal is in. The committee will follow up by email.' };
  }
  // Signed in only when the proven address is the Scout's (it is, on the email-first path); a parent's never signs in.
  var canSign = String(q._clicker || '').toLowerCase() === String(cand.scout_email || '').toLowerCase() || getSettings_().parentsSignIn === true;
  return { status: 'promoted', session: canSign ? startSession_(q._clicker) : '', email: canSign ? q._clicker : '',
    message: 'Thank you. Your Proposal is in, and we emailed a receipt. A committee member will check it next.' };
}

/**
 * Queue row → Scout folder, files renamed and moved, row under
 * "New Submissions", receipt. closeIds: possible duplicates to flag.
 */
function promoteQueueRow_(q, closeIds) {
  var s = getSettings_();
  var cand = queueToClean_(q);
  if (!s.scoutsFolderId) throw new Error('Settings → scoutsFolderId is empty');

  var cols = Records.columns();
  var fields = {};
  Intake.FIELDS.forEach(function (f) {
    if (cols.indexOf(f.key) < 0 || !cand[f.key]) return;
    var val = cand[f.key];
    if (f.key === 'birth_date') { var p = val.split('-').map(Number); val = new Date(p[0], p[1] - 1, p[2]); }
    fields[f.key] = val;
  });
  var skipped = Intake.FIELDS.filter(function (f) { return cand[f.key] && cols.indexOf(f.key) < 0; })
    .map(function (f) { return f.key; });

  var recordId;
  try { recordId = Records.insert('proposal_received', fields); }
  catch (e) {                                           // tab without a New Submissions row yet (run Setup / repair tabs)
    console.warn('No New Submissions section, using Something missing: ' + e.message);
    recordId = Records.insert('proposal_incomplete', fields);
  }
  var res = attachFiles_(Records.get(recordId), uploadsFor_(q['Queue ID']));
  var names = res.names;
  var note = Intake.shortDate(new Date()) + ' [Proposal submitted] web intake ' + q['Queue ID'] + ', ' + names.length + ' file(s)';
  if (closeIds && closeIds.length) note += ' POSSIBLE DUPLICATE of ' + closeIds.join(', ') + ' (same name, unit, birth date).';
  addRecordNote_(recordId, note);                       // Notes doc (M6) + latest line in the cell

  withLock_(function () {
    Tabs.update(QUEUE_TAB, q._row, { 'Status': Intake.STATUS.PROMOTED, 'Record ID': recordId,
      'Note': skipped.length ? 'Not on tracking tab: ' + skipped.join(', ') : '' });
  });

  var signin = String(s.webOrigin).replace(/\/+$/, '') + '/signin';
  var m = Intake.receiptEmail(cand.scout_name, names, signin, cand);
  mailFromTemplate_('Proposal received', { scout: cand.scout_name, entries: Intake.submittedList(cand), files: names, pageLink: signin },
    { to: familyMsg_(cand, s.committeeGroupEmail).to, cc: familyMsg_(cand, s.committeeGroupEmail).cc, keepCc: familyMsg_(cand).keepCc, subject: m.subject, body: m.body });
  return recordId;
}

/** Only an address already on the record may add files to it from the first-time form. */
function clickerOnRecord_(email, recordId) {
  var r = Records.get(recordId);
  if (!r || !email) return false;
  return [r.fields.scout_email, r.fields.parent_email].some(function (e) {
    return String(e || '').trim().toLowerCase() === email;
  });
}

/**
 * Confirmed intake that matches exactly one Candidate Record: its files join
 * that record (next versions, older ones to Archive). Fields are NOT changed;
 * differences go to the committee and the Notes cell.
 */
function attachQueueToRecord_(q, cand, recordId, opts) {
  opts = opts || {};
  var rec = Records.get(recordId);
  if (!rec) throw new Error('Record vanished: ' + recordId);
  var res = attachFiles_(rec, uploadsFor_(q['Queue ID']));
  var diffs = ScoutFiles.describeChanges(ScoutFiles.diff(rec.fields, cand,
    Intake.FIELDS.filter(function (f) { return cand[f.key]; })));
  var line = ScoutFiles.noteLine(Intake.shortDate(new Date()), 'Duplicate intake ' + q['Queue ID'], res.names, []) +
    (diffs.length ? '. Form differed: ' + diffs.join('; ') : '');
  addRecordNote_(recordId, line);
  withLock_(function () {
    Tabs.update(QUEUE_TAB, q._row, { 'Status': Intake.STATUS.ATTACHED, 'Record ID': recordId,
      'Note': 'Files attached to ' + recordId + (diffs.length ? '. Differs: ' + diffs.join('; ') : '') });
  });

  var s = getSettings_();
  var signin = String(s.webOrigin).replace(/\/+$/, '') + '/signin';
  var m = ScoutFiles.attachedEmail(rec.fields.scout_name, res.names, signin);
  mailFromTemplate_('Files added to existing record', { scout: String(rec.fields.scout_name), files: res.names, pageLink: signin }, { to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: m.subject, body: m.body });
  if (diffs.length && !opts.reviewed) {                  // compared on the Admin page: the member already chose
    notifyCommittee_('Duplicate intake attached; details differ (' + rec.fields.scout_name + ')',
      'A first-time submission (' + q['Queue ID'] + ') matched ' + recordId + '. Its files were added as new versions:\n  ' +
      res.names.join('\n  ') + '\n\nThe form differed from the tracking sheet (sheet NOT changed):\n  ' + diffs.join('\n  ') +
      '\n\nTo take any of the form\'s values: Admin page → "Compare with the sheet…".\n\nFolder: ' + res.folder.getUrl());
  }
  return { status: 'attached', message: 'Thank you. We matched this to the record we already have for ' + rec.fields.scout_name +
    ' and added your files. Next time, sign in and use "Send an update".' };
}

/** "R-… (Scout Nine, T 109; section: Something missing)" for record and queue IDs. */
function describeMatches_(ids) {
  var settings = getSettings_();
  var queue = null;
  return ids.map(function (id) {
    if (SheetModel.isRecordId(id)) {
      var r = Records.get(id);
      if (!r) return id;
      var sec = (settings.sections || []).filter(function (x) { return x.key === r.section; })[0];
      return id + ' (' + r.fields.scout_name + ', ' + r.fields.unit + '; tracking tab: ' + (sec ? sec.label : r.section) + ')';
    }
    queue = queue || Tabs.read(QUEUE_TAB);
    var q = queue.filter(function (x) { return x['Queue ID'] === id; })[0];
    return q ? id + ' (' + q['Eagle Candidate'] + ', ' + q['Unit'] + '; Intake Queue: ' + q['Status'] + ')' : id;
  });
}

function heldBody_(q, cand, matches) {
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName(QUEUE_TAB);
  var lines = ['A confirmed intake was held because it may duplicate an existing Scout (same Scout email or BSA ID).', '',
    'Submitted ' + Utilities.formatDate(new Date(q['Submitted']), Session.getScriptTimeZone(), 'M/d/yyyy h:mm a') +
    ' (' + q['Queue ID'] + '):'];
  Intake.FIELDS.forEach(function (f) { if (cand[f.key]) lines.push('  ' + f.label + ': ' + cand[f.key]); });
  lines.push('  Files: ' + (q['Files'] || '(none)'), '', 'Matches:');
  matches.forEach(function (m) { lines.push('  ' + m); });
  lines.push('', 'Intake Queue (highlighted row): ' + ss.getUrl() + (tab ? '#gid=' + tab.getSheetId() : ''), '',
    'What to do:',
    '  - Same Scout sending a new version: forward the files to the Scout folder (or ask the Scout to sign in and send an update), then mark the queue row as spam to clear it.',
    '  - Different Scout: select the row → Eagle Tracker → Intake Queue → Promote selected row.');
  return lines.join('\n');
}

function originalName_(u) {
  return u['Original name'] ? String(u['Original name'])
    : String(u['Stored name']).replace(u['Queue ID'] + '_' + u['File type'] + '_', '');   // pre-0.3.1 rows
}

function queueToClean_(q) {
  var o = { queueId: q['Queue ID'] };
  Intake.FIELDS.forEach(function (f) {
    var v = q[f.header];
    o[f.key] = f.type === 'date' ? Intake.dateKey(v) : String(v == null ? '' : v).trim();
  });
  return o;
}

function findQueue_(queueId) {
  return Tabs.read(QUEUE_TAB).filter(function (r) { return r['Queue ID'] === queueId; })[0] || null;
}

function uploadsFor_(queueId) {
  return Tabs.read(UPLOADS_TAB).filter(function (r) { return r['Queue ID'] === queueId; });
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function notifyCommittee_(subject, body) {
  var s = getSettings_();
  var to = s.committeeGroupEmail || s.adminEmail || s.testRecipient;
  if (to) sendMail_({ to: to, subject: '[Eagle Tracker] ' + subject, body: body });
}

// ---------- committee actions (Intake Queue tab) ----------

var QUEUE_ACTIONS = ['Promote', 'Mark as spam'];
var PROMOTABLE = function () { return [Intake.STATUS.CONFIRMED, Intake.STATUS.DUPLICATE, Intake.STATUS.ERROR]; };

/** Promote a queue row (no UI). Throws a user-readable Error. */
function promoteQueueChecked_(q) {
  if (PROMOTABLE().indexOf(q['Status']) < 0) throw new Error('Only Confirmed, Possible duplicate or Error rows can be promoted (this one is ' + q['Status'] + ').');
  return promoteQueueRow_(q, []);
}

/** Mark a queue row as spam (no UI): files to trash, details cleared. */
function markQueueSpam_(q) {
  if (q['Status'] === Intake.STATUS.PROMOTED) throw new Error('Already promoted; edit the tracking tab instead.');
  trashUploads_(q['Queue ID']);
  var clear = { 'Status': Intake.STATUS.SPAM, 'Files': '', '_confirm_hash': '' };
  Intake.FIELDS.forEach(function (f) { clear[f.header] = ''; });
  withLock_(function () { Tabs.update(QUEUE_TAB, q._row, clear); });
}

/** Installable edit trigger branch: the Intake Queue Action column (runs as the trigger owner). */
function handleQueueAction_(e) {
  var sh = e.range.getSheet();
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (e.range.getColumn() !== head.indexOf('Action') + 1 || e.range.getRow() < 2) return;
  var v = String(e.value || '').trim();
  if (QUEUE_ACTIONS.indexOf(v) < 0) return;
  e.range.setValue('');
  var q = Tabs.read(QUEUE_TAB).filter(function (x) { return x._row === e.range.getRow(); })[0];
  if (!q) return;
  try {
    if (v === 'Promote') {
      var id = promoteQueueChecked_(q);
      e.source.toast(q['Eagle Candidate'] + ' promoted as ' + id + ' (New Submissions).', 'Eagle Tracker', 8);
    } else {
      markQueueSpam_(q);
      e.source.toast(q['Queue ID'] + ' marked as spam; files trashed.', 'Eagle Tracker', 6);
    }
  } catch (err) {
    e.source.toast(err.message, 'Eagle Tracker problem', 10);
  }
}

// ---------- committee menu (Intake Queue tab) ----------

function selectedQueueRow_() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== QUEUE_TAB) throw new Error('Select a row on the "' + QUEUE_TAB + '" tab first.');
  var r = sh.getActiveRange().getRow();
  var q = Tabs.read(QUEUE_TAB).filter(function (x) { return x._row === r; })[0];
  if (!q) throw new Error('Select a submission row (not the header).');
  return q;
}

function menuPromoteQueueRow() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var q = selectedQueueRow_();
    if (PROMOTABLE().indexOf(q['Status']) < 0) { ui.alert('Only Confirmed, Possible duplicate or Error rows can be promoted (this one is ' + q['Status'] + ').'); return; }
    if (ui.alert('Promote ' + q['Eagle Candidate'] + ' (' + q['Queue ID'] + ')?',
      'Creates the Scout folder, renames the files, adds a row under "New Submissions" and emails the receipt.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    var id = promoteQueueRow_(q, []);
    ui.alert('Promoted as ' + id + '.');
  } catch (e) { ui.alert(e.message); }
}

function menuMarkQueueSpam() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var q = selectedQueueRow_();
    if (ui.alert('Mark ' + q['Queue ID'] + ' as spam?', 'Its files go to the trash and its details are cleared.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    markQueueSpam_(q);
    ui.alert('Done.');
  } catch (e) { ui.alert(e.message); }
}

function menuPurgeIntake() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var days = Number(getSettings_().intakePurgeDays) || 14;
  var rows = Tabs.read(QUEUE_TAB);
  var idx = Intake.purgeIndexes(rows.map(function (r) { return { status: r['Status'], submitted: r['Submitted'] }; }), Date.now(), days);
  if (!idx.length) { ui.alert('Nothing unconfirmed older than ' + days + ' days.'); return; }
  if (ui.alert('Purge ' + idx.length + ' unconfirmed submission(s) older than ' + days + ' days?',
    'Their rows are deleted and their files go to the trash.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var ids = idx.map(function (i) { return rows[i]['Queue ID']; });
  ids.forEach(trashUploads_);
  withLock_(function () {
    var cur = Tabs.read(QUEUE_TAB).filter(function (r) { return ids.indexOf(r['Queue ID']) >= 0; });
    Tabs.remove(QUEUE_TAB, cur.map(function (r) { return r._row; }));
    var logs = Tabs.read(UPLOADS_TAB).filter(function (r) { return ids.indexOf(r['Queue ID']) >= 0; });
    Tabs.remove(UPLOADS_TAB, logs.map(function (r) { return r._row; }));
  });
  ui.alert('Purged ' + ids.length + '.');
}

function trashUploads_(queueId) {
  uploadsFor_(queueId).forEach(function (u) {
    try { DriveApp.getFileById(String(u['Drive file ID'])).setTrashed(true); }
    catch (e) { console.warn('Could not trash ' + u['Drive file ID'] + ': ' + e); }
  });
}
