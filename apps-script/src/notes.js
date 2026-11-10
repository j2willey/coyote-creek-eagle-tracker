/**
 * Life to Eagle Log (M6): one Google Doc per Scout, in their folder, named
 * "<Name> - <Unit> - Life to Eagle Log", NEWEST LINE AT THE TOP. Internal
 * only: never shown to Scouts.
 *
 * The tracking sheet has ONE Notes column: it shows the latest line, and the
 * text is a link to the log. The log's ID is also kept in the hidden _log_id
 * column, so a lost link (someone typed over or pasted) is always restored.
 */
function rememberLog_(recordId, doc) {
  if (Records.columns().indexOf('_log_id') >= 0) Records.update(recordId, { _log_id: doc.getId() });
}

/** The Scout's log; created (seeded with seedText) if missing. */
function logFor_(rec, seedText) {
  var id = String(rec.fields._log_id || '').trim();
  if (id) {
    try { var f = DriveApp.getFileById(id); if (!f.isTrashed()) return DocumentApp.openById(id); }
    catch (e) { /* deleted: find or make another */ }
  }
  var folder = folderForRecord_(rec, true);
  var name = ScoutFiles.notesDocName(rec.fields.scout_name, rec.fields.unit);
  var it = folder.getFilesByName(name);
  var doc;
  if (it.hasNext()) {
    doc = DocumentApp.openById(it.next().getId());
  } else {
    doc = DocumentApp.create(name);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
    var body = doc.getBody();
    var seed = String(seedText || '').trim();
    body.getParagraphs()[0].setText(seed ? '— Earlier notes (copied from the tracking sheet on ' + Intake.shortDate(new Date()) + ') —'
                                         : '— Log started ' + Intake.shortDate(new Date()) + ' —');
    if (seed) seed.split(/\r?\n/).forEach(function (l) { body.appendParagraph(l); });
    doc.saveAndClose();
    doc = DocumentApp.openById(doc.getId());
  }
  rememberLog_(rec.recordId, doc);
  return doc;
}

/** Notes cell shows `text`, linked to the log. */
function setNotesCell_(recordId, text, url) {
  linkCellText_(recordId, 'notes', url, text == null ? '' : text);
}

/** Dated line → top of the log; cell shows it, linked. seedText: cell content if the log is new. */
function postNote_(rec, line, seedText) {
  var doc = logFor_(rec, seedText);
  doc.getBody().insertParagraph(0, line);
  doc.saveAndClose();
  setNotesCell_(rec.recordId, line, doc.getUrl());
}

/**
 * Cutover / one-time: give every Scout a log. Empty Notes cell → "<date> [Log
 * started]". Existing notes → copied into the log as earlier notes; the cell
 * keeps its text, now linked. Run "Folders: apply report" FIRST so logs land
 * in the real folders. Works in batches (Apps Script stops after ~6 min):
 * run again to continue.
 */
function menuStartLogs() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Start a Life to Eagle Log for every Scout?',
    'Run "Folders: apply report" first (production), so logs go into the existing Scout folders.\n\n' +
    'Empty Notes cells get "[Log started]"; existing notes are copied into the log and the cell becomes a link. ' +
    'Stops after ~4 minutes; run again to continue.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var t0 = Date.now(), made = 0, linked = 0, failed = [], noFolder = [];
  var noLog = function (r) { return !String(r._log_id || '').trim(); };
  var recs = Records.all(['scout_name', 'unit', 'notes', '_log_id']).filter(function (r) { return String(r.scout_name).trim(); });
  if (Records.columns().indexOf('_log_id') < 0) { ui.alert('Run Admin → Setup / repair tabs first (adds the hidden _log_id column).'); return; }
  var todo = recs.filter(noLog);
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - t0 > 4 * 60 * 1000) break;
    var r = todo[i];
    try {
      var rec = Records.get(r.recordId);
      // Never create folders here: a Scout whose folder isn't linked or in 202x (e.g. moved to 2026, not yet
      // linked by "Folders: apply report") would get a stray new folder.
      if (!folderForRecord_(rec, false)) { noFolder.push(rec.fields.scout_name); continue; }
      var cellText = String(rec.fields.notes || '').trim();
      if (cellText) {
        var doc = logFor_(rec, cellText);
        setNotesCell_(rec.recordId, cellText, doc.getUrl());
        linked++;
      } else {
        postNote_(rec, Intake.shortDate(new Date()) + ' [Log started]', '');
        made++;
      }
    } catch (e) { failed.push(r.recordId + ': ' + e.message); }
  }
  var left = Records.all(['scout_name', '_log_id']).filter(function (r) { return String(r.scout_name).trim() && noLog(r); }).length;
  ui.alert('Logs started: ' + made + ' new, ' + linked + ' from existing notes.' +
    (failed.length ? '\nProblems (' + failed.length + '):\n' + failed.slice(0, 10).join('\n') : '') +
    (noFolder.length ? '\n\nSkipped, no linked folder (' + noFolder.length + '): ' + noFolder.slice(0, 15).join(', ') +
      (noFolder.length > 15 ? ', …' : '') + '\nProduction: Folders: apply report. Staging: Folders: create for Scouts without an EBoR date.' : '') +
    (left - noFolder.length > 0 ? '\n\n' + (left - noFolder.length) + ' Scout(s) still without a log: run it again.'
      : (noFolder.length ? '' : '\n\nEvery Scout has a log.')));
}
