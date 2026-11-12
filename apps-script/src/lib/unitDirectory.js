/**
 * UnitDirectory (Jim W., 2026-10-25): unit contacts on the web.
 *  - Committee: list of units → a unit's contacts. Key 3 rows (Unit Leader, Committee Chair; imported from Council's
 *    Key 3) can be edited, not added or deleted, and are shown apart. Unit Contacts rows (unit-provided) can be
 *    edited, deleted and added.
 *  - Unit contacts (unit page): the same panel for their own units, Key 3 rows read-only.
 * Rows are addressed by sheet row + the values they had (checked again before a write). Pure.
 */
var UnitDirectory = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var KEY3_ROLES = ['Unit Leader', 'Committee Chair'];
  var ROLES = ['Advancement Chair', 'EBoR Coordinator', 'Eagle Coach', 'Unit Leader', 'Committee Chair', 'Assistant Unit Leader', 'Other', 'Exclude'];
  var EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
  function U() { return typeof Units !== 'undefined' ? Units : require('./units.js'); }

  function key3For(key3, code) {
    return (key3 || []).filter(function (r) { return U().code(r['Unit']) === code && U().key3Role(r['Role'], r['Position']); })
      .map(function (r) {
        var role = U().key3Role(r['Role'], r['Position']), pos = str(r['Position']) || (str(r['Role']) !== role ? str(r['Role']) : '');
        var leader = role === 'Unit Leader';
        // Leader address (Task 12): rows from Key3.readGrid carry address / city / state / zip; a plain Tabs.read row, the headers.
        var pick = function (f, col) { return leader ? str(r[f] !== undefined ? r[f] : r[col]) : ''; };
        return { row: r._row, role: role, position: pos, name: str(r['Name']), email: str(r['Email']).toLowerCase(), phone: str(r['Phone']),
          address: pick('address', 'Leader Address'), city: pick('city', 'Leader City'), state: pick('state', 'Leader State'), zip: pick('zip', 'Leader Zip') };
      })
      .sort(function (a, b) { return KEY3_ROLES.indexOf(a.role) - KEY3_ROLES.indexOf(b.role); });
  }

  /** A Unit Contacts row with nothing but the unit (a placeholder): not shown, removed by Setup / repair (2026-11-01). */
  function isBlankContact(r) {
    return !['Role', 'Name', 'Email', 'Phone', 'Note'].some(function (k) { return str(r && r[k]); });
  }
  /** rows: Tabs.read('Unit Contacts'). -> sheet row numbers of the placeholder rows. */
  function blankContactRows(rows) {
    return (rows || []).filter(isBlankContact).map(function (r) { return r._row; });
  }

  function contactsFor(local, code) {
    return (local || []).filter(function (r) { return U().code(r['Unit']) === code && !isBlankContact(r); }).map(function (r) {
      var up = r['Updated'];
      return { row: r._row, role: str(r['Role']), name: str(r['Name']), email: str(r['Email']).toLowerCase(), phone: str(r['Phone']),
        note: str(r['Note']), updated: up instanceof Date ? up.getTime() : (Date.parse(str(up)) || 0) };
    });
  }

  /** units: Units.combine(...). -> [{code, unit, underReview, key3, contacts, missing:[roles]}] by type then number. */
  function directory(units, key3, local) {
    var byCode = {};
    (units || []).forEach(function (u) { byCode[u.code] = u; });
    return Object.keys(byCode).map(function (c) {
      var k = key3For(key3, c), l = contactsFor(local, c).filter(function (x) { return x.role.toLowerCase() !== 'exclude'; });
      var missing = KEY3_ROLES.filter(function (role) {
        return !k.some(function (x) { return x.role === role && x.email; }) && !l.some(function (x) { return x.role === role && x.email; });
      });
      return { code: c, unit: byCode[c].unit, underReview: !!byCode[c].underReview, key3: k.length, contacts: l.length, missing: missing };
    }).sort(function (a, b) {
      var ta = a.code.replace(/\d+$/, ''), tb = b.code.replace(/\d+$/, '');
      return ta.localeCompare(tb) || (Number(a.code.replace(/^\D+/, '')) - Number(b.code.replace(/^\D+/, '')));
    });
  }

  /** A contact as entered. kind 'key3' (role fixed) | 'contact'. -> {ok, errors, clean:{role, name, email, phone, note}} */
  function validate(f, kind) {
    var c = { role: str(f && f.role).slice(0, 60), name: str(f && f.name).slice(0, 80), email: str(f && f.email).toLowerCase().slice(0, 120),
      phone: str(f && f.phone).slice(0, 30), note: str(f && f.note).slice(0, 300) };
    var errors = [];
    // The Unit Leader's mailing address (Key 3 rows only; all optional).
    if (kind === 'key3') {
      c.address = str(f && f.address).replace(/\s+/g, ' ').slice(0, 120);
      c.city = str(f && f.city).slice(0, 60);
      c.state = str(f && f.state).toUpperCase().slice(0, 20);
      c.zip = str(f && f.zip).slice(0, 10);
      if (c.state && !/^[A-Z]{2}$/.test(c.state)) errors.push('State: two letters, e.g. CA.');
      if (c.zip && !/^\d{5}(-\d{4})?$/.test(c.zip)) errors.push('Zip: five digits (or ZIP+4).');
    }
    if (kind !== 'key3' && !c.role) errors.push('Pick or type the role.');
    if (c.role.toLowerCase() !== 'exclude' && !c.name) errors.push('The name is required.');
    if (!c.email) errors.push('The email address is required (it is how the unit is reached and signs in).');
    else if (!EMAIL.test(c.email)) errors.push('That email address doesn\'t look right.');
    if (/[;,]/.test(c.name)) errors.push('Please leave commas and semicolons out of the name.');
    return { ok: !errors.length, errors: errors, clean: c };
  }

  /** The row still holds what the page showed (unit + email + name). */
  function same(row, code, orig) {
    if (!row || U().code(row['Unit']) !== code) return false;
    return str(row['Email']).toLowerCase() === str(orig && orig.email).toLowerCase() && str(row['Name']) === str(orig && orig.name);
  }

  /** Natural unit order: type (C, S, T …) then number (T41 before T964); blank / unreadable last. */
  function unitSortKey(unit) {
    var c = U().code(unit);
    if (!c) return '~';
    var m = /^(\D*)(\d+)$/.exec(c);
    return m ? m[1] + ('00000' + m[2]).slice(-5) : c;
  }

  /**
   * Unit Contacts tab rows (arrays, header excluded) in unit order, then role (ROLES order, others after, Exclude
   * last), then name; stable. unitIdx / roleIdx / nameIdx: column indexes.
   */
  function sortRows(rows, unitIdx, roleIdx, nameIdx) {
    var rank = function (role) {
      var r = str(role).toLowerCase();
      if (r === 'exclude') return 99;
      var i = ROLES.map(function (x) { return x.toLowerCase(); }).indexOf(r);
      return i < 0 ? 50 : i;
    };
    return (rows || []).map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var ua = unitSortKey(a.r[unitIdx]), ub = unitSortKey(b.r[unitIdx]);
      if (ua !== ub) return ua < ub ? -1 : 1;
      var ra = rank(a.r[roleIdx]), rb = rank(b.r[roleIdx]);
      if (ra !== rb) return ra - rb;
      var na = str(a.r[nameIdx]).toLowerCase(), nb = str(b.r[nameIdx]).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  // ---------- Unit meetings (Jim W., 2026-11-01): Unit Info columns shown and edited at the top of the panel ----------
  // Committee and the unit's own contacts can edit them. Last Updated / Updated By are written on save, never shown.
  var MEETING = [
    { key: 'day', col: 'Meeting Day', max: 40 }, { key: 'time', col: 'Meeting Time', max: 40 },
    { key: 'frequency', col: 'Meeting Frequency', max: 60 }, { key: 'location', col: 'Meeting Location', max: 120 },
    { key: 'address', col: 'Meeting Address', max: 200 }, { key: 'notes', col: 'Meeting Notes', max: 500 }];
  // Eagles to Date: its own field with its own Edit/Save (Jim W., 2026-11-01). Blank = unknown; 0 counts (lib/eagleCount.js).
  var EAGLES = 'Eagles to Date';
  var STAMP = ['Last Updated', 'Updated By'];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Varies'];
  var FREQUENCIES = ['Weekly', 'Every other week', '1st & 3rd', '2nd & 4th', 'Monthly', 'During the school year', 'Varies'];

  /** A row's value for a header, matched without regard to case or spaces ("Last updated" = "Last Updated"). */
  function cell(row, name) {
    if (!row) return '';
    if (row[name] !== undefined) return row[name];
    var want = name.toLowerCase().replace(/\s+/g, ' ');
    var k = Object.keys(row).filter(function (x) { return x.trim().toLowerCase().replace(/\s+/g, ' ') === want; })[0];
    return k === undefined ? '' : row[k];
  }

  /** info: Tabs.read('Unit Info') rows. -> { row (sheet row, 0 = none yet), fields: {day, time, frequency, location, address, notes} } */
  function meetingFor(info, code) {
    var r = (info || []).filter(function (x) { return U().code(x['Unit']) === code; })[0] || null;
    var fields = {};
    MEETING.forEach(function (m) {
      fields[m.key] = str(cell(r, m.col));   // rows read as the sheet DISPLAYS them (a typed "7:00 PM" may be a time value)
    });
    return { row: r ? r._row : 0, fields: fields };
  }

  /** What the page sent -> { ok, errors, clean } (every field optional; trimmed; capped). */
  function validateMeeting(f) {
    var clean = {}, errors = [];
    MEETING.forEach(function (m) {
      var v = str(f && f[m.key]).replace(/\s+\n/g, '\n');
      if (v.length > m.max) errors.push(m.col.replace('Meeting ', '') + ' is too long (at most ' + m.max + ' characters).');
      clean[m.key] = v.slice(0, m.max);
    });
    return { ok: !errors.length, errors: errors, clean: clean };
  }

  /** The sheet still holds what the page showed (nobody changed it meanwhile). */
  function sameMeeting(fields, orig) {
    return MEETING.every(function (m) { return str(fields && fields[m.key]) === str(orig && orig[m.key]); });
  }

  /** info rows -> the unit's Eagles to Date as shown ('' = unknown). */
  function eaglesFor(info, code) {
    var r = (info || []).filter(function (x) { return U().code(x['Unit']) === code; })[0] || null;
    return str(cell(r, EAGLES));
  }
  /** Typed value -> {ok, error, clean}: a whole number, or blank (unknown). */
  function validateEagles(v) {
    var s = str(v).replace(/,/g, '');
    if (s && !/^\d{1,6}$/.test(s)) return { ok: false, error: 'Please enter a whole number, or leave it blank if you don\'t know.', clean: s };
    return { ok: true, clean: s ? String(Number(s)) : '' };
  }

  /** Column headers present (any case) -> the ones to add, canonical spelling. */
  function missingColumns(headers) {
    var have = (headers || []).map(function (h) { return str(h).toLowerCase().replace(/\s+/g, ' '); });
    return MEETING.map(function (m) { return m.col; }).concat([EAGLES], STAMP).filter(function (c) { return have.indexOf(c.toLowerCase()) < 0; });
  }

  /** Canonical column name -> the header actually on the tab (any case). */
  function actualColumn(headers, name) {
    var want = name.toLowerCase();
    return (headers || []).map(str).filter(function (h) { return h.toLowerCase().replace(/\s+/g, ' ') === want; })[0] || name;
  }

  return { MEETING: MEETING, STAMP: STAMP, EAGLES: EAGLES, eaglesFor: eaglesFor, validateEagles: validateEagles, DAYS: DAYS, FREQUENCIES: FREQUENCIES, cell: cell, meetingFor: meetingFor, validateMeeting: validateMeeting,
    sameMeeting: sameMeeting, missingColumns: missingColumns, actualColumn: actualColumn, isBlankContact: isBlankContact, blankContactRows: blankContactRows,
    unitSortKey: unitSortKey, sortRows: sortRows, KEY3_ROLES: KEY3_ROLES, ROLES: ROLES, key3For: key3For, contactsFor: contactsFor, directory: directory, validate: validate, same: same };
})();

if (typeof module !== 'undefined') module.exports = UnitDirectory;
