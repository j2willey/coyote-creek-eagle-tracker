/**
 * Closed records (Jim W., 2026-11-10). Rules in lib/closing.js.
 *
 * A record that will not come back (withdrew, aged out with no extension, extension denied, moved away, duplicate)
 * moves to the terminal "Closed" stage: visible, reversible, cleared once a year by the January archive
 * (adminActions.js). Dashboard row actions, handled from actionRowAction_ (rowActions.js):
 *   close      Close record…   reason, date, optional note -> Closed; _closed remembers {reason, date, by, from, note}
 *   reopen     Reopen…         back to where it came from (or a chosen stage); a reason is required
 *   keep       Keep open       hides the "Close?" suggestion for Settings → closeSnoozeDays
 * None of them sends an email (members can still use Email…), clears "new files" and writes the Life to Eagle Log.
 * The Scout's folder does NOT move when a record is closed (the January archive moves it).
 */

/** The row actions above. c: committeeMe_ result; req: the rowAction request. */
function actionClosing_(c, req) {
  var a = StageActions.get(String(req.kind || ''));
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var s = getSettings_();
  if (a.sections.indexOf(rec.section) < 0) {
    throw userError_(rec.fields.scout_name + ' is now in ' + SettingsModel.sectionLabel(s, rec.section) + ', where "' + a.label.replace(/…$/, '') + '" does not apply. Reload the page.');
  }
  var cols = Records.columns();
  var needCol = a.closing === 'keep' ? Closing.SNOOZE_COLUMN : Closing.COLUMN;
  if (cols.indexOf(needCol) < 0) throw userError_('The tracking tab has no hidden ' + needCol + ' column yet. Run Admin → Setup / repair tabs, then try again.');
  var by = c.me.initials || c.email, today = todayYmd_(), short = Intake.shortDate(new Date());
  var scout = String(rec.fields.scout_name || '');
  var cleared = {};
  cleared[Closing.COLUMN] = '';
  if (cols.indexOf(Closing.SNOOZE_COLUMN) >= 0) cleared[Closing.SNOOZE_COLUMN] = '';

  if (a.closing === 'close') {
    var p = Closing.closePlan({ section: rec.section, reason: req.reason, reasonText: req.reasonText, date: req.date, today: today, note: req.note, by: by });
    if (p.errors.length) throw userError_(p.errors.join(' '));
    var cell = {};
    cell[Closing.COLUMN] = Closing.closedCell(p.closed);
    Records.update(rec.recordId, cell);
    try { Records.move(rec.recordId, Closing.SECTION); }
    catch (e) { Records.update(rec.recordId, cleared); throw e; }          // no Closed section yet: leave the record as it was
    clearPending_(rec.recordId);
    addRecordNote_(rec.recordId, Closing.closeLine(short, by, p.closed.r, p.closed.n));
    return { message: scout + ': closed (' + p.closed.r + '). No email was sent; the folder has not moved. Reopen is on the Closed row.', outboxId: '' };
  }

  if (a.closing === 'reopen') {
    var closed = Closing.parseClosed(rec.fields[Closing.COLUMN]);
    var keys = (s.sections || []).map(function (x) { return x.key; });
    var rp = Closing.reopenPlan({ closed: closed, to: req.to, reason: req.note, sectionKeys: keys });
    if (rp.errors.length) throw userError_(rp.errors.join(' '));
    Records.update(rec.recordId, cleared);
    Records.move(rec.recordId, rp.to);
    clearPending_(rec.recordId);
    addRecordNote_(rec.recordId, Closing.reopenLine(short, by, SettingsModel.sectionLabel(s, rp.to), req.note));
    return { message: scout + ': reopened in ' + SettingsModel.sectionLabel(s, rp.to) + '. No email was sent.', outboxId: '' };
  }

  // keep: snooze the "Close?" suggestion
  var days = Closing._util.posInt(s.closeSnoozeDays, Closing.DEFAULT_SNOOZE_DAYS);
  var until = Closing._util.addDays(today, days);
  var snz = {};
  snz[Closing.SNOOZE_COLUMN] = until;
  Records.update(rec.recordId, snz);
  var n = String(req.note || '').replace(/\s+/g, ' ').trim();
  addRecordNote_(rec.recordId, short + ' [' + by + '] Kept open: close review snoozed ' + days + ' days' + (n ? ' (' + n + ')' : ''));
  return { message: scout + ': kept open; no "Close?" suggestion for ' + days + ' days.', outboxId: '' };
}

