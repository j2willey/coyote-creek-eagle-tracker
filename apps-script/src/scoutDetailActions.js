/**
 * Scout detail window (committee members). Rules in lib/scoutDetail.js.
 *
 * Router actions:
 *   scoutDetail {session, recordId}                  -> {recordId, name, unit, section, stage, folderUrl, logUrl, lastNote,
 *                                                        tabs, sections}
 *   scoutSave   {session, recordId, edits: {name: text}} -> {message}          (pencil: edit anything; logged old → new)
 *   scoutMove   {session, recordId, to, reason}       -> {message}          (escape hatch: any stage; reason required;
 *                                                                              no emails, no booking side effects)
 */
function detailHeaders_() {
  var sh = getTrackingSheet_();
  var lastCol = sh.getLastColumn();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), lastCol).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) throw new Error('Tracking tab has no machine header row.');
  return { sheet: sh, lastCol: lastCol, cols: ScoutDetail.layout(m.row > 0 ? top[m.row - 1] : [], top[m.row], top[m.row + 1] || []) };
}

function detailFields_(rec) {
  var h = detailHeaders_();
  var row = [];
  h.cols.forEach(function (c) { row[c.index] = rec.fields[c.name]; });
  var formulas = h.sheet.getRange(rec.row, 1, 1, h.lastCol).getFormulas()[0];
  return ScoutDetail.tabs(h.cols, row, formulas);
}

function actionScoutDetail_(req) {
  committeeMe_(req.session);
  var s = getSettings_();
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var folderId = String(rec.fields._folder_id || '').trim(), logId = String(rec.fields._log_id || '').trim();
  return {
    recordId: rec.recordId, name: EagleDone.display(rec.fields.scout_name, rec.fields.preferred_name), unit: String(rec.fields.unit || ''),
    section: rec.section, stage: SettingsModel.sectionLabel(s, rec.section),
    folderUrl: folderId ? 'https://drive.google.com/drive/folders/' + folderId : '',
    logUrl: logId ? 'https://docs.google.com/document/d/' + logId + '/edit' : '',
    lastNote: Board.firstLine(rec.fields.notes),
    pending: Pending.isPending(rec.fields[Pending.COLUMN]),
    tabs: detailFields_(rec),
    sections: (s.sections || []).map(function (x) { return { key: x.key, label: x.label }; })
  };
}

