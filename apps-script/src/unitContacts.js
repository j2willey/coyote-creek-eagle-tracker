/**
 * Unit tabs (rules in lib/units.js, Key 3 parsing in lib/key3.js):
 *   Key 3          replaced by Admin → Unit contacts: import Key 3 (never hand-edited; warning-only protection)
 *   Unit Contacts  hand-maintained contacts (EBoR Coordinator, Advancement Chair, Other, Exclude…)
 *   Unit Info      one row per unit: Under Review, meeting place/day/time, notes
 */
var KEY3_TAB = 'Key 3';
var KEY3_PREV_TAB = '_Key 3 previous';
var UNIT_CONTACTS_TAB = 'Unit Contacts';
var UNIT_INFO_TAB = 'Unit Info';
var KEY3_HEADERS = ['Unit', 'Role', 'Position', 'Name', 'Email', 'Phone', 'Leader Address', 'Leader City', 'Leader State', 'Leader Zip'];

/**
 * The Key 3 tab as rows keyed by header (like Tabs.read), with the Unit Leader's address under address / city / state / zip.
 * Those four columns are found by machine key when row 2 is a machine-name row, else by header text (lib/key3.js).
 */
function key3Rows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(KEY3_TAB);
  if (!sh || sh.getLastRow() < 1) return [];
  return Key3.readGrid(sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues());
}

/** Write the leader address cells of one Key 3 row (sheet row). fields: {address, city, state, zip}. Call under the lock. */
function writeKey3Address_(row, fields) {
  var sh = SpreadsheetApp.getActive().getSheetByName(KEY3_TAB);
  var top = sh.getRange(1, 1, Math.min(2, sh.getLastRow()), Math.max(sh.getLastColumn(), 1)).getValues();
  var ac = Key3.addressColumns(top);
  Key3.ADDRESS.forEach(function (a) {
    var v = String(fields[a.field] == null ? '' : fields[a.field]);
    if (ac[a.field] === undefined) {
      if (v) throw userError_('The Key 3 tab has no "' + a.col + '" column: run Admin → Setup / repair tabs.');
      return;
    }
    sh.getRange(row, ac[a.field] + 1).setNumberFormat('@').setValue(v);
  });
}
var UNIT_CONTACTS_HEADERS = ['Unit', 'Role', 'Name', 'Email', 'Phone', 'Note', 'Updated', 'Updated By'];
var UNIT_INFO_HEADERS = ['Unit', 'Under Review', 'Lien Doan', 'Meeting Location', 'Meeting Day', 'Meeting Time', 'Unit Notes',
  'Meeting Frequency', 'Meeting Address', 'Meeting Notes', 'Eagles to Date', 'Last Updated', 'Updated By'];

function readTabOrEmpty_(name) {
  try { return Tabs.read(name); } catch (e) { return []; }
}

/** A missing tab = no rows; any other failure (e.g. a timeout during Setup / repair) throws. */
function readTabStrict_(name) {
  if (!SpreadsheetApp.getActive().getSheetByName(name)) return [];
  return Tabs.read(name);
}

/** All units with their combined contacts (EBoR notices, unit sign-in). */
function units_() {
  if (units_._memo) return units_._memo;
  // Like committee_(): a failed read is not cached (it would hide every unit contact for the cache lifetime).
  try {
    units_._memo = cached_('c:units', function () {
      return Units.combine(readTabStrict_(UNIT_INFO_TAB), readTabStrict_(KEY3_TAB), readTabStrict_(UNIT_CONTACTS_TAB));
    });
  } catch (e) {
    console.error('Unit tabs not read (not cached): ' + (e && e.stack || e));
    return [];
  }
  return units_._memo;
}

/**
 * Setup step (dev/staging): the old Unit Info tab had contact email columns. Move each email to a
 * Unit Contacts row, delete those columns, rename Notes → Unit Notes. No-op once done.
 */
