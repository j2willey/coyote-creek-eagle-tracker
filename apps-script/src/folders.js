/**
 * Cutover tool: reconcile the per-Scout folders in <scoutsFolderId>/202x and the
 * tracking tab's year folder (e.g. 2026, where folders move once the EBoR is set)
 * with the Candidate Records (rules in lib/folderMatch.js). Settings →
 * folderReportFolders overrides the list of subfolders scanned.
 *
 * 1. Admin → Folders: match to Scouts (report)   read-only. Writes the
 *    "Folder Report" tab: one row per folder with the proposed match, plus the
 *    Scouts that have no folder. Unique matches are pre-ticked in "Apply?".
 * 2. A person reviews it: untick wrong ones, type a Record ID for ambiguous
 *    ones and tick them.
 * 3. Admin → Folders: apply report   renames ticked folders to
 *    "<Name> - <Unit>" from the sheet and links them (hidden _folder_id column + Scout name link), so the
 *    tools use them. Optionally prefixes unresolved folders with "___".
 * The report keeps every original name, so any rename can be undone by hand.
 */
var FOLDER_REPORT_TAB = 'Folder Report';
var FOLDER_REPORT_HEADERS = ['Apply?', 'Folder (current name)', 'Match', 'Record ID', 'Scout (sheet)', 'Unit (sheet)',
  'Expected name (sheet)', 'Note', 'Folder ID', 'Result', 'In'];   // column order is read by menuFolderApply; add new ones at the end

/** Subfolders of the Scouts folder to scan: Settings → folderReportFolders, else 202x + the tracking tab's year. */
function folderReportParents_() {
  var s = getSettings_();
  var names = String(s.folderReportFolders || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!names.length) {
    var year = (/(20\d\d)/.exec(String(s.trackingTab)) || [])[1] || String(new Date().getFullYear());
    names = [s.inProgressFolder || '202x', year];
  }
  return names;
}

