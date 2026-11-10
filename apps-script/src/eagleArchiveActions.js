/**
 * Admin: the January archive of Eagles. A past year's Eagle Earned rows go to the TOP of the "Eagle Archive" tab (Settings →
 * eagleArchiveTab) of the tracking spreadsheet, as a "<year> Eagles" section, newest year first. Columns are matched by
 * machine name (hidden row), so the archive may differ from the tracking tab. Plan and rules: lib/eagleArchive.js.
 *
 *   adminArchive {session, year, confirm} -> {needsConfirm, names, label, tab, tabExists, added, archiveOnly, alreadyThere}
 *                                            | {message, url}
 *
 * Order of work (nothing leaves the tracking tab before it is verified on the archive): columns added -> rows inserted ->
 * each column copied (Range.copyTo: values, formats, notes, links) -> Record IDs read back -> Stats History -> rows deleted
 * from the tracking tab by Record ID. A failure while writing removes the rows inserted so far; a rerun starts clean.
 */
function eagleArchiveTabName_() { return EagleArchive.tabName(getSettings_().eagleArchiveTab); }

/** Header-row facts for a sheet: {m: machine row model, top, lastRow, lastCol}; null when it has no machine row. */
function eagleArchiveHead_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  var top = sh.getRange(1, 1, Math.min(15, lastRow), lastCol).getValues();
  var m = SheetModel.findMachineRow(top);
  return m ? { m: m, top: top, lastRow: lastRow, lastCol: lastCol } : null;
}

/** First run: the tab is a copy of the tracking tab's header rows (row 1 to the filter row, hidden machine row included). */
function createEagleArchiveTab_(tr, name) {
  var ss = SpreadsheetApp.getActive();
  var h = eagleArchiveHead_(tr);
  if (!h) throw userError_('The tracking tab has no machine header row.');
  var keep = h.m.row + 3;                                        // group row(s), machine row, visible header, filter row
  var copy = tr.copyTo(ss);
  copy.setName(name);
  var max = copy.getMaxRows();
  if (max > keep + 1) copy.deleteRows(keep + 2, max - keep - 1);
  copy.getRange(keep + 1, 1, 1, copy.getMaxColumns()).clear();
  return copy;
}