function migrateLegacyUnitInfo_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(UNIT_INFO_TAB);
  if (!sh || sh.getLastColumn() < 1) return '';
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var legacy = Units.CONTACT_COLS.filter(function (c) { return head.indexOf(c) >= 0; });
  if (!legacy.length) return '';
  var moved = Units.legacyContacts(Tabs.read(UNIT_INFO_TAB));
  var uc = ss.getSheetByName(UNIT_CONTACTS_TAB);
  if (!uc) {
    uc = ss.insertSheet(UNIT_CONTACTS_TAB);
    uc.getRange(1, 1, 1, UNIT_CONTACTS_HEADERS.length).setValues([UNIT_CONTACTS_HEADERS]).setFontWeight('bold');
    uc.setFrozenRows(1);
  }
  var today = Intake.shortDate(new Date());
  moved.forEach(function (m) {
    Tabs.append(UNIT_CONTACTS_TAB, { 'Unit': m.unit, 'Role': m.role, 'Email': m.email, 'Note': 'moved from Unit Info', 'Updated': today });
  });
  legacy.map(function (c) { return head.indexOf(c) + 1; }).sort(function (a, b) { return b - a; })
    .forEach(function (col) { sh.deleteColumn(col); });
  var notesCol = head.filter(function (h) { return legacy.indexOf(h) < 0; }).indexOf('Notes');
  if (notesCol >= 0 && head.indexOf('Unit Notes') < 0) sh.getRange(1, notesCol + 1).setValue('Unit Notes');
  sh.getRange(1, 1).setNote(unitInfoNote_());
  return 'Unit Info contacts moved to Unit Contacts (' + moved.length + ')';
}

function unitInfoNote_() {
  return 'One row per unit (T910 / C917 / S905). Under Review = Board Restriction (notified of EBoRs, cannot add Unit Board ' +
    'Members). Meeting columns (day, time, frequency, location, address, meeting notes) show on the unit page and the Units page, ' +
    'where the committee and the unit\'s contacts can edit them (Last Updated / Updated By are filled on save). Unit Notes are for ' +
    'committee members only. Contacts live on the Key 3 and Unit Contacts tabs.';
}

function key3Note_(source) {
  return 'Replaced by Admin → Unit contacts: import Key 3' + (source ? ' (last: ' + source + ')' : '') +
    '. Do not edit: add or correct contacts on the Unit Contacts tab (Role "Exclude" hides a wrong Key 3 email).';
}

/**
 * Admin → Unit contacts: import Key 3. Source: a Drive link/ID to the CSV (or a Google Sheet; first tab),
 * or blank = a tab named "Key 3 paste". Shows the changes, then replaces the Key 3 tab (previous kept, hidden).
 */
