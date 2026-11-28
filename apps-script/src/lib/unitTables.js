/**
 * UnitTables (Jim W., 2026-11-28): the Units page's sheet tabs (Unit Info, Key 3, Unit Contacts) as dense tables,
 * sorted in the browser (web/js/tableSort.js). Pure: a grid of DISPLAY values in, {headers, rows, unitCol} out.
 * Hidden columns (header starting with "_") and columns without a header are left out; a machine-name second row
 * (Key 3) is skipped; empty rows are dropped. Committee only (actionUnitTables_).
 */
var UnitTables = (function () {
  var TABS = [
    { key: 'info', label: 'Unit Info', tab: 'Unit Info' },
    { key: 'key3', label: 'Key 3', tab: 'Key 3' },
    { key: 'contacts', label: 'Unit Contacts', tab: 'Unit Contacts' }
  ];

  function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

  /** Row 2 holds machine names (lower_case, dots, no spaces), not data. */
  function isMachineRow(row) {
    var cells = (row || []).map(str).filter(Boolean);
    return cells.length > 0 && cells.every(function (c) { return /^[a-z0-9_.]+$/.test(c); }) &&
      cells.some(function (c) { return /[_.]/.test(c); });
  }

  /** grid: getDisplayValues() of the whole tab -> {headers, rows, unitCol (-1 = none)} */
  function table(grid) {
    grid = grid || [];
    if (!grid.length) return { headers: [], rows: [], unitCol: -1 };
    var head = (grid[0] || []).map(str);
    var keep = [];
    head.forEach(function (h, i) { if (h && h.charAt(0) !== '_') keep.push(i); });
    var rows = [];
    for (var r = 1; r < grid.length; r++) {
      if (r === 1 && isMachineRow(grid[1])) continue;
      var row = keep.map(function (i) { return str(grid[r][i]); });
      if (row.some(Boolean)) rows.push(row);
    }
    var headers = keep.map(function (i) { return head[i]; });
    var unitCol = headers.map(function (h) { return h.toLowerCase(); }).indexOf('unit');
    return { headers: headers, rows: rows, unitCol: unitCol };
  }

  return { TABS: TABS, table: table, isMachineRow: isMachineRow };
})();

if (typeof module !== 'undefined') module.exports = UnitTables;