/**
 * Which open Exceptions rows look terminal: {recordId: why}. Proposal Not Approved / EBoR Paused only (lib/closing.js).
 * Last activity = the newest Activity tab line of the record (every log line and Scout update lands there); read only
 * when there are such rows. Settings → closeReviewDays; "Keep open" snoozes a row (hidden _close_snooze column).
 * Feeds the dashboard's amber "Close?" tag and the digest's "Exceptions to review". Never throws.
 */
function closeSuggestions_() {
  var out = {};
  try {
    var s = getSettings_();
    var recs = Records.all(['scout_name', 'birth_date', STAGE_SINCE_COL, Closing.SNOOZE_COLUMN])
      .filter(function (r) { return Closing.REVIEW_SECTIONS.indexOf(r.section) >= 0 && String(r.scout_name || '').trim(); });
    if (!recs.length) return out;
    var want = {}, last = {}, tz = digestTz_();
    recs.forEach(function (r) { want[r.recordId] = true; });
    try {
      Tabs.read(ACTIVITY_TAB).forEach(function (x) {
        var id = String(x['Record ID'] || '');
        if (!want[id]) return;
        var d = x['When'] instanceof Date ? x['When'] : new Date(x['When']);
        if (isNaN(d.getTime())) return;
        var ymd = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
        if (!last[id] || ymd > last[id]) last[id] = ymd;
      });
    } catch (e) { console.warn('closeSuggestions_ activity: ' + e); }
    Closing.suggestions(recs.map(function (r) {
      return { recordId: r.recordId, section: r.section, birth: Intake.dateKey(r.birth_date) || '', lastActivity: last[r.recordId] || '',
        stageSince: Closing.stageSinceDate(r[STAGE_SINCE_COL], r.section), snoozeUntil: Intake.dateKey(r[Closing.SNOOZE_COLUMN]) || '' };
    }), { today: todayYmd_(), reviewDays: s.closeReviewDays }).forEach(function (x) { out[x.recordId] = x.why; });
  } catch (e) { console.warn('closeSuggestions_: ' + e); }
  return out;
}

// ---------- January archive of Closed records (Admin page) ----------

/** The tracking rows that are Closed, with what the archive and its report need. */
function closedRecords_() {
  var aCol = approvedDateColumn_(), eCol = String(getSettings_().eborDateColumn || 'ebor_date');
  return Records.all(['scout_name', 'unit', aCol, eCol, '_folder_id', Closing.COLUMN].filter(String))
    .filter(function (r) { return r.section === Closing.SECTION; })
    .map(function (r) {
      return { recordId: r.recordId, section: r.section, scout_name: String(r.scout_name || '').trim(), unit: String(r.unit || '').trim(),
        closed: Closing.parseClosed(r[Closing.COLUMN]), approved: aCol ? (Intake.dateKey(r[aCol]) || '') : '', ebor: Intake.dateKey(r[eCol]) || '',
        folderId: String(r._folder_id || '').trim() };
    });
}

/** The dry run, shown on the Admin page: Closed rows closed in a past year, and what Apply will do. */
function closedArchiveReport_() {
  var recs = closedRecords_();
  var c = Closing.archiveCandidates(recs, new Date().getFullYear());
  return { rows: c.rows, years: c.years, noDate: c.noDate, total: recs.filter(function (r) { return r.scout_name; }).length,
    folder: Closing.folderPath(getSettings_().closedFolder).join('/'), thisYear: new Date().getFullYear() };
}

/**
 * Admin: archive the Closed records of past years. Per record: the Scout's folder moves to <Scouts folder>/Archive/Closed
 * (Settings → closedFolder, created when missing), a row (no contact details) goes to the "Closed Records" tab, the
 * move is logged, and the row leaves the tracking tab. A record whose folder can't be moved is left on the tracking tab
 * and reported; nothing is deleted before its row is on the Closed Records tab. Without confirm: the dry-run list.
 * req: {session, confirm}
 */
