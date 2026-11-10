/**
 * Admin → "Anonymize this STAGING sheet (fake Scouts)…" (rules in lib/anonymize.js).
 *
 * Refuses unless the file is a non-production copy (name starts with STAGING / contains Test Copy)
 * AND test mode is on. Per Scout, in row order:
 *   tracking row: name → Scout_<n>, Scout/parent email → plus-addresses of one test inbox,
 *                 phone → 408-555-1212, BSA ID cleared, coach → Coach_<n>, Notes and the hidden
 *                 EBoR cc list scrubbed (names, emails, phones);
 *   Preferred Name cleared;
 *   Drive: a folder or log OUTSIDE the staging Scouts folder (Settings → scoutsFolderId, whose name must start with
 *                 STAGING) is only unlinked, never touched: a copy of production links to production's files.
 *                 Staging's own folders (linked, or mock folders found by the old name in its 202x/<year> folders)
 *                 are renamed Scout_<n> - <unit>, with their files; staging's own logs are trashed and unlinked
 *                 (Logs: start makes new ones). (Jim W., 2026-11-09)
 *   schedule sheet (only if its file name starts with STAGING): booked rows show the new name.
 * Then every tab holding names or emails of Scouts is emptied: Activity, Intake Queue, Uploads Log, Outbox,
 * Council Applications, Folder Report, Schedule Check, Unit Requests, Digest Log, sign-in sessions.
 * Batches of ~4.5 minutes: run again until it says done. Rows already named Scout_<n> are skipped.
 */
function menuAnonymizeStaging() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  if (!SheetKind.isNonProduction(ss.getName())) { ui.alert('Refusing: this is not a STAGING / Test Copy file. Never on production.'); return; }
  var s = getSettings_();
  if (s.testMode === false) { ui.alert('Refusing: Settings → testMode must be TRUE on the staging sheet first.'); return; }

  var r1 = ui.prompt('Anonymize "' + ss.getName() + '"?',
    'Every Scout becomes Scout_<n> with fake emails and phones (birth dates, units, stages and projects stay). ' +
    'Staging\'s own folders are renamed Scout_<n> and its logs trashed (run Logs: start after); links to any other Drive files are only removed. This cannot be undone.\n\n' +
    'Test inbox for the fake addresses (Scout_1 → name+Scout_1@…):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var base = String(r1.getResponseText() || '').trim() || String(s.testRecipient || '');
  if (!Anonymize.plusAddress(base, 'x')) { ui.alert('"' + base + '" is not an email address.'); return; }
  var r2 = ui.prompt('Type ANONYMIZE to confirm', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK || String(r2.getResponseText()).trim() !== 'ANONYMIZE') { ui.alert('Not confirmed: nothing changed.'); return; }

  var res = anonymizeStaging_(base);
  ui.alert(res.done
    ? 'Done: ' + res.changed + ' Scouts anonymized this run (' + res.total + ' in all). Tabs with Scout names or emails emptied (Activity, Intake Queue, Uploads Log, Outbox, Council Applications, Folder Report, Schedule Check, Unit Requests, Digest Log, sign-ins); staging folders renamed; schedule names updated. Next: Logs: start.' +
      (res.problems.length ? '\n\nProblems (' + res.problems.length + '):\n' + res.problems.slice(0, 10).join('\n') : '') +
      '\n\nStill real (by design): Key 3 / Unit Contacts / Committee tabs (adults; test mode keeps their mail to you). ' +
      'Check the staging Scouts folder for folders still named after real Scouts (not matched to a row): trash them by hand.'
    : res.changed + ' Scouts anonymized; ' + res.left + ' left. Run it again (it continues where it stopped).');
}