function menuImportKey3() {
  uncache_('c:units');
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var resp = ui.prompt('Import Key 3',
    'Paste the Drive link of the Key 3 file (CSV, or a Google Sheet: first tab is read).\n' +
    'Leave blank to read a tab named "Key 3 paste".', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var src = String(resp.getResponseText() || '').trim(), rows, label;
  try {
    if (!src) {
      var pt = ss.getSheetByName('Key 3 paste');
      if (!pt) throw new Error('No link given and no "Key 3 paste" tab.');
      rows = pt.getDataRange().getDisplayValues();
      label = '"Key 3 paste" tab';
    } else {
      var id = (/[-\w]{25,}/.exec(src) || [])[0];
      if (!id) throw new Error('That does not look like a Drive link or file ID.');
      var f = DriveApp.getFileById(id);
      label = f.getName();
      if (f.getMimeType() === MimeType.GOOGLE_SHEETS) rows = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getDisplayValues();
      else if (/csv|text|plain/i.test(f.getMimeType()) || /\.csv$/i.test(label)) rows = Utilities.parseCsv(f.getBlob().getDataAsString());
      else throw new Error(label + ' is ' + f.getMimeType() + '. Use the CSV, or open it as a Google Sheet first (File → Save as Google Sheets).');
    }
  } catch (e) { ui.alert(e.message); return; }

  var p = Key3.parse(rows);
  if (p.error) { ui.alert('Key 3 import: ' + p.error); return; }
  var old = key3Rows_();
  // The Unit Leader's address is not in Council's export: carry it forward for a unit whose leader's name is unchanged.
  var carried = Key3.carryForward(old, p.rows);
  p.rows = carried.rows;
  var d = Key3.diff(old, p.rows);
  var skipped = Object.keys(p.skipped).filter(function (k) { return p.skipped[k]; })
    .map(function (k) { return k + ': ' + p.skipped[k]; }).join(', ');
  var list = function (xs) { return xs.slice(0, 12).join('\n') + (xs.length > 12 ? '\n… ' + (xs.length - 12) + ' more' : ''); };
  var msg = p.rows.length + ' contacts from ' + label + (skipped ? ' (skipped ' + skipped + ')' : '') + '.\n\n' +
    'Added: ' + d.added.length + (d.added.length ? '\n' + list(d.added) : '') + '\n\n' +
    'Removed: ' + d.removed.length + (d.removed.length ? '\n' + list(d.removed) : '') + '\n\n' +
    'Unit Leader addresses carried over: ' + carried.carried + '\n\nReplace the Key 3 tab?';
  if (ui.alert('Import Key 3', msg, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  withLock_(function () {
    var sh = ss.getSheetByName(KEY3_TAB) || ss.insertSheet(KEY3_TAB);
    var prev = ss.getSheetByName(KEY3_PREV_TAB);
    if (prev) ss.deleteSheet(prev);
    if (sh.getLastRow() > 1) { prev = sh.copyTo(ss).setName(KEY3_PREV_TAB); prev.hideSheet(); }
    sh.clear();
    var out = [KEY3_HEADERS].concat(p.rows.map(function (r) { return [r.unit, r.role, r.position, r.name, r.email, r.phone, r.address || '', r.city || '', r.state || '', r.zip || '']; }));
    sh.getRange(1, 1, out.length, KEY3_HEADERS.length).setValues(out);
    sh.getRange(2, 7, Math.max(1, out.length - 1), 4).setNumberFormat('@');   // the address columns are text (zip codes)
    sh.getRange(1, 1, 1, KEY3_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1).setNote(key3Note_(label + ', ' + Intake.shortDate(new Date())));
    protectKey3_(sh);
  });
  var noContact = unitsWithoutContacts_();
  ui.alert('Key 3 replaced (' + p.rows.length + ' contacts). The previous import is kept on the hidden "' + KEY3_PREV_TAB + '" tab.' +
    (noContact.length ? '\n\nUnits with a Scout on the tracking tab but no contact: ' + noContact.join(', ') : ''));
}

function protectKey3_(sh) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (pr) { pr.remove(); });
  sh.protect().setDescription('Replaced by Admin → Unit contacts: import Key 3').setWarningOnly(true);
}

/** Units of Scouts on the tracking tab with no contact at all. */
function unitsWithoutContacts_() {
  try {
    var units = units_();
    var seen = {};
    Records.all(['scout_name', 'unit']).forEach(function (r) {
      if (!String(r.scout_name).trim()) return;
      var c = Units.primary(r.unit);
      if (!c || seen[c] !== undefined) return;
      var u = Units.find(units, r.unit);
      seen[c] = !!(u && u.contacts.length);
    });
    return Object.keys(seen).filter(function (c) { return !seen[c]; }).map(Units.label);
  } catch (e) { return []; }
}

/** New Unit Contacts tab on a dev/staging sheet: fake contacts matching the fake schedule. */
function seedUnitContacts_(sh) {
  sh.getRange(1, 1).setNote('One row per contact, from anywhere but the Key 3 (EBoR Coordinator, Advancement Chair, Other…). ' +
    'Role "Exclude" + Email hides that address (for the Unit, or every unit if Unit is blank), e.g. a stale Key 3 email.');
  if (!SheetKind.isNonProduction(SpreadsheetApp.getActive().getName())) return;
  var d = Intake.shortDate(new Date());
  var base = '';
  try { base = getSettings_().testRecipient || ''; } catch (e) {}
  sh.getRange(2, 1, 4, 7).setValues([
    ['T910', 'Unit Leader', 'SM Fake', Anonymize.testEmail(base, 'SM_T910'), '', 'fake', d],
    ['T910', 'EBoR Coordinator', 'EBC Fake', Anonymize.testEmail(base, 'EBC_T910'), '', 'fake', d],
    ['C917', 'Unit Leader', 'Advisor Fake', Anonymize.testEmail(base, 'Adv_C917'), '', 'fake', d],
    ['T996', 'Unit Leader', 'SM996 Fake', Anonymize.testEmail(base, 'SM_T996'), '', 'fake', d]]);
}
