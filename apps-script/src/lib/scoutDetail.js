/**
 * ScoutDetail: the Scout detail window (dashboard → click a name). Pure. Jim W., 2026-10-23.
 *
 * Three tabs like the sheet's three areas: Scout Info, Proposal, Eagle / EBoR. A column's tab comes from its GROUP
 * heading on the tracking tab (row above the hidden machine row), so a column added to the sheet appears without a
 * code change. Read-only until the member clicks the pencil; then any field can be edited (formula columns such as
 * Age never). Every change is logged "Label: old → new".
 */
var ScoutDetail = (function () {
  var TABS = [
    { key: 'info', label: 'Scout Info' },
    { key: 'proposal', label: 'Proposal' },
    { key: 'eagle', label: 'Eagle / EBoR' }
  ];
  var HIDDEN = ['action', 'notes'];                        // Notes = the log (header link); Action = the sheet's dropdown

  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Group heading -> tab key. Proposal-ish groups first ("Eagle Project Proposal" is a Proposal group). */
  function tabFor(group, name) {
    var g = str(group).toLowerCase();
    if (/proposal|project|review|pre-?screen|intake|beneficiar|coach/.test(g)) return 'proposal';
    if (/eagle|council|ccdac|ebor|board|signed|svmbc|application/.test(g)) return 'eagle';
    if (/^(proposal_|pre_screen|beneficiary|proj_|est_)/.test(str(name))) return 'proposal';
    return 'info';
  }

  /**
   * groupRow / machineRow / labelRow: the three header rows (arrays, same width). Group cells are often merged:
   * the heading is carried to the right until the next one. -> [{index, name, label, group, tab}] in sheet order.
   */
  function layout(groupRow, machineRow, labelRow) {
    var out = [], group = '';
    for (var i = 0; i < (machineRow || []).length; i++) {
      if (str(groupRow && groupRow[i])) group = str(groupRow[i]);
      var name = str(machineRow[i]);
      if (!name || name.charAt(0) === '_' || HIDDEN.indexOf(name) >= 0) continue;
      var label = str(labelRow && labelRow[i]) || name;
      out.push({ index: i, name: name, label: label, group: group, tab: tabFor(group, name) });
    }
    return out;
  }

  /** A cell value for the page: {type, value} with value as text ('YYYY-MM-DD', 'YYYY-MM-DDTHH:MM', 'true'...). */
  function cell(v, label) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      var d = v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
      if (v.getHours() || v.getMinutes()) return { type: 'datetime', value: d + 'T' + pad(v.getHours()) + ':' + pad(v.getMinutes()) };
      return { type: 'date', value: d };
    }
    if (v === true || v === false) return { type: 'bool', value: v ? 'true' : 'false' };
    if (typeof v === 'number') return { type: 'number', value: String(v) };
    var t = /\bdate\b/i.test(str(label)) && !str(v) ? 'date' : /e-?mail/i.test(str(label)) ? 'email' : 'text';
    return { type: t, value: str(v) };
  }

  /**
   * Fields for one Scout. cols: layout(); row: the record's values (array); formulas: that row's formulas (array).
   * -> [{key, label, tabs: [...]}] tabs with fields [{name, label, type, value, editable}]
   */
  function tabs(cols, row, formulas) {
    return TABS.map(function (t) {
      return { key: t.key, label: t.label, fields: cols.filter(function (c) { return c.tab === t.key; }).map(function (c) {
        var x = cell(row[c.index], c.label);
        return { name: c.name, label: c.label, type: x.type, value: x.value, editable: !str(formulas && formulas[c.index]) };
      }) };
    });
  }

  var EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

  /**
   * edits: {name: text from the page}; fields: tabs()[*].fields flattened (current values + types).
   * -> {errors, changes: [{name, label, from, to, type}]} ; 'to' still text (the adapter makes Dates).
   */
  function changes(edits, fields) {
    var errors = [], out = [];
    var byName = {};
    (fields || []).forEach(function (f) { byName[f.name] = f; });
    Object.keys(edits || {}).forEach(function (name) { if (!byName[name]) errors.push('Unknown field: ' + name); });
    (fields || []).forEach(function (f) {
      var name = f.name;
      if (!Object.prototype.hasOwnProperty.call(edits || {}, name)) return;
      if (!f.editable) { errors.push(f.label + ' is calculated by the sheet and can\'t be edited.'); return; }
      var to = str(edits[name]);
      if (f.type === 'bool') to = (to === 'true' || to === 'yes' || to === '1') ? 'true' : 'false';
      if (to === str(f.value)) return;
      if (f.type === 'date' && to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) { errors.push(f.label + ': pick a date.'); return; }
      if (f.type === 'datetime' && to && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to)) { errors.push(f.label + ': pick a date and time.'); return; }
      if (f.type === 'number' && to && isNaN(Number(to.replace(/[$,]/g, '')))) { errors.push(f.label + ': enter a number.'); return; }
      if ((f.type === 'email' || /email/i.test(name)) && to) {
        var bad = to.split(/[,;\s]+/).filter(Boolean).filter(function (e) { return !EMAIL.test(e); });
        if (bad.length) { errors.push(f.label + ': not an email address: ' + bad.join(', ')); return; }
      }
      if (name === 'scout_name' && !to) { errors.push('The Scout\'s name can\'t be empty.'); return; }
      out.push({ name: name, label: f.label, from: str(f.value), to: to, type: f.type });
    });
    return { errors: errors, changes: out };
  }

  /** "10/23 [AB] Edited: Phone: 408-… → 408-…; Birth date: 2009-13-01 → 2009-01-13" */
  function logLine(shortDate, by, list) {
    return shortDate + ' [' + (str(by) || 'committee') + '] Edited: ' + list.map(function (c) {
      return c.label + ': "' + (c.from || '(blank)') + '" → "' + (c.to || '(blank)') + '"';
    }).join('; ');
  }

  function moveLine(shortDate, by, fromLabel, toLabel, reason) {
    return shortDate + ' [' + (str(by) || 'committee') + '] Moved (correction) from ' + fromLabel + ' to ' + toLabel + ': ' + str(reason).replace(/\s+/g, ' ');
  }

  return { TABS: TABS, tabFor: tabFor, layout: layout, cell: cell, tabs: tabs, changes: changes, logLine: logLine, moveLine: moveLine };
})();

if (typeof module !== 'undefined') module.exports = ScoutDetail;
