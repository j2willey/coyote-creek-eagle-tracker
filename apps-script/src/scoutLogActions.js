/**
 * Life to Eagle Log panel (dashboard: click a Scout's Last note). Rules in lib/scoutLog.js; the log itself is the
 * Scout's Google Doc (notes.js), newest line at the top.
 *
 * Router actions:
 *   scoutLog     {session, recordId}              -> {recordId, name, unit, stage, logUrl, text, initials}
 *   scoutLogAdd  {session, recordId, note}        -> {line, text, logUrl}   one line on top; "10/27 [JW]" added if missing
 *   scoutLogEdit {session, recordId, text, base}  -> {text, lastNote}      pencil: replace the whole text (correction).
 *                                                                           base = text the page loaded; refused if the
 *                                                                           log changed since. Doc version history keeps
 *                                                                           the old text.
 */
function logRecord_(req) {
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  return rec;
}

/** The log Doc if it exists (never creates one), else null. */
function existingLog_(rec) {
  var id = String(rec.fields._log_id || '').trim();
  if (!id) return null;
  try { var f = DriveApp.getFileById(id); return f.isTrashed() ? null : DocumentApp.openById(id); } catch (e) { return null; }
}

function logText_(doc) { return ScoutLog.cleanText(doc.getBody().getText()); }

function actionScoutLog_(req) {
  var c = committeeMe_(req.session);
  var rec = logRecord_(req);
  var doc = existingLog_(rec);
  return {
    recordId: rec.recordId, name: String(rec.fields.scout_name || ''), unit: String(rec.fields.unit || ''),
    stage: SettingsModel.sectionLabel(getSettings_(), rec.section),
    logUrl: doc ? doc.getUrl() : '',
    text: doc ? logText_(doc) : ScoutLog.cleanText(rec.fields.notes),   // no log yet: the Notes cell
    initials: c.me.initials || ''
  };
}

function actionScoutLogAdd_(req) {
  var c = committeeMe_(req.session);
  var line = ScoutLog.noteLine(req.note, Intake.shortDate(new Date()), c.me.initials || c.email.split('@')[0]);
  if (!line) throw userError_('Type a note first.');
  return withLock_(function () {
    var rec = logRecord_(req);
    addRecordNote_(rec.recordId, line);            // top of the log + Notes cell (link) + committee digest
    var doc = existingLog_(Records.get(rec.recordId));
    return { line: line, text: doc ? logText_(doc) : line, logUrl: doc ? doc.getUrl() : '' };
  });
}

function actionScoutLogEdit_(req) {
  var c = committeeMe_(req.session);
  var probs = ScoutLog.editProblems(req.text);
  if (probs.length) throw userError_(probs.join(' '));
  var text = ScoutLog.cleanText(req.text);
  return withLock_(function () {
    var rec = logRecord_(req);
    var doc = existingLog_(rec) || logFor_(rec, rec.fields.notes);
    var now = logText_(doc);
    if (!ScoutLog.same(now, req.base)) throw userError_('Someone added to this log since you opened it. Copy your changes, close the panel, open it again and redo them.');
    if (ScoutLog.same(now, text)) return { text: now, lastNote: ScoutLog.firstLine(now), message: 'Nothing changed.' };
    var body = doc.getBody();
    body.clear();
    var lines = text.split('\n');
    var p0 = body.getParagraphs()[0];
    p0.setText(lines[0]); p0.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    for (var i = 1; i < lines.length; i++) body.appendParagraph(lines[i]).setHeading(DocumentApp.ParagraphHeading.NORMAL);
    doc.saveAndClose();
    var first = ScoutLog.firstLine(text);
    setNotesCell_(rec.recordId, first, doc.getUrl());
    recordActivity_(rec, Intake.shortDate(new Date()) + ' [' + (c.me.initials || c.email) + '] Corrected the Life to Eagle Log');
    return { text: text, lastNote: first, message: 'Saved. The Google Doc\'s version history keeps the old text.' };
  });
}
