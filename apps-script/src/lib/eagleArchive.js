/**
 * EagleArchive (Jim W., 2026-11-10): the January archive of Eagles. A past year's Eagle Earned rows go to the TOP of the
 * "Eagle Archive" tab in the tracking spreadsheet, as a new year section ("<year> Eagles", newest year first). The
 * archive's columns are matched to the tracking tab's by machine name (hidden row 2), not by position: the archive may
 * have its own order, extra columns, or lack newer ones. Pure; the sheet work is in adminActions.js.
 */
var EagleArchive = (function () {
  var DEFAULT_TAB = 'Eagle Archive';
  var KEY = '_key';
  var LABEL_KEY_PREFIX = 'S:eagles_';
  /** Machine names whose cells are not copied: the Action dropdown means nothing on an archived row. */
  var SKIP = ['action'];

  function str(v) { return v == null ? '' : String(v).trim(); }
  /** Machine names compare without case or extra spaces. */
  function norm(v) { return str(v).toLowerCase().replace(/\s+/g, ' '); }
  function ymd(v) { var m = /^(\d{4})-\d\d-\d\d/.exec(str(v)); return m ? m[0] : ''; }

  /** Settings eagleArchiveTab; blank = "Eagle Archive". */
  function tabName(v) { return str(v) || DEFAULT_TAB; }
  /** "2025 Eagles" */
  function labelText(year) { return String(year) + ' Eagles'; }
  /** "S:eagles_2025" */
  function labelKey(year) { return LABEL_KEY_PREFIX + String(year); }

  /**
   * Column mapping. trackingMachine / archiveMachine: the machine rows (arrays of names).
   * -> {pairs: [{name, from, to, added?}], added: [name], archiveOnly: [name], keyFrom, keyTo, archiveWidth}
   *   pairs   every tracking column that goes into the archive (to = archive column index; added columns get new
   *           indexes at the right end, in tracking order), minus the SKIP columns (not copied)
   *   added   tracking columns the archive lacks (the adapter appends them: heading, machine name, header)
   *   archiveOnly  archive columns the tracking tab doesn't have (left blank on new rows)
   * Throws when either side has no _key column or repeats a machine name.
   */
  function mapColumns(trackingMachine, archiveMachine) {
    function index(row, what) {
      var map = {}, names = [];
      (row || []).forEach(function (v, i) {
        var n = norm(v);
        if (!n) return;
        if (map[n] !== undefined) throw new Error('The machine name "' + str(v) + '" appears twice in ' + what + ' (columns ' + (map[n] + 1) + ' and ' + (i + 1) + ').');
        map[n] = i; names.push({ n: n, label: str(v), i: i });
      });
      return { map: map, names: names };
    }
    var t = index(trackingMachine, 'the tracking tab'), a = index(archiveMachine, 'the archive tab');
    if (t.map[KEY] === undefined) throw new Error('The tracking tab has no ' + KEY + ' column in its machine row.');
    if (a.map[KEY] === undefined) throw new Error('The archive tab has no ' + KEY + ' column in its machine row.');
    var width = (archiveMachine || []).length;
    var pairs = [], added = [];
    t.names.forEach(function (x) {
      var skip = SKIP.indexOf(x.n) >= 0;
      if (a.map[x.n] !== undefined) { if (!skip) pairs.push({ name: x.label, from: x.i, to: a.map[x.n] }); return; }
      if (skip) return;
      var to = width + added.length;
      added.push(x.label);
      pairs.push({ name: x.label, from: x.i, to: to, added: true });
    });
    var archiveOnly = a.names.filter(function (x) { return t.map[x.n] === undefined; }).map(function (x) { return x.label; });
    return { pairs: pairs, added: added, archiveOnly: archiveOnly, keyFrom: t.map[KEY], keyTo: a.map[KEY], archiveWidth: width + added.length };
  }

  /** Year of a year-label row, from its key ("S:eagles_2025") or its text ("2025 Eagles"); null for any other row. */
  function yearOfLabel(key, text) {
    var k = str(key), m = /^S:eagles_(\d{4})$/i.exec(k);
    if (m) return m[1];
    m = /^(\d{4}) Eagles$/i.exec(str(text).replace(/\s+/g, ' '));
    if (m && (k === '' || k.indexOf('S:') === 0)) return m[1];
    return null;
  }

  /**
   * Where the year goes on the archive tab (all indexes 0-based rows).
   *   keys, texts   the key column and each row's first non-empty cell
   *   firstFree     first row below the header rows (machine row + 3: visible header, filter row)
   *   year
   * -> {existing: row of this year's label or -1, insertAt, labels: [{row, year}]}
   *   When the year's label already exists, insertAt is the row under it (rows join that section). Otherwise
   *   insertAt is the row of the first year label older than this year (newest year first), or the end of the data.
   */
  function placement(keys, texts, firstFree, year) {
    var labels = [];
    for (var r = Math.max(firstFree, 0); r < keys.length; r++) {
      var y = yearOfLabel(keys[r], texts ? texts[r] : '');
      if (y) labels.push({ row: r, year: y });
    }
    var same = labels.filter(function (l) { return l.year === String(year); })[0];
    if (same) return { existing: same.row, insertAt: same.row + 1, labels: labels };
    var older = labels.filter(function (l) { return Number(l.year) < Number(year); })[0];
    var end = Math.max(keys.length, firstFree);
    return { existing: -1, insertAt: older ? older.row : end, labels: labels };
  }

  /** Record IDs in `ids` already in the archive's key column, and those still to add. */
  function split(archiveKeys, ids) {
    var have = {};
    (archiveKeys || []).forEach(function (k) { if (str(k)) have[str(k)] = true; });
    var present = [], todo = [];
    (ids || []).forEach(function (id) { (have[id] ? present : todo).push(id); });
    return { present: present, todo: todo };
  }

  /** rows [{id, ebor 'YYYY-MM-DD' | ''}] -> ids, latest EBoR first (no date last; equal dates keep their order). */
  function order(rows) {
    return (rows || []).map(function (r, i) { return { id: r.id, t: ymd(r.ebor), i: i }; })
      .sort(function (a, b) {
        if (a.t !== b.t) return a.t === '' ? 1 : b.t === '' ? -1 : (a.t < b.t ? 1 : -1);
        return a.i - b.i;
      }).map(function (x) { return x.id; });
  }

  /**
   * Source rows (any numbers, in destination order) -> runs of consecutive source rows, so each column is copied
   * with a few Range.copyTo calls: [{from: first source row, offset: position in the destination list, len}].
   */
  function runs(srcRows) {
    var out = [];
    (srcRows || []).forEach(function (r, i) {
      var last = out[out.length - 1];
      if (last && r === last.from + last.len) last.len++;
      else out.push({ from: r, offset: i, len: 1 });
    });
    return out;
  }

  /** Record IDs from `ids` NOT on the archive (key column). Deleting from the tracking tab needs this to be empty. */
  function missing(archiveKeys, ids) { return split(archiveKeys, ids).todo; }

  /** The dry run shown on the Admin page. */
  function report(year, names, map, tabExists, split_) {
    return { year: String(year), label: labelText(year), tab: tabExists, names: names || [],
      added: map ? map.added : [], archiveOnly: map ? map.archiveOnly : [],
      alreadyThere: split_ ? split_.present.length : 0 };
  }

  return { DEFAULT_TAB: DEFAULT_TAB, SKIP: SKIP, tabName: tabName, labelText: labelText, labelKey: labelKey, norm: norm,
    mapColumns: mapColumns, yearOfLabel: yearOfLabel, placement: placement, split: split, order: order, runs: runs,
    missing: missing, report: report };
})();

if (typeof module !== 'undefined') module.exports = EagleArchive;
