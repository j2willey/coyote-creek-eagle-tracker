/**
 * Key3: read Council's Key 3 export (CSV or a Google Sheet) into Key 3 tab rows. Pure.
 *
 * The export's layout varies, so columns are found by header text in the first 10 rows:
 *   unit (or unit type + unit number), position/role/title, name (or first + last), email, phone.
 * One row per position per unit. Kept: troops, crews, ships (Cub packs never have an Eagle candidate).
 * Dropped: Chartered Organization Rep / Executive Officer, rows without a unit or an email.
 * Positions map to roles: Scoutmaster / Cubmaster / Crew Advisor / Skipper → Unit Leader; Committee Chair.
 * If Council changes the headers, fix the patterns in COLS (that's the only place).
 *
 * Leader address (Task 12): optional columns "Leader Address", "Leader City", "Leader State", "Leader Zip" on the Key 3
 * tab (the Unit Leader's row only). They are found by machine key when the tab has a machine-name row (row 2, e.g.
 * `leader_address`), else by header text; case, spaces and underscores don't matter. A re-import replaces the rows, so
 * the four values are carried forward for a unit whose Unit Leader name is unchanged, and the export's own address
 * columns win when it has them.
 */
var Key3 = (function () {
  function U() { return (typeof Units !== 'undefined') ? Units : require('./units'); }
  function str(v) { return v == null ? '' : String(v).trim(); }

  var COLS = {
    unitType: /^(unit\s*type|program\s*type|type)$/i,
    unit: /^(unit|unit\s*(number|no\.?|#|name|id)|unit\/?\s*number)$/i,
    position: /^(position|role|title|position\s*(title|name)|registered\s*position)$/i,
    name: /^(name|full\s*name|member\s*name|leader\s*name)$/i,
    first: /^first(\s*name)?$/i,
    last: /^last(\s*name)?$/i,
    email: /e-?mail/i,
    phone: /phone|mobile|cell/i,
    address: /^((leader|member|mailing|home|street)\s*)?address(\s*(1|line\s*1))?$/i,
    city: /^((leader|member|mailing|home)\s*)?city$/i,
    state: /^((leader|member|mailing|home)\s*)?state(\s*\/?\s*province)?$/i,
    zip: /^((leader|member|mailing|home)\s*)?(zip|postal)(\s*code)?$/i
  };

  /** The four optional columns: canonical header, machine key, field name on a row. */
  var ADDRESS = [
    { field: 'address', col: 'Leader Address', machine: 'leader_address' },
    { field: 'city', col: 'Leader City', machine: 'leader_city' },
    { field: 'state', col: 'Leader State', machine: 'leader_state' },
    { field: 'zip', col: 'Leader Zip', machine: 'leader_zip' }
  ];
  function norm(v) { return str(v).toLowerCase().replace(/[\s_]+/g, ''); }

  /**
   * grid: the Key 3 tab as a 2D array (row 1 = headers; row 2 may be a machine-name row). ->
   * {address: colIndex, city, state, zip} for the columns found: the machine key first, else the header text.
   */
  function addressColumns(grid) {
    var out = {};
    ADDRESS.forEach(function (a) {
      [1, 0].some(function (r) {
        var row = (grid && grid[r]) || [];
        for (var i = 0; i < row.length; i++) {
          if (norm(row[i]) === norm(a.machine)) { out[a.field] = i; return true; }   // "leader_address" = "Leader Address"
        }
        return false;
      });
    });
    return out;
  }

  /** Is row 2 a machine-name row (it holds at least one of the four machine keys)? */
  function hasMachineRow(grid) {
    var row = (grid && grid[1]) || [];
    return row.some(function (c) { return ADDRESS.some(function (a) { return norm(c) === norm(a.machine); }); });
  }

  /**
   * The Key 3 tab as rows keyed by header (like Tabs.read: _row = sheet row), with the four address values under
   * address / city / state / zip, found as above. A machine-name row is skipped.
   */
  function readGrid(grid) {
    grid = grid || [];
    if (!grid.length) return [];
    var head = (grid[0] || []).map(function (h) { return str(h).replace(/\s+/g, ' '); });
    var ac = addressColumns(grid), skip = hasMachineRow(grid) ? 1 : -1, out = [];
    for (var r = 1; r < grid.length; r++) {
      if (r === skip) continue;
      var o = { _row: r + 1 };
      head.forEach(function (h, i) { if (h && o[h] === undefined) o[h] = grid[r][i]; });
      ADDRESS.forEach(function (a) { o[a.field] = ac[a.field] === undefined ? '' : str(grid[r][ac[a.field]]); });
      out.push(o);
    }
    return out;
  }

  function nameKey(n) { return str(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /**
   * Re-import: give each new Unit Leader row the old row's address when the unit and the Unit Leader's name are the
   * same and the new row has none of its own. oldRows: readGrid(); newRows: parse().rows. -> {rows, carried}
   */
  function carryForward(oldRows, newRows) {
    var units = U(), byKey = {};
    (oldRows || []).forEach(function (r) {
      var role = units.key3Role(r['Role'], r['Position']);
      if (role !== 'Unit Leader') return;
      if (!ADDRESS.some(function (a) { return str(r[a.field]); })) return;
      byKey[units.code(r['Unit']) + '|' + nameKey(r['Name'])] = r;
    });
    var carried = 0;
    var rows = (newRows || []).map(function (n) {
      var o = {};
      Object.keys(n).forEach(function (k) { o[k] = n[k]; });
      if (o.role !== 'Unit Leader') return o;
      var has = ADDRESS.some(function (a) { return str(o[a.field]); });
      var old = byKey[units.code(o.unit) + '|' + nameKey(o.name)];
      if (old && !has) {
        ADDRESS.forEach(function (a) { o[a.field] = str(old[a.field]); });
        carried++;
      }
      return o;
    });
    return { rows: rows, carried: carried };
  }

  function roleFor(position) {
    var p = str(position);
    if (/chartered\s*org|^cor$|executive\s*officer/i.test(p)) return 'Chartered Org Rep';
    if (/assistant/i.test(p)) return p;
    if (/committee\s*chair/i.test(p)) return 'Committee Chair';
    if (/scoutmaster|cubmaster|crew\s*advisor|^advisor$|skipper|unit\s*leader/i.test(p)) return 'Unit Leader';
    return p;
  }

  function findHeader(rows) {
    for (var r = 0; r < Math.min(10, rows.length); r++) {
      var idx = {};
      (rows[r] || []).forEach(function (h, i) {
        h = str(h);
        Object.keys(COLS).forEach(function (k) { if (idx[k] === undefined && COLS[k].test(h)) idx[k] = i; });
      });
      if (idx.unit !== undefined && idx.email !== undefined) return { row: r, idx: idx };
    }
    return null;
  }

  /** rows: 2D array (CSV or sheet values). -> {rows:[{unit, role, position, name, email, phone}], skipped:{...}, error} */
  function parse(rows) {
    var h = findHeader(rows || []);
    if (!h) return { error: 'No header row with a Unit column and an Email column in the first 10 rows.', rows: [], skipped: {} };
    var ix = h.idx, units = U();
    var out = [], skipped = { 'Chartered Org Rep': 0, 'packs / other unit types': 0, 'no unit': 0, 'no email': 0 };
    for (var r = h.row + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var cell = function (k) { return ix[k] === undefined ? '' : str(row[ix[k]]); };
      if (!row.some(function (v) { return str(v); })) continue;
      var rawUnit = cell('unit');
      if (ix.unitType !== undefined && /^\d+$/.test(rawUnit)) rawUnit = cell('unitType') + ' ' + rawUnit;
      var c = units.code(rawUnit);
      if (!c) { skipped['no unit']++; continue; }
      if (['t', 'c', 's'].indexOf(c.charAt(0)) < 0) { skipped['packs / other unit types']++; continue; }
      var position = cell('position'), role = roleFor(position);
      if (role === 'Chartered Org Rep') { skipped['Chartered Org Rep']++; continue; }
      var emails = units.emailsIn(cell('email'));
      if (!emails.length) { skipped['no email']++; continue; }
      var name = cell('name') || [cell('first'), cell('last')].filter(Boolean).join(' ');
      var rowOut = { unit: units.label(c), role: role, position: position, name: name, email: emails.join('; '), phone: cell('phone') };
      // The export's own address columns (only the Unit Leader's row keeps them).
      ADDRESS.forEach(function (a) { rowOut[a.field] = role === 'Unit Leader' ? cell(a.field) : ''; });
      out.push(rowOut);
    }
    out.sort(function (a, b) { return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : (a.role < b.role ? -1 : a.role > b.role ? 1 : 0); });
    return { rows: out, skipped: skipped };
  }

  function key(r) { return [str(r.unit || r['Unit']), str(r.role || r['Role']), str(r.email || r['Email']).toLowerCase()].join(' | '); }

  /** old: Key 3 tab rows (Tabs.read), new: parse().rows. -> {added:[text], removed:[text]} */
  function diff(oldRows, newRows) {
    var a = {}, b = {};
    (oldRows || []).forEach(function (r) { a[key(r)] = true; });
    (newRows || []).forEach(function (r) { b[key(r)] = true; });
    return {
      added: Object.keys(b).filter(function (k) { return !a[k]; }),
      removed: Object.keys(a).filter(function (k) { return !b[k] && k.replace(/[ |]/g, ''); })
    };
  }

  return { COLS: COLS, ADDRESS: ADDRESS, roleFor: roleFor, parse: parse, diff: diff, addressColumns: addressColumns, hasMachineRow: hasMachineRow,
    readGrid: readGrid, carryForward: carryForward };
})();

if (typeof module !== 'undefined') module.exports = Key3;
