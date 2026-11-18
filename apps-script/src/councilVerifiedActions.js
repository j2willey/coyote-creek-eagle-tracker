/**
 * Council "Ready for EBOR" emails -> the Scout's folder (rules in lib/councilVerified.js). Runs in the hourly trigger
 * (digestHourly) as cc-advancement, right after the Formsite emails; also Admin menu → "Council verified: file new
 * Ready for EBOR emails now". Off until Settings → councilVerifiedFrom has a date (only emails from that day on).
 * Same Gmail labels as the Formsite emails ("Eagle Tracker/Filed", "…/No match", "…/Error"; remove the label to retry).
 * One row per email on the Council Verified tab; anything not Matched, or with files to identify, is in the digest's
 * Awaiting action and tags the Scout's dashboard row until a member ticks Checked.
 */
function runCouncilVerified_() {
  var s = getSettings_();
  var raw = s.councilVerifiedFrom;
  var from = raw instanceof Date ? Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(raw || '').trim();
  var m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!m0) return { off: true, filed: 0, nomatch: 0, errors: 0 };
  var since = new Date(+m0[1], +m0[2] - 1, +m0[3]).getTime();
  var q = CouncilVerified.QUERY + ' after:' + m0[1] + '/' + m0[2] + '/' + m0[3] + ' ' +
    Object.keys(COUNCIL_LABELS).map(function (k) { return '-label:"' + COUNCIL_LABELS[k] + '"'; }).join(' ');
  ensureCouncilVerifiedTab_();
  var label = function (k) { return GmailApp.getUserLabelByName(COUNCIL_LABELS[k]) || GmailApp.createLabel(COUNCIL_LABELS[k]); };
  var out = { filed: 0, nomatch: 0, errors: 0 };
  GmailApp.search(q, 0, 10).forEach(function (thread) {
    var outcome = '';
    // A thread may hold replies; file the newest message that says Ready for EBOR and has attachments (else the newest).
    var msgs = thread.getMessages().filter(function (m) { return CouncilVerified.isMatch(m.getSubject()) && m.getDate().getTime() >= since; });
    if (!msgs.length) return;
    var withFiles = msgs.filter(function (m) { return m.getAttachments({ includeInlineImages: false }).length; });
    var msg = (withFiles.length ? withFiles : msgs).slice(-1)[0];
    try {
      outcome = fileCouncilVerified_(msg).matched ? 'done' : 'nomatch';
    } catch (e) {
      outcome = 'error';
      console.error('Council verified: ' + (e && e.stack || e));
      notifyAdmin_('"Ready for EBOR" email not filed', msg.getSubject() + ': ' + (e.userMessage || e.message) +
        '\n\nThe email has the Gmail label "' + COUNCIL_LABELS.error + '". Remove the label to try again.\n' + thread.getPermalink());
    }
    thread.addLabel(label(outcome));
    if (outcome !== 'error') { try { thread.moveToArchive(); } catch (e) { console.warn('archive: ' + e); } }
    out[outcome === 'done' ? 'filed' : outcome === 'nomatch' ? 'nomatch' : 'errors']++;
  });
  return out;
}

/** OCR text of a PDF or image (Drive converts a copy to a Google Doc; the copy is deleted). '' when it can't. */
function ocrText_(blob) {
  if (typeof Drive === 'undefined' || !Drive.Files) return '';
  var id = '';
  try {
    var f = Drive.Files.create({ name: 'Eagle Tracker OCR (temporary)', mimeType: MimeType.GOOGLE_DOCS }, blob.copyBlob(),
      { ocrLanguage: 'en', fields: 'id' });
    id = f.id;
    return DocumentApp.openById(id).getBody().getText();
  } catch (e) {
    console.warn('OCR: ' + (e.message || e));
    return '';
  } finally {
    if (id) { try { Drive.Files.remove(id); } catch (e) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e2) {} } }
  }
}