/** Page text -> the value written to the cell. */
function detailValue_(c) {
  var v = c.to;
  if (v === '') return '';
  if (c.type === 'date') return ymdToDate_(v);
  if (c.type === 'datetime') {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  if (c.type === 'bool') return v === 'true';
  if (c.type === 'number') return Number(v.replace(/[$,]/g, ''));
  return v;
}

function actionScoutSave_(req) {
  var c = committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var fields = [];
  detailFields_(rec).forEach(function (t) { fields = fields.concat(t.fields); });
  var r = ScoutDetail.changes(req.edits || {}, fields);
  if (r.errors.length) throw userError_(r.errors.join(' '));
  if (!r.changes.length) return { message: 'Nothing changed.' };
  var upd = {};
  var nameChange = null;
  r.changes.forEach(function (ch) {
    if (ch.name === 'scout_name') nameChange = ch.to;                      // keeps the cell's link to the folder (below)
    else upd[ch.name] = detailValue_(ch);
  });
  if (Object.keys(upd).length) Records.update(rec.recordId, upd);
  var folder = linkedFolder_(rec);
  if (nameChange !== null) {
    if (folder) linkCellText_(rec.recordId, 'scout_name', folder.getUrl(), nameChange);
    else Records.update(rec.recordId, { scout_name: nameChange });
  }
  var by = c.me.initials || c.email;
  var extra = '';
  // Name or unit changed: the folder (and log) names follow the committee's "<Name> - <Unit>" convention.
  var after = Records.get(rec.recordId);
  if (nameChange !== null || upd.unit !== undefined) extra = renameForChange_(after, rec.fields.scout_name, rec.fields.unit);
  addRecordNote_(rec.recordId, ScoutDetail.logLine(Intake.shortDate(new Date()), by, r.changes) + extra);
  return { message: 'Saved ' + r.changes.length + ' change' + (r.changes.length > 1 ? 's' : '') + extra + '.' };
}

/**
 * A Scout's name or unit changed (Scout detail Save, the Admin field comparison, or typed straight into the tracking
 * sheet, 2026-11-04): the folder ("<Name> - <Unit>"), the Life to Eagle Log and the tool's own files follow.
 * after: the record now; oldName / oldUnit: before the change. A row without a folder link: the folder is looked up by
 * its uploads or OLD name (and linked). -> "; folder renamed to …; 3 files renamed" or ''.
 */
function renameForChange_(after, oldName, oldUnit) {
  var extra = '';
  var folder = linkedFolder_(after);
  if (!folder) {
    try {
      folder = findFolderForRecord_({ recordId: after.recordId, section: after.section,
        fields: Object.assign({}, after.fields, { scout_name: oldName, unit: oldUnit }) }, false);
      if (folder) linkFolder_(after.recordId, folder);
    } catch (e) { console.warn('renameForChange_ find: ' + e); }
  }
  if (!folder) return '; no folder found to rename';
  // Failures are said out loud (Jim W., 2026-11-04: a folder that silently kept its old name), e.g. no rename right on a
  // Shared Drive (cc-advancement needs Content manager there).
  var newName = Intake.folderName(after.fields.scout_name, after.fields.unit);
  try {
    if (folder.getName() !== newName) { folder.setName(newName); extra = '; folder renamed to "' + newName + '"'; }
  } catch (e) { console.warn('rename folder: ' + e); extra = '; folder NOT renamed (' + e.message + ')'; }
  try {
    var logId = String(after.fields._log_id || '').trim();
    if (logId) DriveApp.getFileById(logId).setName(ScoutFiles.notesDocName(after.fields.scout_name, after.fields.unit));
  } catch (e) { console.warn('rename log: ' + e); extra += '; log NOT renamed (' + e.message + ')'; }
  try {
    var n = renameScoutFiles_(folder, Intake.namePart(oldName) + '-' + Intake.unitPart(oldUnit),
      Intake.namePart(after.fields.scout_name) + '-' + Intake.unitPart(after.fields.unit));
    if (n) extra += '; ' + n + ' file' + (n > 1 ? 's' : '') + ' renamed';
  } catch (e) { console.warn('rename files: ' + e); extra += '; files NOT renamed (' + e.message + ')'; }
  return extra;
}

/** Rename the tool's files (ScoutFiles.renamePlan) in a Scout folder and its subfolders, two levels deep. -> count */
function renameScoutFiles_(folder, oldPrefix, newPrefix) {
  var count = 0;
  (function walk(f, depth) {
    var plan = ScoutFiles.renamePlan(listFolder_(f), oldPrefix, newPrefix);
    plan.forEach(function (p) { DriveApp.getFileById(p.id).setName(p.to); count++; });
    if (depth < 2) { var it = f.getFolders(); while (it.hasNext()) walk(it.next(), depth + 1); }
  })(folder, 0);
  return count;
}

function actionScoutMove_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var to = String(req.to || '');
  if (!(s.sections || []).some(function (x) { return x.key === to; })) throw userError_('Pick the stage to move to.');
  if (to === rec.section) throw userError_('The Scout is already in that stage.');
  var reason = String(req.reason || '').trim();
  if (reason.length < 3) throw userError_('Give a short reason for the correction (it goes into the log).');
  Records.move(rec.recordId, to);
  clearPending_(rec.recordId);
  addRecordNote_(rec.recordId, ScoutDetail.moveLine(Intake.shortDate(new Date()), c.me.initials || c.email,
    SettingsModel.sectionLabel(s, rec.section), SettingsModel.sectionLabel(s, to), reason));
  return { message: rec.fields.scout_name + ' moved to ' + SettingsModel.sectionLabel(s, to) + ' (no emails sent).' };
}
