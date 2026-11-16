/**
 * Key 3 import from the Units page (Admin role; Jim W., 2026-11-16). The District Executive's export is an Excel file
 * whose columns may move or go missing: columns are found by header (lib/key3.js) and units missing from the file are
 * kept. The page reads an .xlsx itself (web/js/xlsx.js: one export's worksheet unzips to 60 MB, past Apps Script's
 * 50 MB blob limit) and sends the rows; a CSV is sent as text.
 *
 *   key3ImportPreview {session, name, rows | csv} -> {summary}
 *   key3ImportApply   {session, name, rows | csv} -> {message}   (sent again: nothing is held between the two)
 * The sheet menu (Admin → Unit contacts: import Key 3) uses the same plan and write (unitContacts.js).
 */
var KEY3_MAX_ROWS = 5000, KEY3_MAX_COLS = 80;

/** {name, rows (2D array) | csv (text)} from the page -> {rows, label}. */
function key3FileRows_(req) {
  var name = String((req && req.name) || '').trim() || 'Key 3 file', rows;
  if (Array.isArray(req && req.rows)) rows = req.rows;
  else if (req && typeof req.csv === 'string' && req.csv.trim()) rows = Utilities.parseCsv(req.csv.replace(/^\uFEFF/, ''));
  else throw userError_('Choose the Key 3 file first.');
  if (rows.length > KEY3_MAX_ROWS) throw userError_('That file has over ' + KEY3_MAX_ROWS + ' rows: is it the right export?');
  rows = rows.map(function (r) {
    return (Array.isArray(r) ? r : []).slice(0, KEY3_MAX_COLS).map(function (v) { return v == null ? '' : String(v).slice(0, 500); });
  });
  return { rows: rows, label: name.slice(0, 120) };
}

/** What the page shows before Apply. */
function key3PreviewOut_(plan, label) {
  var miss = Object.keys(plan.columns).filter(function (k) { return !plan.columns[k]; });
  return { file: label, fromFile: plan.fromFile, total: plan.rows.length,
    skipped: Object.keys(plan.skipped).filter(function (k) { return plan.skipped[k]; }).map(function (k) { return { what: k, n: plan.skipped[k] }; }),
    missingColumns: miss, added: plan.added, removed: plan.removed, kept: plan.kept, carried: plan.carried,
    addresses: plan.rows.filter(function (r) { return r.role === 'Unit Leader' && (r.address || r.city || r.zip); }).length,
    leaders: plan.rows.filter(function (r) { return r.role === 'Unit Leader'; }).length };
}

function actionKey3ImportPreview_(req) {
  adminMe_(req.session);
  var f = key3FileRows_(req);
  return { summary: key3PreviewOut_(key3Plan_(f.rows), f.label) };
}

function actionKey3ImportApply_(req) {
  adminMe_(req.session);
  var f = key3FileRows_(req);
  return { message: key3Write_(key3Plan_(f.rows), f.label) };
}