/** One "Ready for EBOR" email. -> {matched, recordId?, files} */
function fileCouncilVerified_(msg) {
  var tz = Session.getScriptTimeZone();
  var subject = msg.getSubject();
  var p = CouncilVerified.parseSubject(subject) || { name: '', first: '', middle: '', last: '', unit: '' };
  var all = msg.getAttachments({ includeInlineImages: false });
  var atts = CouncilVerified.keep(all.map(function (a) { return { name: a.getName(), mime: a.getContentType(), bytes: a.getSize() }; }))
    .map(function (i) { return all[i]; });
  // One attachment is the Verified Application (no OCR needed); several: read each one's first page.
  var kinds = atts.map(function (a) { return atts.length > 1 ? CouncilVerified.classify(ocrText_(a.copyBlob())) : ''; });
  var heading = 'Council: "' + subject + '", from ' + msg.getFrom() + ', received ' + Utilities.formatDate(msg.getDate(), tz, 'EEE M/d/yyyy h:mm a');
  var emailPdf = function (name) {
    return Utilities.newBlob(CouncilApp.emailHtml(msg.getBody(), heading), 'text/html', 'email.html').getAs('application/pdf').setName(name);
  };
  var hit = p.first
    ? CouncilApp.matchRecord(Records.all(['scout_name', 'unit', 'scout_email', 'parent_email', 'preferred_name']), p, Units.code)
    : { error: 'No Scout name in the subject.' };
  var rec = hit.recordId ? Records.get(hit.recordId) : null;

  if (!rec) {
    var s = getSettings_();
    if (!s.intakeFolderId) throw new Error('Settings → intakeFolderId is empty: run Admin → Setup / repair tabs');
    var who = (p.name || subject).trim() + (p.unit ? ' (' + p.unit + ')' : '');
    var box = childFolder_(childFolder_(DriveApp.getFolderById(s.intakeFolderId), 'Council verified (no match)'),
      Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd') + ' ' + who);
    atts.forEach(function (a) { box.createFile(a.copyBlob()); });
    box.createFile(emailPdf('ReadyForEBoR-Email.pdf'));
    councilVerifiedRow_(msg, p, { 'Match': 'No match', 'How': hit.error, 'Files': atts.length,
      'To identify': atts.length > 1 ? 'which file is the verified application?' : '', 'Folder': box.getUrl() });
    return { matched: false, files: atts.length };
  }

  var folder = folderForRecord_(rec, true);
  var pl = CouncilVerified.plan(atts.map(function (a, i) { return { name: a.getName(), kind: kinds[i] }; }),
    rec.fields.scout_name, rec.fields.unit, Intake.namePart, Intake.unitPart);
  var old = CouncilVerified.toArchive(listFolder_(folder), pl);
  if (old.length) {
    var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
    listFolder_(folder).forEach(function (f) { if (old.indexOf(f.id) >= 0) f.file.moveTo(archive); });
  }
  pl.files.forEach(function (f) { folder.createFile(atts[f.index].copyBlob().setName(f.name)); });
  folder.createFile(emailPdf(pl.emailName));

  // Move ONLY a close match in Application Submitted / Proposal Approved, through the "Application verified…" row
  // action (date = the email's; fills Application Verified; the EBoR next-steps email is drafted into the Outbox).
  var dec = CouncilVerified.decide(hit, rec.section);
  var stage = SettingsModel.sectionLabel(getSettings_(), rec.section), moved = '';
  if (dec.promote) {
    try {
      var req = { kind: 'app_verified', recordId: rec.recordId, date: Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd') };
      rowExecute_({ email: 'Eagle Tracker', me: { initials: 'Council', name: 'Eagle Tracker' } }, rowCheck_(req), req, []);
      moved = 'moved to Application Verified (' + Utilities.formatDate(msg.getDate(), tz, 'M/d') + '); EBoR next-steps email in the Outbox';
    } catch (e) {
      dec = { match: 'Stage?', promote: false };
      stage += ' (not moved: ' + (e.userMessage || e.message) + ')';
    }
  }
  councilVerifiedRow_(msg, p, { 'Match': dec.match, 'Scout': rec.fields.scout_name + ' (' + rec.fields.unit + ')', 'Stage': stage,
    'Record ID': rec.recordId, 'How': hit.how, 'Files': pl.files.length, 'To identify': pl.toIdentify.join('; '), 'Folder': folder.getUrl() });
  var n = pl.files.length;
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [Council] Ready for EBOR: Council verified the Eagle application' +
    (hit.close ? '' : ' (CHECK the match: ' + hit.how + ', the email says ' + [p.name, p.unit].filter(String).join(', ') + ')') + '; ' +
    (pl.verified >= 0 ? 'Verified Application filed' : 'NO file identified as the Verified Application') +
    (n > 1 ? ', ' + n + ' files in all' : '') + (old.length ? '; the application as submitted moved to Archive/' : '') +
    (pl.toIdentify.length ? '; which document is which? ' + pl.toIdentify.join('; ') : '') + (moved ? '; ' + moved : '') +
    (dec.match === 'Stage?' ? '; NOT moved: the Scout is in ' + stage + ' (check it)' : ''));
  return { matched: true, recordId: rec.recordId, files: n };
}

function ensureCouncilVerifiedTab_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CouncilVerified.TAB);
  if (!sh) {
    sh = ss.insertSheet(CouncilVerified.TAB);
    sh.getRange(1, 1, 1, CouncilVerified.HEADERS.length).setValues([CouncilVerified.HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return;
  }
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = CouncilVerified.HEADERS.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) sh.getRange(1, have.filter(String).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}

/** One row per email on the Council Verified tab; Checked ticked when Matched with nothing to identify. */
function councilVerifiedRow_(msg, p, fields) {
  var row = Tabs.append(CouncilVerified.TAB, Object.assign({ 'Received': msg.getDate(), 'Subject': msg.getSubject(),
    'Name on email': p.name, 'Unit on email': p.unit, 'Email': msg.getThread().getPermalink() }, fields));
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(CouncilVerified.TAB);
    var cell = sh.getRange(row, CouncilVerified.HEADERS.indexOf('Checked') + 1);
    cell.insertCheckboxes();
    if (fields['Match'] === 'Matched' && !fields['To identify']) cell.check();
  } catch (e) { console.warn('Council Verified checkbox: ' + e); }
}

/** Digest → Awaiting action (beside the Formsite rows). */
function councilVerifiedToCheck_() {
  var rows;
  try { rows = Tabs.read(CouncilVerified.TAB); } catch (e) { return []; }
  return CouncilVerified.toCheck(rows, function (d) { return Utilities.formatDate(d, digestTz_(), 'M/d'); });
}

/** Admin menu: run it now (same rules as the hourly trigger). */
function menuCouncilVerified() {
  var ui = SpreadsheetApp.getUi();
  if (!councilAccountOk_()) return;
  if (!digestTriggerInstalled_()) {
    ui.alert('Run this as the account that owns the hourly trigger (cc-advancement): the "Ready for EBOR" emails are in its inbox, ' +
      'and this menu reads the inbox of whoever clicks it.');
    return;
  }
  var r = runCouncilVerified_();
  if (r.off) { ui.alert('Off: put a date (YYYY-MM-DD) in Settings → councilVerifiedFrom. Only "Ready for EBOR" emails from that day on are filed.'); return; }
  ui.alert('"Ready for EBOR" emails: ' + r.filed + ' filed, ' + r.nomatch + ' with no matching Scout, ' + r.errors + ' errors.');
}
