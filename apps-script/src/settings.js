/**
 * Settings adapter: reads/writes the "Settings" tab of the bound spreadsheet.
 * Parsing lives in lib/settingsModel.js.
 */
var SETTINGS_TAB = 'Settings';

function getSettings_() {
  var cache = getSettings_._cache;
  if (cache) return cache;
  var hit = null;
  try { hit = CacheService.getScriptCache().get('c:settings'); } catch (e) {}
  var s = null;
  if (hit) { try { s = JSON.parse(hit); } catch (e) {} }
  if (!s) s = readSettingsTab_(true);
  getSettings_._cache = s;
  return s;
}

/**
 * Read the Settings tab. Only a complete read is cached: if the tab is missing or nearly empty (e.g. read while
 * Setup was rewriting it), the result is used once but NOT cached, so one bad read can't stick for 5 minutes
 * (seen 10/22: "scheduleSheetId is empty" while it was set).
 */
function readSettingsTab_(cacheIt) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  var values = sh ? sh.getDataRange().getValues() : [];
  var keyRows = values.filter(function (r, i) { return i > 0 && String(r[0] == null ? '' : r[0]).trim(); }).length;
  var s = SettingsModel.parse(values);
  if (cacheIt && keyRows >= 10) {
    try { CacheService.getScriptCache().put('c:settings', JSON.stringify(s), CACHE_TTL_S); } catch (e) {}
  } else if (keyRows < 10) {
    console.warn('Settings read looks incomplete (' + keyRows + ' keys' + (sh ? '' : ', no Settings tab') + '): not cached');
  }
  return s;
}

/** A required setting is blank: re-read the tab (bypassing the cache) before believing it. */
function settingFresh_(key) {
  var v = getSettings_()[key];
  if (v !== '' && v != null) return v;
  uncache_('c:settings');
  getSettings_._cache = readSettingsTab_(true);
  return getSettings_._cache[key];
}

function clearSettingsCache_() { getSettings_._cache = null; uncache_('c:settings'); }

/** Create the Settings tab with defaults if it doesn't exist. Returns true if created. */
function ensureSettingsTab_() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(SETTINGS_TAB)) return false;
  var me = Session.getEffectiveUser().getEmail();
  var rows = SettingsModel.defaultRows({ testRecipient: me, adminEmail: me });
  var sh = ss.insertSheet(SETTINGS_TAB);
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 7);
  sh.getRange('A1').setNote('Settings for the Eagle Tracker scripts. testMode TRUE = all email goes only to testRecipient. ' +
    'Section keys (column D) must match the S:<key> values in the hidden _key column of the tracking tab.');
  clearSettingsCache_();
  return true;
}

/** Update one key in column A/B (adds a row if missing). */
function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  if (!sh) throw new Error('No Settings tab. Run "Setup / repair tabs" first.');
  var col = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var r = 1; r < col.length; r++) {
    if (String(col[r][0]).trim() === key) { sh.getRange(r + 1, 2).setValue(value); clearSettingsCache_(); return; }
  }
  // first empty row in column A
  for (var r2 = 1; r2 < col.length; r2++) {
    if (!String(col[r2][0]).trim()) { sh.getRange(r2 + 1, 1, 1, 2).setValues([[key, value]]); clearSettingsCache_(); return; }
  }
  sh.getRange(col.length + 1, 1, 1, 2).setValues([[key, value]]);
  clearSettingsCache_();
}

function getTrackingSheet_() {
  var s = getSettings_();
  var sh = SpreadsheetApp.getActive().getSheetByName(s.trackingTab);
  if (!sh) throw new Error('Tracking tab "' + s.trackingTab + '" not found (Settings → trackingTab).');
  return sh;
}