function actionAdminArchive_(req) {
  var c = committeeMe_(req.session);
  var year = String(req.year || '').trim();
  if (!/^\d{4}$/.test(year)) throw userError_('Pick the year.');
  if (Number(year) >= new Date().getFullYear()) throw userError_('Only past years can be archived (this year\'s Eagles stay until January).');
  var recs = adminRecords_();
  var ids = AdminRules.archiveIds(recs, year);
  if (!ids.length) throw userError_('No Eagles with an EBoR in ' + year + ' on the tracking tab.');
  var byId = {};
  recs.forEach(function (r) { byId[r.recordId] = r; });
  var names = ids.map(function (id) { return byId[id].scout_name + ' (' + byId[id].unit + ')'; });
  var tabName = eagleArchiveTabName_();
  var ss = SpreadsheetApp.getActive();
  var tr = getTrackingSheet_();
  var arch = ss.getSheetByName(tabName);

  if (!req.confirm) {                                           // the dry run
    if (!arch) return { needsConfirm: true, names: names, label: EagleArchive.labelText(year), tab: tabName, tabExists: false, added: [], archiveOnly: [], alreadyThere: 0 };
    var map = eagleArchivePlan_(tr, arch);
    var have = arch.getLastRow() ? arch.getRange(1, map.keyTo + 1, arch.getLastRow(), 1).getValues().map(function (r) { return r[0]; }) : [];
    var rep = EagleArchive.report(year, names, map, true, EagleArchive.split(have, ids));
    return { needsConfirm: true, names: rep.names, label: rep.label, tab: tabName, tabExists: true, added: rep.added, archiveOnly: rep.archiveOnly, alreadyThere: rep.alreadyThere };
  }

  if (!arch) {                                                  // first run (staging): make the tab, then stop
    var made = createEagleArchiveTab_(tr, tabName);
    adminLog_('Created the "' + tabName + '" tab from the tracking tab\'s header rows; nothing archived yet', c.email);
    return { message: 'The "' + tabName + '" tab did not exist: created it from the tracking tab\'s header rows. Nothing was moved. ' +
      'Check the tab (rename or reorder its columns if you like), then archive ' + year + ' again.', url: ss.getUrl() + '#gid=' + made.getSheetId() };
  }

  var map2 = eagleArchivePlan_(tr, arch);
  var result = withLock_(function () { return eagleArchiveWrite_(tr, arch, map2, year, ids, byId); });
  var statsAdded = addStatsYear_(year);                         // Stats History keeps the year's numbers (Eagles still on the tracking tab)
  withLock_(function () {                                       // only now: remove from the tracking tab, by Record ID
    var h = eagleArchiveHead_(tr);
    var keys = tr.getRange(1, h.m.keyCol + 1, tr.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
    AdminRules.deleteRuns(tr.getLastRow(), h.m.row + 3, function (row) { return ids.indexOf(keys[row - 1]) < 0; })
      .forEach(function (run) { tr.deleteRows(run[0], run[1]); });
  });
  Records.invalidate();
  refreshActionDropdownsQuietly_();
  adminLog_('Archived ' + ids.length + ' Eagles of ' + year + ' to the top of the "' + tabName + '" tab (' + result.written + ' rows written' +
    (result.already ? ', ' + result.already + ' already there' : '') + (result.addedCols.length ? '; columns added: ' + result.addedCols.join(', ') : '') + ')' +
    (statsAdded ? '; ' + year + ' added to Stats History' : ''), c.email);
  return { message: ids.length + ' Eagles of ' + year + ' moved to the top of the "' + tabName + '" tab as "' + EagleArchive.labelText(year) + '"' +
    (result.already ? ' (' + result.already + ' were already there and were not added again)' : '') +
    (result.addedCols.length ? '. Columns added to the archive: ' + result.addedCols.join(', ') : '') + '.',
    url: ss.getUrl() + '#gid=' + arch.getSheetId() };
}

/** The column plan between the tracking tab and the archive tab (throws a user error when a machine row is missing). */
function eagleArchivePlan_(tr, arch) {
  var th = eagleArchiveHead_(tr), ah = eagleArchiveHead_(arch);
  if (!th) throw userError_('The tracking tab has no machine header row.');
  if (!ah) throw userError_('The "' + arch.getName() + '" tab has no machine header row (hidden row with _key). Delete the tab and archive again to start from a copy of the tracking tab\'s headers.');
  try { return EagleArchive.mapColumns(th.top[th.m.row], ah.top[ah.m.row]); }
  catch (e) { throw userError_(e.message); }
}

/**
 * Under the lock: columns added, rows inserted, columns copied, Record IDs read back. Throws (after removing the rows it
 * inserted) when anything is off. -> {written, already, addedCols}
 */
function eagleArchiveWrite_(tr, arch, map, year, ids, byId) {
  var th = eagleArchiveHead_(tr), ah = eagleArchiveHead_(arch);
  var filterRow = th.m.row + 3;                                  // 1-based: last header row (filter row), same on both tabs by convention
  var firstFree = ah.m.row + 3;                                  // 0-based index of the first row below the archive's header rows
  var trLast = tr.getLastRow(), trCols = tr.getLastColumn();
  var trKeys = tr.getRange(1, th.m.keyCol + 1, trLast, 1).getValues().map(function (r) { return String(r[0]); });
  var aKeys = arch.getRange(1, ah.m.keyCol + 1, ah.lastRow, 1).getValues().map(function (r) { return String(r[0]); });
  var split = EagleArchive.split(aKeys, ids);
  var onTracking = split.todo.filter(function (id) { return trKeys.indexOf(id) >= 0; });
  var todo = EagleArchive.order(onTracking.map(function (id) { return { id: id, ebor: byId[id].ebor }; }));
  var addedCols = map.added.slice();
  if (!todo.length) return { written: 0, already: split.present.length, addedCols: [] };

  // 1. Columns the archive lacks: heading rows copied from the tracking tab (values + formatting), hidden state and width.
  if (map.added.length) {
    var need = map.archiveWidth - arch.getMaxColumns();
    if (need > 0) arch.insertColumnsAfter(arch.getMaxColumns(), need);
    var lastGroup = null;
    map.pairs.filter(function (p) { return p.added; }).forEach(function (p) {
      tr.getRange(1, p.from + 1, filterRow, 1).copyTo(arch.getRange(1, p.to + 1, filterRow, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
      for (var hr = 0; hr < th.m.row; hr++) {                    // group heading: the nearest one to the left (fill forward), once per group
        var txt = '', cc = p.from;
        while (cc >= 0 && !String(th.top[hr][cc] || '').trim()) cc--;
        txt = cc >= 0 ? String(th.top[hr][cc]) : '';
        if (txt && txt !== lastGroup) { arch.getRange(hr + 1, p.to + 1).setValue(txt); if (hr === th.m.row - 1) lastGroup = txt; }
      }
      arch.setColumnWidth(p.to + 1, tr.getColumnWidth(p.from + 1));
      if (tr.isColumnHiddenByUser(p.from + 1)) arch.hideColumns(p.to + 1);
    });
    SpreadsheetApp.flush();
    ah = eagleArchiveHead_(arch);
  }

  // 2. Where it goes, and the rows.
  var lastRowNow = arch.getLastRow();
  var data = lastRowNow >= firstFree + 1 ? arch.getRange(1, 1, lastRowNow, ah.lastCol).getValues() : [];
  var keys = data.map(function (r) { return String(r[ah.m.keyCol]); });
  var texts = data.map(function (r) { for (var i = 0; i < r.length; i++) if (String(r[i]).trim()) return String(r[i]); return ''; });
  var place = EagleArchive.placement(keys, texts, firstFree, year);
  var needLabel = place.existing < 0, n = todo.length, add = n + (needLabel ? 1 : 0);
  var at0 = place.insertAt;                                      // 0-based
  var tplLabel = place.labels.length ? place.labels[0].row : -1;
  var tplData = -1;
  for (var q = firstFree; q < keys.length; q++) if (SheetModel.isRecordId(keys[q])) { tplData = q; break; }
  if (at0 >= arch.getMaxRows()) arch.insertRowsAfter(arch.getMaxRows(), add); else arch.insertRowsBefore(at0 + 1, add);
  var shift = function (i) { return i >= at0 ? i + add : i; };    // template rows that moved down
  var lastCol = arch.getLastColumn();
  var R = at0 + 1;                                               // 1-based first inserted row
  var dataStart = R + (needLabel ? 1 : 0);
  try {
    // formats: the label row from an existing year label (or the tracking tab's Eagle Earned row), data rows from an existing data row
    if (needLabel) {
      var labelCol = 0;
      if (tplLabel >= 0) {
        arch.getRange(shift(tplLabel) + 1, 1, 1, lastCol).copyTo(arch.getRange(R, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        for (var lc = 0; lc < ah.lastCol; lc++) if (String(data[tplLabel][lc]).trim()) { labelCol = lc; break; }
      } else {
        var srcLabel = trKeys.indexOf('S:eagle_earned');
        if (srcLabel >= 0) tr.getRange(srcLabel + 1, 1, 1, Math.min(trCols, lastCol)).copyTo(arch.getRange(R, 1, 1, Math.min(trCols, lastCol)), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        var nm = map.pairs.filter(function (p) { return p.name === 'scout_name'; })[0];
        labelCol = nm ? nm.to : 0;
      }
      arch.getRange(R, labelCol + 1).setValue(EagleArchive.labelText(year));
      arch.getRange(R, map.keyTo + 1).setValue(EagleArchive.labelKey(year));
    }
    if (tplData >= 0) arch.getRange(shift(tplData) + 1, 1, 1, lastCol).copyTo(arch.getRange(dataStart, 1, n, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    // columns: per column, in runs of contiguous tracking rows; formula cells (Age) arrive as their displayed values
    var srcRows = todo.map(function (id) { return trKeys.indexOf(id) + 1; });
    var runs = EagleArchive.runs(srcRows);
    var formulas = tr.getRange(1, 1, trLast, trCols).getFormulas();
    var PT = SpreadsheetApp.CopyPasteType;
    var ordered = map.pairs.filter(function (p) { return p.from !== map.keyFrom; }).concat(map.pairs.filter(function (p) { return p.from === map.keyFrom; }));   // Record ID last
    ordered.forEach(function (p) {
      runs.forEach(function (run) {
        var src = tr.getRange(run.from, p.from + 1, run.len, 1), dst = arch.getRange(dataStart + run.offset, p.to + 1, run.len, 1);
        var hasFormula = false;
        for (var i = 0; i < run.len; i++) if (formulas[run.from - 1 + i][p.from]) hasFormula = true;
        if (hasFormula) { src.copyTo(dst, PT.PASTE_FORMAT, false); src.copyTo(dst, PT.PASTE_VALUES, false); }
        else src.copyTo(dst, PT.PASTE_NORMAL, false);
      });
    });
    arch.getRange(dataStart, 1, n, lastCol).clearDataValidations();       // no Action dropdown etc. on archived rows
    SpreadsheetApp.flush();
    // 3. Read back: every Record ID must be on the archive.
    var back = arch.getRange(1, map.keyTo + 1, arch.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
    var gone = EagleArchive.missing(back, todo.concat(split.present));
    if (gone.length) throw new Error('Not every Record ID is on the archive after writing (' + gone.join(', ') + ')');
  } catch (e) {
    try { arch.deleteRows(R, add); } catch (e2) { console.warn('archive rollback: ' + e2); }
    throw userError_('Archiving stopped and the rows it had written were removed; nothing left the tracking tab. ' + e.message);
  }
  return { written: n, already: split.present.length, addedCols: addedCols };
}
