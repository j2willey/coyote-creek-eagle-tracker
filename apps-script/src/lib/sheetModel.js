/**
 * SheetModel: read the tracking tab's structure from plain 2D arrays.
 *
 * Pure. All indexes are 0-based; adapters add 1 for SpreadsheetApp.
 *
 * Conventions (solution-options.md, element 6):
 *  - A hidden "machine header row" holds unique column names; its cell in
 *    the key column is "_key".
 *  - The hidden key column holds "S:<sectionKey>" on section label rows and
 *    "R-<id>" on Candidate Record rows. Position = status: a record's
 *    section is the nearest section key above it.
 */
var SheetModel = (function () {
  var KEY_HEADER = '_key';
  var SECTION_PREFIX = 'S:';
  var RECORD_PREFIX = 'R-';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function isSectionKey(v) { return str(v).indexOf(SECTION_PREFIX) === 0; }
  function isRecordId(v) { return str(v).indexOf(RECORD_PREFIX) === 0; }
  function sectionKeyOf(v) { return isSectionKey(v) ? str(v).slice(SECTION_PREFIX.length) : null; }

  /** Find the machine header row among the top rows. */
  /**
   * Where a missing column goes: 0-based index of the column to insert AFTER
   * (the first of afterNames present; else the last visible named column),
   * or -1 if `name` is already there.
   */
  function insertAfterFor(machineRow, name, afterNames) {
    var names = (machineRow || []).map(str);
    if (names.indexOf(name) >= 0) return -1;
    for (var i = 0; i < (afterNames || []).length; i++) {
      var at = names.indexOf(afterNames[i]);
      if (at >= 0) return at;
    }
    for (var c = names.length - 1; c >= 0; c--) {
      if (names[c] && names[c].charAt(0) !== '_') return c;
    }
    return names.length - 1;
  }

  function findMachineRow(topRows) {
    for (var r = 0; r < topRows.length; r++) {
      var c = topRows[r].map(str).indexOf(KEY_HEADER);
      if (c >= 0) return { row: r, keyCol: c, map: buildHeaderMap(topRows[r]) };
    }
    return null;
  }

  /** name -> column index. Throws on duplicate non-empty names. */
  function buildHeaderMap(machineRow) {
    var map = {};
    machineRow.forEach(function (v, i) {
      var name = str(v);
      if (!name) return;
      if (Object.prototype.hasOwnProperty.call(map, name)) {
        throw new Error('Duplicate machine header "' + name + '" in columns ' + (map[name] + 1) + ' and ' + (i + 1));
      }
      map[name] = i;
    });
    return map;
  }

  /** sectionKey -> row index, from the key column values. */
  function sectionRows(keyCol) {
    var out = {};
    keyCol.forEach(function (v, r) {
      var k = sectionKeyOf(v);
      if (k && out[k] === undefined) out[k] = r;
    });
    return out;
  }

  function findRecordRow(keyCol, recordId) {
    var id = str(recordId);
    for (var r = 0; r < keyCol.length; r++) if (str(keyCol[r]) === id) return r;
    return -1;
  }

  function sectionForRow(keyCol, row) {
    for (var r = row; r >= 0; r--) {
      var k = sectionKeyOf(keyCol[r]);
      if (k) return k;
    }
    return null;
  }

  /**
   * Row index where a new record for `sectionKey` should be inserted
   * (insert BEFORE this index): directly after the section's last record,
   * or directly after the label row when the section is empty.
   * Returns -1 if the section is not found.
   */
  function insertionRow(keyCol, sectionKey) {
    var start = sectionRows(keyCol)[sectionKey];
    if (start === undefined) return -1;
    var last = start;
    for (var r = start + 1; r < keyCol.length; r++) {
      if (isSectionKey(keyCol[r])) break;
      if (isRecordId(keyCol[r])) last = r;
    }
    return last + 1;
  }

  /** Row index where a record MOVED into `sectionKey` goes: top of the section, right under its label row. -1 if not found. */
  function topRow(keyCol, sectionKey) {
    var start = sectionRows(keyCol)[sectionKey];
    return start === undefined ? -1 : start + 1;
  }

  /** {first, last} row indexes spanning the section's records (label row excluded), or null if it has none. */
  function recordSpan(keyCol, sectionKey) {
    var start = sectionRows(keyCol)[sectionKey];
    if (start === undefined) return null;
    var last = -1;
    for (var r = start + 1; r < keyCol.length; r++) {
      if (isSectionKey(keyCol[r])) break;
      if (isRecordId(keyCol[r])) last = r;
    }
    return last < 0 ? null : { first: start + 1, last: last };
  }

  var B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I, L, O, U, 0, 1
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Record ID = "R-" + yymmddhhmm (creation time, script time zone) + "-" +
   * 3 random chars, e.g. R-2610111530-K7Q. The suffix keeps IDs unique when
   * many are made in the same minute (migration). Older "R-XXXXXXXX" IDs
   * stay valid: only the "R-" prefix matters to the code.
   * randomFn: () => [0,1), default Math.random. now: Date, default new Date().
   */
  function makeRecordId(randomFn, existing, now) {
    var rnd = randomFn || Math.random;
    var d = now || new Date();
    var stamp = pad2(d.getFullYear() % 100) + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
                pad2(d.getHours()) + pad2(d.getMinutes());
    var taken = {};
    (existing || []).forEach(function (k) { taken[str(k)] = true; });
    for (var tries = 0; tries < 200; tries++) {
      var s = RECORD_PREFIX + stamp + '-';
      for (var i = 0; i < 3; i++) s += B32.charAt(Math.floor(rnd() * B32.length));
      if (!taken[s]) return s;
    }
    throw new Error('Could not generate a unique Record ID');
  }

  /**
   * Check the model is usable. Returns a list of problems (empty = OK).
   * settings.sections: [{key, ...}] in top-to-bottom order.
   */
  function validate(keyCol, headerMap, settings, requiredColumns) {
    var problems = [];
    var secs = sectionRows(keyCol);
    var lastRow = -1;
    (settings.sections || []).forEach(function (s) {
      if (secs[s.key] === undefined) problems.push('Section key missing on sheet: S:' + s.key);
      else {
        if (secs[s.key] < lastRow) problems.push('Section out of order: S:' + s.key);
        lastRow = secs[s.key];
      }
    });
    (requiredColumns || []).forEach(function (c) {
      if (!headerMap || headerMap[c] === undefined) problems.push('Machine header missing: ' + c);
    });
    var seen = {};
    keyCol.forEach(function (v, r) {
      var k = str(v);
      if (!k) return;
      if (seen[k] !== undefined) problems.push('Duplicate key ' + k + ' on rows ' + (seen[k] + 1) + ' and ' + (r + 1));
      seen[k] = r;
    });
    return problems;
  }

  /**
   * Rows a committee member inserted by hand: a Scout name but no key, below
   * the first section. -> [{row, id}] (0-based rows) with fresh Record IDs.
   */
  function missingRecordKeys(keyCol, nameCol, randomFn, now) {
    var first = -1;
    for (var r = 0; r < keyCol.length; r++) if (isSectionKey(keyCol[r])) { first = r; break; }
    if (first < 0) return [];
    var used = keyCol.map(str).filter(Boolean);
    var out = [];
    for (var i = first + 1; i < keyCol.length; i++) {
      if (str(keyCol[i]) || !str(nameCol[i])) continue;
      var id = makeRecordId(randomFn, used, now);
      used.push(id);
      out.push({ row: i, id: id });
    }
    return out;
  }

  /** Record IDs on rows with no Scout name (e.g. visible cells cut/pasted without the hidden key). 0-based rows. */
  function orphanKeys(keyCol, nameCol) {
    var out = [];
    keyCol.forEach(function (k, r) { if (isRecordId(k) && !str(nameCol[r])) out.push(r); });
    return out;
  }

  // ---------- migration helpers (used once per sheet) ----------

  function slug(s) {
    return str(s).toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function colLetter(i) {
    var s = '';
    i += 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // Known visible labels -> stable machine names (normalized label match).
  var LABEL_OVERRIDES = {
    'eagle candidate': 'scout_name',
    'unit': 'unit',
    'birth date': 'birth_date',
    'female?': 'female',
    'scout email': 'scout_email',
    'parent/guardian email': 'parent_email',
    'parent email': 'parent_email',
    'scout phone': 'scout_phone',
    'bsa id #': 'bsa_id',
    'bsa id': 'bsa_id',
    'extension needed?': 'extension_needed',
    'age': 'age',
    'eagle proj': 'proj_title',
    'beneficiary': 'beneficiary',
    'address of eagle project': 'proj_address',
    'eagle project coach': 'proj_coach',
    'estimated fundraising amount': 'est_fundraising',
    'notes': 'notes',
    'latest note': 'notes',
    'action': 'action',
    'notes doc': 'notes_doc'
  };

  function normLabel(s) { return str(s).toLowerCase().replace(/\s+/g, ' '); }

  /**
   * Propose unique machine names from the visible group row (merged cells:
   * value only in the first cell, so fill forward) and label row.
   * Known labels get fixed names; others become group.label slugs;
   * blanks become col_<LETTER>. Duplicates get _2, _3...
   */
  // Labels too generic to stand alone: always prefixed with their group.
  var GENERIC = { date: 1, who: 1, done: 1, status: 1, name: 1, email: 1, phone: 1, yes: 1 };
  var MAX_PART = 40;

  function cap(s, n) { return s.length > n ? s.slice(0, n).replace(/_+$/, '') : s; }

  function proposeMachineNames(groupRow, labelRow) {
    var width = Math.max((groupRow || []).length, (labelRow || []).length);
    var group = '';
    var raw = [];
    var counts = {};
    // Pass 1: plain label slugs (overrides win).
    for (var i = 0; i < width; i++) {
      var g = str(groupRow && groupRow[i]);
      if (g) group = g;
      var label = str(labelRow && labelRow[i]);
      var item = { group: group, label: label, fixed: false, base: '' };
      if (!label) { item.base = 'col_' + colLetter(i); item.fixed = true; }
      else if (LABEL_OVERRIDES[normLabel(label)]) { item.base = LABEL_OVERRIDES[normLabel(label)]; item.fixed = true; }
      else item.base = cap(slug(label), MAX_PART) || ('col_' + colLetter(i));
      if (!item.fixed) counts[item.base] = (counts[item.base] || 0) + 1;
      raw.push(item);
    }
    // Pass 2: prefix the group only for generic or repeated labels; then dedupe.
    var used = {};
    return raw.map(function (it) {
      var name = it.base;
      if (!it.fixed && it.group && (GENERIC[it.base] || counts[it.base] > 1)) {
        name = cap(slug(it.group), 28) + '.' + it.base;
      }
      var base = name, n = 2;
      while (used[name]) name = base + '_' + (n++);
      used[name] = true;
      return name;
    });
  }

  /** Index of the first row in `rows` with a cell equal to `label` (case-insensitive). */
  function findLabelRow(rows, label, maxRows) {
    var want = normLabel(label);
    var lim = Math.min(rows.length, maxRows || 15);
    for (var r = 0; r < lim; r++) {
      if (rows[r].some(function (v) { return normLabel(v) === want; })) return r;
    }
    return -1;
  }

  /**
   * Find section label rows: a row whose first non-empty cell (within the
   * first `scanCols` columns) starts with a section's label. Other cells on
   * the row are ignored by default (e.g. "Submitted Eagle Applications" carries
   * its own column headers); pass maxOtherCells to restrict.
   * returns { key: rowIndex } for the first match of each section.
   */
  function detectSectionRows(rows, sections, opts) {
    var o = opts || {};
    var scanCols = o.scanCols || 3;
    var maxOther = o.maxOtherCells == null ? Infinity : o.maxOtherCells;
    var startRow = o.startRow || 0;
    var found = {};
    for (var r = startRow; r < rows.length; r++) {
      var row = rows[r];
      var firstIdx = -1;
      for (var c = 0; c < Math.min(scanCols, row.length); c++) if (str(row[c])) { firstIdx = c; break; }
      if (firstIdx < 0) continue;
      var first = normLabel(row[firstIdx]);
      var others = row.filter(function (v, i) { return i !== firstIdx && str(v); }).length;
      if (others > maxOther) continue;
      // Label or any alias (older header text); the LONGEST matching prefix wins
      // ("Pre-Review Call Scheduled" is not "Pre-Review Call").
      var best = null, bestLen = 0;
      for (var s = 0; s < sections.length; s++) {
        var sec = sections[s];
        if (found[sec.key] !== undefined) continue;
        [sec.label].concat(sec.aliases || []).forEach(function (l) {
          var n = normLabel(l);
          if (n && first.indexOf(n) === 0 && n.length > bestLen) { best = sec.key; bestLen = n.length; }
        });
      }
      if (best) found[best] = r;
    }
    return found;
  }

  /**
   * After migration: give machine names to columns added later.
   * machineRow/groupRow/labelRow: arrays (same width). Fills only empty
   * machine cells whose visible label is non-empty. Returns
   * { row: newMachineRow, added: [{col, name}] }.
   */
  function fillMissingNames(machineRow, groupRow, labelRow) {
    var width = Math.max(machineRow.length, (groupRow || []).length, (labelRow || []).length);
    var proposed = proposeMachineNames(groupRow || [], labelRow || []);
    var row = machineRow.slice();
    while (row.length < width) row.push('');
    var used = {};
    row.forEach(function (v) { if (str(v)) used[str(v)] = true; });
    var added = [];
    for (var i = 0; i < width; i++) {
      if (str(row[i]) || !str(labelRow && labelRow[i])) continue;
      var base = proposed[i] || ('col_' + colLetter(i)), name = base, n = 2;
      while (used[name]) name = base + '_' + (n++);
      used[name] = true;
      row[i] = name;
      added.push({ col: i, name: name });
    }
    return { row: row, added: added };
  }

  return {
    KEY_HEADER: KEY_HEADER,
    missingRecordKeys: missingRecordKeys,
    orphanKeys: orphanKeys,
    fillMissingNames: fillMissingNames,
    SECTION_PREFIX: SECTION_PREFIX,
    RECORD_PREFIX: RECORD_PREFIX,
    isSectionKey: isSectionKey,
    isRecordId: isRecordId,
    sectionKeyOf: sectionKeyOf,
    findMachineRow: findMachineRow,
    insertAfterFor: insertAfterFor,
    buildHeaderMap: buildHeaderMap,
    sectionRows: sectionRows,
    findRecordRow: findRecordRow,
    sectionForRow: sectionForRow,
    insertionRow: insertionRow,
    topRow: topRow,
    recordSpan: recordSpan,
    makeRecordId: makeRecordId,
    validate: validate,
    slug: slug,
    colLetter: colLetter,
    proposeMachineNames: proposeMachineNames,
    findLabelRow: findLabelRow,
    detectSectionRows: detectSectionRows
  };
})();

if (typeof module !== 'undefined') module.exports = SheetModel;
