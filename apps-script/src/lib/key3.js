/**
 * Key3: read Council's Key 3 export (CSV or a Google Sheet) into Key 3 tab rows. Pure.
 *
 * The export's layout varies, so columns are found by header text in the first 10 rows:
 *   unit (or unit type + unit number), position/role/title, name (or first + last), email, phone.
 * One row per position per unit. Kept: troops, crews, ships (Cub packs never have an Eagle candidate).
 * Dropped: Chartered Organization Rep / Executive Officer, rows without a unit or an email.
 * Positions map to roles: Scoutmaster / Cubmaster / Crew Advisor / Skipper → Unit Leader; Committee Chair.
 * If Council changes the headers, fix the patterns in COLS (that's the only place).
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
    phone: /phone|mobile|cell/i
  };

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
      out.push({ unit: units.label(c), role: role, position: position, name: name, email: emails.join('; '), phone: cell('phone') });
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

  return { COLS: COLS, roleFor: roleFor, parse: parse, diff: diff };
})();

if (typeof module !== 'undefined') module.exports = Key3;
