/**
 * Helper tabs (Intake Queue, Uploads Log) read and written by header name,
 * never by column letter, so the committee can add or reorder columns.
 * Row numbers returned here are 1-based sheet rows. Callers hold withLock_
 * around read-then-write sequences.
 */
var Tabs = (function () {
  function sheet_(name) {
    var sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh) throw new Error('No "' + name + '" tab: run Admin → Setup / repair tabs');
    return sh;
  }

  function headers_(sh) {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = {};
    // A header typed with a line break (Alt+Enter) or double spaces reads as single-spaced: "Meeting⏎Location" = "Meeting Location".
    row.forEach(function (h, i) { h = String(h).replace(/\s+/g, ' ').trim(); if (h && map[h] === undefined) map[h] = i; });
    return { map: map, width: lastCol };
  }

  /** All data rows as objects keyed by header, plus _row (sheet row number). */
  function read(name) {
    var sh = sheet_(name);
    var h = headers_(sh);
    var n = sh.getLastRow() - 1;
    if (n < 1) return [];
    var vals = sh.getRange(2, 1, n, h.width).getValues();
    return vals.map(function (r, i) {
      var o = { _row: i + 2 };
      Object.keys(h.map).forEach(function (k) { o[k] = r[h.map[k]]; });
      return o;
    });
  }

  function append(name, obj) {
    var sh = sheet_(name);
    var h = headers_(sh);
    var row = [];
    for (var i = 0; i < h.width; i++) row.push('');
    Object.keys(obj).forEach(function (k) {
      if (h.map[k] === undefined) throw new Error('Column "' + k + '" missing on ' + name + ' tab');
      row[h.map[k]] = obj[k];
    });
    sh.appendRow(row);
    return sh.getLastRow();
  }

  function update(name, rowNum, obj) {
    var sh = sheet_(name);
    var h = headers_(sh);
    Object.keys(obj).forEach(function (k) {
      if (h.map[k] === undefined) throw new Error('Column "' + k + '" missing on ' + name + ' tab');
      sh.getRange(rowNum, h.map[k] + 1).setValue(obj[k]);
    });
  }

  /** Delete rows (sheet row numbers), bottom-up so numbers stay valid. */
  function remove(name, rowNums) {
    var sh = sheet_(name);
    rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  }

  return { read: read, append: append, update: update, remove: remove, sheet: sheet_ };
})();
