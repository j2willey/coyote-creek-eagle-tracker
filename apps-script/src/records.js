/**
 * Records adapter (M1): Candidate Records on the tracking tab.
 *
 * Rows are always found by Record ID (hidden _key column), never by row
 * number. All writes run under a script lock. Structure logic lives in
 * lib/sheetModel.js.
 */
var Records = (function () {
  var memo_ = null;

  /** The tracking tab, read ONCE per request (one call); cleared by writes and withLock_. */
  function model_() {
    if (memo_) return memo_;
    var sh = getTrackingSheet_();
    var data = sh.getDataRange().getValues();
    var lastCol = data.length ? data[0].length : 0;
    var m = SheetModel.findMachineRow(data.slice(0, 15));
    if (!m) throw new Error('Tracking tab has no machine header row. Run the migration first.');
    var keyCol = data.map(function (r) { return r[m.keyCol]; });
    var names = m.map.scout_name === undefined ? [] : data.map(function (r) { return r[m.map.scout_name]; });
    // Rows a member inserted by hand (name, no key) get a Record ID so the tools can see them.
    SheetModel.missingRecordKeys(keyCol, names, null, new Date()).forEach(function (x) {
      sh.getRange(x.row + 1, m.keyCol + 1).setValue(x.id);
      keyCol[x.row] = x.id;
      data[x.row][m.keyCol] = x.id;
    });
    memo_ = { sheet: sh, machineRow: m.row, keyColIndex: m.keyCol, headers: m.map, keys: keyCol, lastCol: lastCol, names: names, data: data };
    return memo_;
  }

  function invalidate() { memo_ = null; }

  /** Returns { recordId, row (1-based), section, fields: {name: value} } or null. */
  function get(recordId) {
    var md = model_();
    var r = SheetModel.findRecordRow(md.keys, recordId);
    if (r < 0) return null;
    var vals = md.data[r];
    var fields = {};
    Object.keys(md.headers).forEach(function (name) { fields[name] = vals[md.headers[name]]; });
    return { recordId: recordId, row: r + 1, section: SheetModel.sectionForRow(md.keys, r), fields: fields };
  }

  /** Find Record IDs whose scout_email or parent_email matches (case-insensitive). */
  function findByEmail(email) {
    var md = model_();
    var e = String(email || '').trim().toLowerCase();
    if (!e) return [];
    // Only the Scout's own address signs in; parents are copied on emails (Settings parentsSignIn, Jim W. 2026-10-28).
    var who = ['scout_email'];
    try { if (getSettings_().parentsSignIn === true) who.push('parent_email'); } catch (e) {}
    var cols = who.filter(function (c) { return md.headers[c] !== undefined; });
    var data = md.data;
    var out = [];
    md.keys.forEach(function (k, r) {
      if (!SheetModel.isRecordId(k)) return;
      for (var i = 0; i < cols.length; i++) {
        if (String(data[r][md.headers[cols[i]]]).trim().toLowerCase() === e) { out.push(String(k)); return; }
      }
    });
    return out;
  }

  /** Every Candidate Record with the named fields: [{recordId, <name>: value}]. */
  function all(names) {
    var md = model_();
    var data = md.data;
    var out = [];
    md.keys.forEach(function (k, r) {
      if (!SheetModel.isRecordId(k)) return;
      var o = { recordId: String(k), section: SheetModel.sectionForRow(md.keys, r) };
      names.forEach(function (n) { o[n] = md.headers[n] === undefined ? '' : data[r][md.headers[n]]; });
      out.push(o);
    });
    return out;
  }

  /** Machine column names on the tracking tab. */
  function columns() { return Object.keys(model_().headers); }

  /** Insert a new record at the end of `sectionKey`. fields: {machineName: value}. Returns recordId. */
  function insert(sectionKey, fields) {
    var newId = withLock_(function () {
      var md = model_();
      var at = SheetModel.insertionRow(md.keys, sectionKey);
      if (at < 0) throw sectionMissing_(sectionKey);
      var id = SheetModel.makeRecordId(null, md.keys);
      // Template = an existing record row (for formats + formulas like Age).
      var tpl = -1;
      for (var i = 0; i < md.keys.length; i++) if (SheetModel.isRecordId(md.keys[i])) { tpl = i; break; }
      md.sheet.insertRowAfter(at); // new row is 1-based at+1
      var newRow = at + 1;
      if (tpl >= 0) {
        var tplRow = tpl >= at ? tpl + 2 : tpl + 1; // shifted down if it was below the insert
        var src = md.sheet.getRange(tplRow, 1, 1, md.lastCol);
        var dst = md.sheet.getRange(newRow, 1, 1, md.lastCol);
        src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
        var f = src.getFormulasR1C1()[0];
        f.forEach(function (formula, c) { if (formula) md.sheet.getRange(newRow, c + 1).setFormulaR1C1(formula); });
      }
      clearTailFormat_(md.sheet, newRow, md.lastCol);
      Object.keys(fields || {}).forEach(function (name) {
        if (md.headers[name] === undefined) throw new Error('Unknown column: ' + name);
        if (name === '_key') throw new Error('Refusing to write _key');
        md.sheet.getRange(newRow, md.headers[name] + 1).setValue(fields[name]);
      });
      md.sheet.getRange(newRow, md.keyColIndex + 1).setValue(id);
      return id;
    });
    refreshActionDropdownsQuietly_();
    return newId;
  }

  /** Update named fields on a record. */
  function update(recordId, fields) {
    var out = withLock_(function () {
      var md = model_();
      var r = SheetModel.findRecordRow(md.keys, recordId);
      if (r < 0) throw new Error('Record not found: ' + recordId);
      Object.keys(fields).forEach(function (name) {
        if (md.headers[name] === undefined) throw new Error('Unknown column: ' + name);
        if (name === '_key') throw new Error('Refusing to write _key');
        md.sheet.getRange(r + 1, md.headers[name] + 1).setValue(fields[name]);
      });
    });
    // A new EBoR date may mean a new year folder (folderPlace.js).
    var ebor = String(getSettings_().eborDateColumn || 'ebor_date');
    if (Object.prototype.hasOwnProperty.call(fields, ebor)) { placeFolderQuietly_(recordId); sortEborBooked_(); }
    return out;
  }

  /** Move a record to the end of another section (position = status). */
  function move(recordId, sectionKey) {
    withLock_(function () {
      var md = model_();
      var r = SheetModel.findRecordRow(md.keys, recordId);
      if (r < 0) throw new Error('Record not found: ' + recordId);
      var at = SheetModel.topRow(md.keys, sectionKey);       // moved rows go to the TOP of the section (Jim W., 2026-10-19)
      if (at < 0) throw sectionMissing_(sectionKey);
      if (SheetModel.sectionForRow(md.keys, r) === sectionKey) return;
      md.sheet.moveRows(md.sheet.getRange(r + 1, 1), at + 1);
      // Where it landed (1-based): moving down, the rows above shift up by one.
      clearTailFormat_(md.sheet, r + 1 < at + 1 ? at : at + 1, md.lastCol);
    });
    refreshActionDropdownsQuietly_();
    placeFolderQuietly_(recordId);                            // 202x / EBoR year / Exceptions (folderPlace.js)
    if (sectionKey === 'ebor_booked') sortEborBooked_();     // EBoR Booked stays in EBoR Date order (sectionSortActions.js)
  }

  /**
   * Cells past the last used column have no formatting of their own, so a row moved or inserted under a section header
   * picks up the header's fill there (2026-11-01: column AM went orange on rows booked online). Clear it.
   */
  function clearTailFormat_(sh, row1, lastCol) {
    try {
      var max = sh.getMaxColumns();
      if (max > lastCol) sh.getRange(row1, lastCol + 1, 1, max - lastCol).setBackground(null);
    } catch (e) { console.warn('clearTailFormat_: ' + e); }
  }

  function sectionMissing_(key) {
    notifyAdmin_('Section not found: ' + key,
      'The tracking tab has no S:' + key + ' in the hidden _key column. Nothing was written.');
    return new Error('Section not found on tracking tab: ' + key);
  }

  /** Problems with the sheet structure (empty list = OK). */
  function selfCheck() {
    var md = model_();
    var probs = SheetModel.validate(md.keys, md.headers, getSettings_(), ['scout_name', 'unit', 'scout_email']);
    SheetModel.orphanKeys(md.keys, md.names).forEach(function (r) {
      probs.push('Row ' + (r + 1) + ' has Record ID ' + md.keys[r] + ' but no Scout name (cells moved without the hidden key column?)');
    });
    return probs;
  }

  return { invalidate: invalidate, get: get, all: all, columns: columns, findByEmail: findByEmail, insert: insert, update: update, move: move, selfCheck: selfCheck };
})();

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Busy: could not get the script lock, try again.');
  clearMemos_();                                    // reads inside the lock see other requests' writes
  try {
    var out = fn();
    SpreadsheetApp.flush();
    return out;
  } finally {
    clearMemos_();                                  // and reads after it see this one's
    lock.releaseLock();
  }
}
