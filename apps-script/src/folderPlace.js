/**
 * Where a Scout's folder lives (Jim W., 2026-10-23). Rules in lib/eagleDone.js (placeFor):
 * 202x while active; the EBoR year folder once an EBoR date is set (moved again if the board moves to another year);
 * Exceptions for Eagle Not Awarded / Proposal Not Approved; EBoR Paused stays put until booked again.
 *
 * Event-driven: Records.move and Records.update (when the EBoR Date changes) call placeFolderQuietly_. Only folders
 * linked to the record (hidden _folder_id) are moved. Admin → "Folders: place by stage…" checks every Scout
 * (report first, then apply).
 */
function folderTarget_(rec) {
  var s = getSettings_();
  var eborCol = stageColumns_().ebor;
  return EagleDone.placeFor(rec.section, eborCol ? Intake.dateKey(rec.fields[eborCol]) || '' : '', s);
}

/** -> {folder, from, to} when the record's folder is not where it belongs; null otherwise. */
function folderMovePlan_(rec) {
  var name = folderTarget_(rec);
  if (!name) return null;
  var folder = linkedFolder_(rec);
  if (!folder) return null;
  var parents = folder.getParents();
  var cur = parents.hasNext() ? parents.next() : null;
  var rootId = String(getSettings_().scoutsFolderId || '');
  if (cur && cur.getName() === name) {
    var up = cur.getParents();
    if (!up.hasNext() || up.next().getId() === rootId) return null;     // already in <Scouts>/<name>
  }
  return { folder: folder, from: cur ? cur.getName() : '(none)', to: name };
}

function placeFolder_(recordId) {
  var rec = Records.get(recordId);
  if (!rec) return null;
  var p = folderMovePlan_(rec);
  if (!p) return null;
  var s = getSettings_();
  if (!s.scoutsFolderId) return null;
  var target = childFolder_(DriveApp.getFolderById(s.scoutsFolderId), p.to);
  p.folder.moveTo(target);
  addRecordNote_(recordId, Intake.shortDate(new Date()) + ' [tool] Folder moved from ' + p.from + '/ to ' + p.to + '/');
  return p;
}

/** Never throws: filing the folder must not break the action that triggered it. */
function placeFolderQuietly_(recordId) {
  try { return placeFolder_(recordId); } catch (e) { console.warn('placeFolder_ ' + recordId + ': ' + e); return null; }
}

/** Admin → Folders: place by stage (202x / EBoR year / Exceptions): report, then apply on OK. */
function menuPlaceFolders() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var plans = [];
  Records.all(['scout_name']).forEach(function (r) {
    try {
      var rec = Records.get(r.recordId);
      var p = rec && folderMovePlan_(rec);
      if (p) plans.push({ id: r.recordId, name: rec.fields.scout_name, p: p });
    } catch (e) { /* no access: skip */ }
  });
  if (!plans.length) { ui.alert('Every linked folder is already where it belongs.'); return; }
  var lines = plans.slice(0, 40).map(function (x) { return x.name + ': ' + x.p.from + '/ → ' + x.p.to + '/'; });
  var ok = ui.alert('Folders: ' + plans.length + ' to move', lines.join('\n') + (plans.length > 40 ? '\n… and ' + (plans.length - 40) + ' more' : '') +
    '\n\nMove them now? (Each move is logged.)', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var done = 0;
  plans.forEach(function (x) { if (placeFolderQuietly_(x.id)) done++; });
  ui.alert('Moved ' + done + ' of ' + plans.length + ' folders.');
}