function menuFolderReport() {
  var ui = SpreadsheetApp.getUi();
  try {
    var s = getSettings_();
    if (!s.scoutsFolderId) throw new Error('Settings → scoutsFolderId is empty');
    var root = DriveApp.getFolderById(s.scoutsFolderId);
    var parents = folderReportParents_();
    // Common slip: scoutsFolderId set to 202x (or a year folder) itself. Use the folder above it.
    if (parents.indexOf(root.getName()) >= 0) {
      var up = root.getParents();
      if (up.hasNext()) root = up.next();
    }
    var folders = [], scanned = [], missing = [];
    parents.forEach(function (pn) {
      var pit = root.getFoldersByName(pn);
      if (!pit.hasNext()) { missing.push(pn); return; }
      var n = 0;
      while (pit.hasNext()) {
        var it = pit.next().getFolders();
        while (it.hasNext()) { var f = it.next(); folders.push({ id: f.getId(), name: f.getName(), parent: pn }); n++; }
      }
      scanned.push(pn + ' (' + n + ')');
    });
    var parentOf = {};
    folders.forEach(function (f) { parentOf[f.id] = f.parent; });
    var recs = Records.all(['scout_name', 'unit']).filter(function (r) { return String(r.scout_name).trim(); });
    var byId = {};
    recs.forEach(function (r) { byId[r.recordId] = r; });
    var res = FolderMatch.match(folders, recs);

    // "standard" = the folder name is already exactly "<Name> - <Unit>" from the sheet.
    res.folders.forEach(function (f) {
      var r = f.recordId ? byId[f.recordId] : null;
      f.newName = r ? Intake.folderName(r.scout_name, r.unit) : '';
      if (r && f.newName === f.name) f.kind = 'standard';
    });
    var ORDER = { 'standard': 0, 'exact name': 1, 'name words': 2, 'name typo': 3, 'ambiguous': 4, 'none': 5 };
    var rows = res.folders.sort(function (a, b) {
      return (ORDER[a.kind] - ORDER[b.kind]) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }).map(function (f) {
        var r = f.recordId ? byId[f.recordId] : null;
        return [!!r, f.name, f.kind, f.recordId || (f.candidates.length ? '? ' + f.candidates.join(' / ') : ''),
          r ? r.scout_name : '', r ? r.unit : '', f.newName, f.note, f.id, '',
          parentOf[f.id] || ''];
      });

    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(FOLDER_REPORT_TAB) || ss.insertSheet(FOLDER_REPORT_TAB);
    sh.clear();
    sh.getRange(1, 1, 1, FOLDER_REPORT_HEADERS.length).setValues([FOLDER_REPORT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (rows.length) {
      sh.getRange(2, 1, rows.length, FOLDER_REPORT_HEADERS.length).setValues(rows);
      sh.getRange(2, 1, rows.length, 1).insertCheckboxes();
    }
    var at = rows.length + 3;
    var none = res.recordsWithoutFolder.map(function (id) {
      return [id, byId[id].scout_name, byId[id].unit, Intake.folderName(byId[id].scout_name, byId[id].unit)];
    });
    sh.getRange(at, 1).setValue('Scouts on the tracking tab with no matched folder (' + none.length + '): Record ID, Scout, Unit, expected folder name')
      .setFontWeight('bold');
    if (none.length) sh.getRange(at + 1, 1, none.length, 4).setValues(none);
    sh.autoResizeColumns(2, 7);

    var count = function (k) { return res.folders.filter(function (f) { return f.kind === k; }).length; };
    ui.alert('Folder report written: ' + folders.length + ' folders in ' + scanned.join(', ') +
      (missing.length ? '\nNOT FOUND in the Scouts folder: ' + missing.join(', ') : '') + '.\n\n' +
      'Already standard: ' + count('standard') + '\nSame name, needs rename (spacing/unit): ' + count('exact name') + '\nName words (middle names etc.): ' + count('name words') +
      '\nTypos: ' + count('name typo') + '\nAmbiguous: ' + count('ambiguous') + '\nNo match: ' + count('none') +
      '\nScouts without a folder: ' + none.length + '\n\nReview the "' + FOLDER_REPORT_TAB + '" tab, then run "Folders: apply report". Nothing was renamed yet.');
  } catch (e) { ui.alert(e.message); }
}

function menuFolderApply() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(FOLDER_REPORT_TAB);
    if (!sh) { ui.alert('Run "Folders: match to Scouts (report)" first.'); return; }
    var n = sh.getLastRow() - 1;
    var vals = n > 0 ? sh.getRange(2, 1, n, FOLDER_REPORT_HEADERS.length).getValues() : [];
    var rows = [];
    for (var i = 0; i < vals.length && String(vals[i][8]).trim(); i++) rows.push({ i: i, v: vals[i] });   // stop at the "no folder" list
    var ticked = rows.filter(function (r) { return r.v[0] === true; });
    var unresolved = rows.filter(function (r) { return r.v[0] !== true; });
    if (ui.alert('Apply ' + ticked.length + ' ticked folder(s)?',
      'Each is renamed to "<Name> - <Unit>" from the tracking tab and linked to that Scout. The report keeps the old names.',
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

    var recs = {};
    Records.all(['scout_name', 'unit']).forEach(function (r) { recs[r.recordId] = r; });
    var done = 0, problems = 0;
    ticked.forEach(function (r) {
      var id = String(r.v[3]).trim(), result;
      try {
        if (!recs[id]) throw new Error('Record ID not found: ' + id);
        var folder = DriveApp.getFolderById(String(r.v[8]));
        var name = Intake.folderName(recs[id].scout_name, recs[id].unit);
        if (folder.getName() !== name) folder.setName(name);
        linkFolder_(id, folder);
        result = 'Linked' + (folder.getName() === String(r.v[1]) ? '' : ' + renamed');
        done++;
      } catch (e) { result = 'ERROR: ' + e.message; problems++; }
      sh.getRange(r.i + 2, 10).setValue(result);
    });

    var prefixed = 0;
    if (unresolved.length && ui.alert('Mark ' + unresolved.length + ' unresolved folder(s) with a "___" prefix?',
      'They sort to the top in Drive so someone can sort them out. You can remove the prefix any time.',
      ui.ButtonSet.YES_NO) === ui.Button.YES) {
      unresolved.forEach(function (r) {
        try {
          var f = DriveApp.getFolderById(String(r.v[8]));
          if (f.getName().indexOf('___') !== 0) { f.setName('___' + f.getName()); prefixed++; }
          sh.getRange(r.i + 2, 10).setValue('Prefixed ___');
        } catch (e) { sh.getRange(r.i + 2, 10).setValue('ERROR: ' + e.message); }
      });
    }
    ui.alert('Linked ' + done + (problems ? ', ' + problems + ' problem(s) (see Result column)' : '') +
      (prefixed ? '. Prefixed ' + prefixed + ' unresolved.' : '.'));
  } catch (e) { ui.alert(e.message); }
}

/**
 * Staging/dev only (fake data, no real folders): create "<Name> - <Unit>" in 202x for every Scout
 * without an EBoR date, and link it (hidden _folder_id + Scout name link). Existing folders are
 * found by name and linked, not duplicated. Production gets its links from "Folders: apply report".
 * Then run "Logs: start a Life to Eagle Log for every Scout".
 */
/**
 * Staging/dev rehearsal of production's folders: one UNLINKED "<Name> - <Unit>" folder per Scout, in 202x
 * (no EBoR date) or the year folder (EBoR date set), so "Folders: match to Scouts (report)" → "apply report"
 * → "Logs: start" can be rehearsed exactly as on production. Existing folders with the name are skipped.
 * Batches of ~4 minutes: run again until it says done.
 */
function menuMakeMockFolders() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  if (!SheetKind.isNonProduction(SpreadsheetApp.getActive().getName())) { ui.alert('Refusing: production sheet (staging/dev only).'); return; }
  var s = getSettings_();
  if (!s.scoutsFolderId) { ui.alert('Settings → scoutsFolderId is empty.'); return; }
  var parent = DriveApp.getFolderById(s.scoutsFolderId);
  var subs = folderReportParents_();                       // [202x, <year>]
  var sub = function (name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); };
  var inProgress = sub(subs[0]), done = sub(subs[1] || subs[0]);
  var eborCol = s.eborDateColumn || 'ebor_date';
  var recs = Records.all(['scout_name', 'unit', eborCol]).filter(function (r) { return String(r.scout_name).trim(); });
  if (ui.alert('Make mock folders?', recs.length + ' Scouts: one unlinked folder each in ' + inProgress.getName() + ' (no EBoR date) or ' +
    done.getName() + ' (EBoR date set). Existing folders with the same name are kept. Then run the folder report and apply it.',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var t0 = Date.now(), made = 0, kept = 0, left = 0;
  for (var i = 0; i < recs.length; i++) {
    if (Date.now() - t0 > 4 * 60 * 1000) { left = recs.length - i; break; }
    var r = recs[i];
    var name = Intake.folderName(r.scout_name, r.unit);
    var target = String(r[eborCol] == null ? '' : r[eborCol]).trim() ? done : inProgress;
    if (inProgress.getFoldersByName(name).hasNext() || done.getFoldersByName(name).hasNext()) { kept++; continue; }
    target.createFolder(name);
    made++;
  }
  ui.alert('Mock folders: ' + made + ' created, ' + kept + ' already there.' +
    (left ? '\n\n' + left + ' left: run it again.' : '\n\nNext: Folders: match to Scouts (report) → Folders: apply report → Logs: start.'));
}

function menuCreateMissingFolders() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  if (!SheetKind.isNonProduction(ss.getName())) {
    ui.alert('Refusing: production sheet. Use "Folders: match to Scouts (report)" and "Folders: apply report".');
    return;
  }
  var s = getSettings_();
  var eborCol = s.eborDateColumn || 'ebor_date';
  if (Records.columns().indexOf('_folder_id') < 0) { ui.alert('Run Admin → Setup / repair tabs first (adds the hidden _folder_id column).'); return; }
  var recs = Records.all(['scout_name', 'unit', eborCol, '_folder_id']).filter(function (r) {
    return String(r.scout_name).trim() && !String(r[eborCol] == null ? '' : r[eborCol]).trim();
  });
  var todo = recs.filter(function (r) { return !String(r._folder_id || '').trim(); });
  if (ui.alert('Create Scout folders?', todo.length + ' of ' + recs.length + ' Scouts without an EBoR date have no linked folder. ' +
    'Each gets "<Name> - <Unit>" in ' + (s.inProgressFolder || '202x') + ' (an existing folder with that name is linked instead).',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var t0 = Date.now(), made = 0, found = 0, failed = [];
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - t0 > 4 * 60 * 1000) break;
    try {
      var rec = Records.get(todo[i].recordId);
      var existing = findFolderForRecord_(rec, false);
      var f = existing || findFolderForRecord_(rec, true);
      linkFolder_(rec.recordId, f);
      if (existing) found++; else made++;
    } catch (e) { failed.push(todo[i].recordId + ': ' + e.message); }
  }
  var left = todo.length - made - found - failed.length;
  ui.alert('Folders created: ' + made + ', existing linked: ' + found + '.' +
    (failed.length ? '\nProblems (' + failed.length + '):\n' + failed.slice(0, 10).join('\n') : '') +
    (left > 0 ? '\n\n' + left + ' left: run it again.' : '\n\nNext: Logs: start a Life to Eagle Log for every Scout.'));
}