function actionAdminClosedArchive_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var recs = closedRecords_();
  var cand = Closing.archiveCandidates(recs, new Date().getFullYear());
  var path = Closing.folderPath(s.closedFolder);
  if (!cand.rows.length) throw userError_('No Closed records from a past year on the tracking tab.');
  if (!req.confirm) return { needsConfirm: true, rows: cand.rows, folder: path.join('/'), noDate: cand.noDate };
  if (!s.scoutsFolderId) throw userError_('Settings → scoutsFolderId is empty: the folders can\'t be moved.');
  var have = {};
  try {                                                         // the tab and its columns first: nothing moves before this passes
    var tab = Tabs.sheet(Closing.ARCHIVE_TAB);
    var head = tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
    var miss = Closing.ARCHIVE_HEADERS.filter(function (h) { return head.indexOf(h) < 0; });
    if (miss.length) throw new Error('The ' + Closing.ARCHIVE_TAB + ' tab is missing the column(s) ' + miss.join(', '));
    Tabs.read(Closing.ARCHIVE_TAB).forEach(function (r) { have[String(r['Record ID'] || '')] = true; });
  } catch (e) { throw userError_(e.message + '. Run Admin → Setup / repair tabs, then try again.'); }
  cand.years.forEach(function (y) { addStatsYear_(y.year); });  // the year's numbers (closures included) go to Stats History first
  var byId = {};
  recs.forEach(function (r) { byId[r.recordId] = r; });
  var target = null, today = todayYmd_(), short = Intake.shortDate(new Date());
  var stageLabel = function (k) { return SettingsModel.sectionLabel(s, k); };
  var done = [], failed = [];
  cand.rows.forEach(function (x) {
    var r = byId[x.recordId];
    try {
      var rec = Records.get(x.recordId);
      if (!rec || rec.section !== Closing.SECTION) return;                     // changed since the list was made
      var folder = null;
      if (r.folderId) {
        folder = linkedFolder_(rec);
        if (!folder) throw new Error('its Drive folder can\'t be found or opened');
        if (!target) { target = DriveApp.getFolderById(s.scoutsFolderId); path.forEach(function (seg) { target = childFolder_(target, seg); }); }
        var up = folder.getParents(), cur = up.hasNext() ? up.next() : null;
        if (!cur || cur.getId() !== target.getId()) folder.moveTo(target);
      }
      addRecordNote_(x.recordId, short + ' [tool] Closed record archived: folder moved to ' + path.join('/') + '/, row moved to the ' + Closing.ARCHIVE_TAB + ' tab');
      if (!have[x.recordId]) {
        Tabs.append(Closing.ARCHIVE_TAB, Closing.archiveRow(r, { stageLabel: stageLabel, archivedOn: today }));
        have[x.recordId] = true;
      }
      done.push(x);
    } catch (e) { failed.push(x.name + ': ' + e.message); }
  });
  if (done.length) {
    var ids = done.map(function (x) { return x.recordId; });
    var sh = getTrackingSheet_();
    var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
    var m = SheetModel.findMachineRow(top);
    var firstData = m.row + 3;
    withLock_(function () {                                                      // same safe delete path as the Eagles archive
      var keys = sh.getRange(1, m.keyCol + 1, sh.getLastRow(), 1).getValues().map(function (rr) { return String(rr[0]); });
      AdminRules.deleteRuns(sh.getLastRow(), firstData, function (row) { return ids.indexOf(keys[row - 1]) < 0; })
        .forEach(function (run) { sh.deleteRows(run[0], run[1]); });
    });
    Records.invalidate();
    refreshActionDropdownsQuietly_();
  }
  adminLog_('Archived ' + done.length + ' Closed record' + (done.length === 1 ? '' : 's') + ' of ' + cand.years.map(function (y) { return y.year; }).join(', ') +
    ' to the "' + Closing.ARCHIVE_TAB + '" tab; folders moved to ' + path.join('/') + '/' + (failed.length ? '; NOT archived: ' + failed.join('; ') : ''), c.email);
  return { message: done.length + ' Closed record' + (done.length === 1 ? '' : 's') + ' archived (folders in ' + path.join('/') + '/, rows on the "' +
    Closing.ARCHIVE_TAB + '" tab).' + (failed.length ? ' Left on the tracking tab: ' + failed.join('; ') + '.' : '') };
}