function anonymizeStaging_(base) {
  var t0 = Date.now();
  var cols = Records.columns();
  var want = ['scout_name', 'preferred_name', 'unit', 'scout_email', 'parent_email', 'scout_phone', 'bsa_id', 'proj_coach', 'notes', '_cc', '_folder_id', '_log_id'];
  var problems = [];
  var drive = stagingDrive_(problems);
  var recs = Records.all(want);
  var changed = 0, left = 0;
  var renamed = {};                                         // recordId -> new name (for the schedule sheet)
  recs.forEach(function (r, i) { if (Anonymize.isFake(r.scout_name)) renamed[r.recordId] = String(r.scout_name).trim(); });

  for (var i = 0; i < recs.length; i++) {
    var r = recs[i];
    var oldName = String(r.scout_name || '').trim();
    if (!oldName || Anonymize.isFake(oldName)) continue;
    if (Date.now() - t0 > 270 * 1000) { left++; continue; }
    var n = i + 1;
    var f = Anonymize.fakeFields(n, base, r.proj_coach);
    var scrub = function (text) { return Anonymize.scrub(text, oldName, f.scout_name, base, n); };
    try {
      var upd = {};
      Object.keys(f).forEach(function (k) { if (cols.indexOf(k) >= 0) upd[k] = f[k]; });
      if (cols.indexOf('preferred_name') >= 0) upd.preferred_name = '';
      if (cols.indexOf('notes') >= 0) upd.notes = scrub(r.notes);
      if (cols.indexOf('_cc') >= 0 && String(r._cc || '').trim()) upd._cc = scrub(r._cc);
      // Unlink Drive: a copy of production links to PRODUCTION folders and logs, which must never be renamed or
      // edited from here. Staging makes new "Scout_<n> - <unit>" folders and logs when it needs them.
      var own = drive ? stagingFolderFor_(drive, r, oldName) : null;
      if (own) {
        try {
          own.setName(Intake.folderName(f.scout_name, r.unit));
          renameScoutFiles_(own, Intake.namePart(oldName) + '-' + Intake.unitPart(r.unit), Intake.namePart(f.scout_name) + '-' + Intake.unitPart(r.unit));
        } catch (e) { problems.push(r.recordId + ': folder not renamed (' + e.message + ')'); own = null; }
      }
      if (cols.indexOf('_folder_id') >= 0) upd._folder_id = own ? own.getId() : '';
      if (cols.indexOf('_log_id') >= 0) {
        if (drive && String(r._log_id || '').trim()) {
          try { var log = DriveApp.getFileById(String(r._log_id).trim()); if (insideStaging_(drive, log)) log.setTrashed(true); }
          catch (e) { /* gone or no access: just unlink */ }
        }
        upd._log_id = '';
      }
      Records.update(r.recordId, upd);
      renamed[r.recordId] = f.scout_name;
      changed++;
    } catch (e) { problems.push(r.recordId + ': ' + e.message); }
  }
  try { unlinkColumns_(['scout_name', 'notes']); } catch (e) { problems.push('unlinking name/notes cells: ' + e.message); }
  if (left) return { done: false, changed: changed, left: left, total: recs.length, problems: problems };

  // Schedule sheet: booked rows show the new names; names not linked to a record are cleared.
  // Only a STAGING / Test Copy schedule file (a copy of production's Settings would point at the real one).
  try {
    var schedName = SpreadsheetApp.openById(getSettings_().scheduleSheetId).getName();
    if (!SheetKind.isNonProduction(schedName)) throw new Error('Settings → scheduleSheetId points at "' + schedName +
      '", not a STAGING file: not touched. Point it at the staging schedule and run again.');
    withLock_(function () {
      var sched = readSchedule_();
      sched.rows.forEach(function (row) {
        var id = String(row.record_id || '').trim();
        var name = String(row.scout_name || '').trim();
        if (id && renamed[id] && name !== renamed[id]) writeSchedule_(sched, row._row, { scout_name: renamed[id] });
        else if (!id && name) writeSchedule_(sched, row._row, { scout_name: '' });
      });
    });
  } catch (e) { problems.push('schedule sheet: ' + e.message); }

  // Tabs holding names / emails of real Scouts: keep the header row only.
  [ACTIVITY_TAB, QUEUE_TAB, UPLOADS_TAB, OUTBOX_TAB, CouncilApp.TAB, FOLDER_REPORT_TAB, SCHEDULE_CHECK_TAB, UNIT_REQUESTS_TAB,
    DIGEST_LOG_TAB, SESSIONS_TAB, SIGNINS_TAB].forEach(function (name) {
    var sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  return { done: true, changed: changed, left: 0, total: recs.length, problems: problems };
}

/** Drop the links (to Drive folders / logs) from these tracking columns on every Scout row, keeping the text. */
function unlinkColumns_(columns) {
  withLock_(function () {
    var sh = getTrackingSheet_();
    var last = sh.getLastRow();
    var m = SheetModel.findMachineRow(sh.getRange(1, 1, Math.min(15, last), sh.getLastColumn()).getValues());
    if (!m) return;
    var first = m.row + 3;                                   // below the hidden machine row and the label row
    if (last < first) return;
    columns.forEach(function (c) {
      if (m.map[c] === undefined) return;
      var rng = sh.getRange(first, m.map[c] + 1, last - first + 1, 1);
      var plain = rng.getDisplayValues().map(function (row) { return [SpreadsheetApp.newRichTextValue().setText(row[0]).build()]; });
      rng.setRichTextValues(plain);
    });
  });
}

/**
 * Staging's own Scouts folder (Settings → scoutsFolderId), only when its name starts with STAGING / Test Copy:
 * {rootId, parents: [202x, <year> folders]} or null (then folders and logs are only unlinked).
 */
function stagingDrive_(problems) {
  try {
    var id = String(getSettings_().scoutsFolderId || '').trim();
    if (!id) return null;
    var root = DriveApp.getFolderById(id);
    if (!SheetKind.isNonProduction(root.getName())) {
      problems.push('Settings → scoutsFolderId is "' + root.getName() + '", not a STAGING folder: folders and logs only unlinked, not touched.');
      return null;
    }
    var parents = folderReportParents_().map(function (n) { var it = root.getFoldersByName(n); return it.hasNext() ? it.next() : null; }).filter(Boolean);
    return { rootId: root.getId(), parents: parents };
  } catch (e) { problems.push('staging Scouts folder: ' + e.message); return null; }
}

/** True when a Drive file or folder sits inside the staging Scouts folder (up to 4 levels). */
function insideStaging_(drive, item) {
  var queue = [item], depth = 0;
  while (queue.length && depth < 5) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      var it = queue[i].getParents();
      while (it.hasNext()) { var p = it.next(); if (p.getId() === drive.rootId) return true; next.push(p); }
    }
    queue = next; depth++;
  }
  return false;
}

/** The Scout's folder when it belongs to staging: the linked one (if inside), else a mock folder named after the old name. */
function stagingFolderFor_(drive, r, oldName) {
  var id = String(r._folder_id || '').trim();
  if (id) {
    try { var f = DriveApp.getFolderById(id); return insideStaging_(drive, f) ? f : null; } catch (e) { return null; }
  }
  var name = Intake.folderName(oldName, r.unit);
  for (var i = 0; i < drive.parents.length; i++) {
    var it = drive.parents[i].getFoldersByName(name);
    if (it.hasNext()) return it.next();
  }
  return null;
}
