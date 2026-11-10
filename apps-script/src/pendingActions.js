/**
 * "Whose move is it" (design note kept outside the repo): the hidden _pending_since column. Rules in lib/pending.js.
 *
 * Raised by Scout file submissions (attachFiles_: first submission, matched duplicate, Scout Update).
 * Cleared by a committee decision: Action-column move, Action → "✓ Checked: nothing to do", Review outcome.
 * Shown in the sheet as an amber Action cell (conditional formatting, works without triggers).
 */
var PENDING_FILL_ = '#f9d58c';

function hasPendingColumn_() { return Records.columns().indexOf(Pending.COLUMN) >= 0; }

/** A Scout sent files: start (or keep) the clock. Never throws (filing the files matters more). */
function raisePending_(recordId) {
  try {
    if (!hasPendingColumn_()) return;
    var rec = Records.get(recordId);
    if (!rec) return;
    var cur = rec.fields[Pending.COLUMN];
    if (Pending.isPending(cur)) return;                       // oldest submission wins
    var set = {};
    set[Pending.COLUMN] = Pending.raise(cur, Date.now());
    Records.update(recordId, set);
  } catch (e) { console.warn('raisePending_ ' + recordId + ': ' + e); }
}

/**
 * A committee member acted: stop the clock. Returns true if something was waiting (caller adds to its log line),
 * or, with how set, writes its own log line.
 */
function clearPending_(recordId, by, how) {
  try {
    if (!hasPendingColumn_()) return false;
    var rec = Records.get(recordId);
    if (!rec || !Pending.isPending(rec.fields[Pending.COLUMN])) return false;
    var set = {};
    set[Pending.COLUMN] = '';
    Records.update(recordId, set);
    if (how) addRecordNote_(recordId, Pending.clearedLine(Intake.shortDate(new Date()), by, how));
    return true;
  } catch (e) { console.warn('clearPending_ ' + recordId + ': ' + e); return false; }
}

/** Scouts waiting on the committee, oldest first: [{title, since, days, section}]. */
function pendingWaiting_() {
  if (!hasPendingColumn_()) return [];
  return Pending.waiting(Records.all(['scout_name', 'unit', Pending.COLUMN]).map(function (r) {
    return { scout_name: r.scout_name, unit: r.unit, pending: r[Pending.COLUMN], section: r.section };
  }), Date.now());
}

/**
 * Setup / repair: amber Action cell while _pending_since has a value. Our rule is recognised by its formula
 * (=LEN($<col><row>)>0 on the Action column) and replaced, so a moved column is picked up on the next repair.
 */
function ensurePendingFormat_() {
  var sh = getTrackingSheet_();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m || m.map.action === undefined || m.map[Pending.COLUMN] === undefined) return false;
  var first = m.row + 3;                                       // first data row (1-based), below the visible label row
  var actionCol = m.map.action + 1;
  var colLetter = sh.getRange(1, m.map[Pending.COLUMN] + 1).getA1Notation().replace(/\d+$/, '');
  var formula = '=LEN($' + colLetter + first + ')>0';
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    var c = r.getBooleanCondition();
    var vals = c ? c.getCriteriaValues() : [];
    var ours = vals.length && /^=LEN\(\$[A-Z]+\d+\)>0$/.test(String(vals[0])) &&
      r.getRanges().some(function (g) { return g.getColumn() === actionCol && g.getNumColumns() === 1; });
    return !ours;
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground(PENDING_FILL_)
    .setRanges([sh.getRange(first, actionCol, Math.max(sh.getMaxRows() - first + 1, 1), 1)])
    .build());
  sh.setConditionalFormatRules(rules);
  return true;
}

/**
 * Admin → "New files: flag selected rows". For rows a member knows are waiting (existing rows start empty):
 * sets the time from the Scout's latest upload (Uploads Log), else now. Rows already flagged are left alone.
 */
function menuFlagPending() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== getSettings_().trackingTab) { ui.alert('Select Scout rows on the "' + getSettings_().trackingTab + '" tab first.'); return; }
  if (!hasPendingColumn_()) { ui.alert('No ' + Pending.COLUMN + ' column yet: run Admin → Setup / repair tabs.'); return; }
  var m = SheetModel.findMachineRow(sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues());
  var ids = [];
  sh.getActiveRangeList().getRanges().forEach(function (g) {
    sh.getRange(g.getRow(), m.keyCol + 1, g.getNumRows(), 1).getValues().forEach(function (v) {
      if (SheetModel.isRecordId(v[0]) && ids.indexOf(String(v[0])) < 0) ids.push(String(v[0]));
    });
  });
  if (!ids.length) { ui.alert('No Scout rows selected.'); return; }
  var uploads = Tabs.read(UPLOADS_TAB);
  var done = [];
  ids.forEach(function (id) {
    var rec = Records.get(id);
    if (!rec || Pending.isPending(rec.fields[Pending.COLUMN])) return;
    var latest = uploads.filter(function (u) { return String(u['Record ID']) === id && u['Received']; })
      .map(function (u) { return Pending.ms(u['Received']); }).reduce(function (a, b) { return Math.max(a, b); }, 0);
    var set = {};
    set[Pending.COLUMN] = new Date(latest || Date.now());
    Records.update(id, set);
    done.push(rec.fields.scout_name + (latest ? ' (files from ' + Utilities.formatDate(new Date(latest), Session.getScriptTimeZone(), 'M/d') + ')' : ' (no upload found: now)'));
  });
  ui.alert(done.length ? 'Flagged as new files waiting:\n' + done.join('\n') : 'Nothing changed (already flagged).');
}
