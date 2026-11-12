/**
 * Creates the helper tabs the scripts need. Safe to run repeatedly:
 * existing tabs are left alone.
 *
 *  Settings      visible   key/values + section map (lib/settingsModel.js)
 *  Intake Queue  visible   every submission lands here first (M3); _ columns hidden
 *  Uploads Log   visible   one row per file received (M3/M7)
 *  _Sessions     hidden    hashed session tokens (M2); never shown to committee
 *  Activity      visible   one row per Life to Eagle Log line; feeds the digest (digest.js)
 *  Digest Log    visible   one row per scheduled digest: sent / no changes / error
 *  Closed Archive visible  the January archive of Closed records (adminActions.js / closingActions.js)
 */
var TAB_HEADERS_ = {
  'Intake Queue': ['Submitted', 'Queue ID', 'Status', 'Path', 'Eagle Candidate', 'Preferred Name', 'Unit', 'Birth Date',
    'Scout Email', 'Scout Phone', 'BSA ID', 'Parent/Guardian Email', 'Eagle Proj', 'Beneficiary',
    'Project Address', 'Project Coach', 'Est. Fundraising', 'Files', 'Record ID', 'Confirmed', 'Note', 'Action',
    '_confirm_hash', '_confirm_expires'],
  'Uploads Log': ['Received', 'Record ID', 'Queue ID', 'File type', 'Version', 'Stored name', 'Drive file ID', 'Bytes',
    'Original name'],
  'Committee': ['Name', 'Initials', 'Email', 'Active'],
  'Unit Info': ['Unit', 'Under Review', 'Lien Doan', 'Meeting Location', 'Meeting Day', 'Meeting Time', 'Unit Notes',
  'Meeting Frequency', 'Meeting Address', 'Meeting Notes', 'Eagles to Date', 'Last Updated', 'Updated By'],
  'Unit Contacts': ['Unit', 'Role', 'Name', 'Email', 'Phone', 'Note', 'Updated', 'Updated By'],
  'Key 3': ['Unit', 'Role', 'Position', 'Name', 'Email', 'Phone', 'Leader Address', 'Leader City', 'Leader State', 'Leader Zip'],
  'Activity': ['When', 'Scout', 'Unit', 'Record ID', 'Entry', 'By'],
  'Outbox': ['Id', 'Created', 'Created by', 'Record ID', 'Scout', 'Template', 'Status', 'To', 'Cc', 'Subject', 'Html', 'Text', 'Done', 'Done by', 'Note', 'Attachments', 'On sent', 'Event at', 'Send at', 'Scheduled by'],
  'Digest Log': ['Ran at', 'Slot', 'Covers since', 'Changes', 'To', 'Result'],
  'Stats History': ['Year', 'Total Eagles', 'Female Eagles', 'Avg Age', 'Min Age', 'Max Age', 'Projects Approved',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Note', 'Closed', 'Closed Reasons'],
  // January archive of Closed records (lib/closing.js ARCHIVE_HEADERS; test/gas-load.test.js keeps the two in step). No contact details.
  'Closed Archive': ['Record ID', 'Scout', 'Unit', 'Closed', 'Reason', 'Note', 'Closed by', 'Stage before closing',
    'Proposal approved', 'EBoR date', 'Folder', 'Archived on'],
  'Council Applications': ['Received', 'Ref', 'Name on form', 'Unit on form', 'Match', 'Scout', 'Record ID', 'How', 'Files', 'Not attached', 'Folder', 'Email', 'Checked', 'Stage'],
  'Unit Requests': ['Id', 'Submitted', 'Unit', 'From', 'Scout', 'Record ID', 'Date', 'Time', 'Place', 'Note', 'Status', 'Done', 'Done by'],
  '_Sessions': ['Token hash', 'Email', 'Record IDs', 'Created', 'Expires', 'Last seen']
};

function setupTabs_() {
  var ss = SpreadsheetApp.getActive();
  var created = [];
  if (ensureSettingsTab_()) created.push('Settings');
  try { var mu = migrateLegacyUnitInfo_(); if (mu) created.push(mu); } catch (e) { created.push('Unit Info migration skipped: ' + e.message); }
  // 2026-11-10: the January archive tab was first called "Closed Records"; rename it once (never two tabs).
  var oldClosed = ss.getSheetByName('Closed Records');
  if (oldClosed && !ss.getSheetByName('Closed Archive')) {
    oldClosed.setName('Closed Archive');
    oldClosed.getRange(1, 1).setNote(closedArchiveNote_());
    created.push('Closed Records tab renamed to Closed Archive');
  }
  Object.keys(TAB_HEADERS_).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var h = TAB_HEADERS_[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (name.charAt(0) === '_') sh.hideSheet();
      if (name === 'Committee') seedCommittee_(sh);
      if (name === 'Unit Info') seedUnitInfo_(sh);
      if (name === 'Unit Contacts') seedUnitContacts_(sh);
      if (name === 'Stats History') seedStatsHistory_(sh);
      if (name === 'Closed Archive') {
        sh.getRange(1, 1).setNote(closedArchiveNote_());
        sh.setColumnWidth(6, 260);
      }
      if (name === 'Key 3') { sh.getRange(1, 1).setNote(key3Note_('')); protectKey3_(sh); }
      created.push(name);
    } else {
      // Repair: add headers introduced by later milestones at the right end.
      // Case and extra spaces don't count ("Last updated" typed by hand = "Last Updated"): no duplicate columns.
      var norm = function (x) { return String(x).trim().toLowerCase().replace(/\s+/g, ' '); };
      var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm);
      var missing = h.filter(function (x) { return have.indexOf(norm(x)) < 0; });
      // None of the expected headers in row 1 but the tab has data: the header row is somewhere else (2026-10-28:
      // Unit Info had a summary row above its headers, and repair appended a second header set at I1:O1).
      // Report it instead of adding columns.
      if (missing.length && missing.length === h.length && sh.getLastRow() > 1) {
        created.push(name + ': NOT repaired. None of its headers (' + h.slice(0, 3).join(', ') + ' …) are in row 1. ' +
          'Row 1 must be the header row: move any summary row below it.');
        missing = [];
      }
      if (missing.length) {
        var start = sh.getLastColumn() + 1;
        sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
        created.push(name + ' columns: ' + missing.join(', '));
        if (name === 'Committee' && missing.indexOf('Active') >= 0 && sh.getLastRow() > 1) {
          // Everyone listed so far is active; untick the occasional helpers. A new row left blank counts as active.
          var act = sh.getRange(2, start + missing.indexOf('Active'), sh.getLastRow() - 1, 1);
          act.insertCheckboxes();
          act.setValues(act.getValues().map(function () { return [true]; }));
          sh.getRange(1, start + missing.indexOf('Active')).setNote('Ticked (or blank) = active member. Unticked = occasional helper: ' +
            'can still be put on a slot (gets the invitation) and can sign in, but is listed under "Occasional" on the committee page.');
        }
        if (name === 'Unit Info' && missing.indexOf('Lien Doan') >= 0 && sh.getMaxRows() > 2) {
          sh.getRange(3, start + missing.indexOf('Lien Doan'), sh.getMaxRows() - 2, 1).insertCheckboxes();
        }
      }
    }
    // Columns whose header starts with "_" are for the script only.
    var all = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    all.forEach(function (x, i) { if (String(x).charAt(0) === '_') sh.hideColumns(i + 1); });
  });
  highlightQueueStatuses_();
  try { queueActionDropdown_(); } catch (e) { created.push('Intake Queue Action dropdown skipped: ' + e.message); }
  try { var dk = ensureSettingKeys_(Object.keys(SettingsModel.DEFAULT_VALUES)); if (dk.length) created.push('Settings: ' + dk.join(', ')); }
  catch (e) { created.push('Digest settings skipped: ' + e.message); }
  try { if (copyFormTemplatesKey_()) created.push('Settings: formTemplatesFolderId copied from stampsFolderId'); }
  catch (e) { created.push('Form Templates setting skipped: ' + e.message); }
  try { var blankUc = withLock_(function () { return removeBlankUnitContacts_(); }); if (blankUc) created.push('Unit Contacts: removed ' + blankUc + ' empty row(s) (unit only)'); }
  catch (e) { created.push('Unit Contacts cleanup skipped: ' + e.message); }
  try { if (withLock_(function () { return sortUnitContacts_(); })) created.push('Unit Contacts sorted by unit'); }
  catch (e) { created.push('Unit Contacts sort skipped: ' + e.message); }
  try { if (sortSettingsKeys_()) created.push('Settings sorted A → Z'); }
  catch (e) { created.push('Settings sort skipped: ' + e.message); }
  try { var ns = ensureSettingsSections_(); if (ns.length) created.push('Settings sections: ' + ns.join(', ')); }
  catch (e) { created.push('Settings sections skipped: ' + e.message); }
  try { var sr = ensureSectionRows_(); if (sr.length) created.push('section rows: ' + sr.join(', ')); }
  catch (e) { created.push('Section rows skipped: ' + e.message); }
  try { if (ensureParentEmailColumn_()) created.push('Parent/Guardian Email column'); }
  catch (e) { created.push('Parent/Guardian Email column skipped: ' + e.message); }
  try { if (ensureTrackingColumn_('preferred_name', 'Preferred Name', ['parent_email', 'scout_email', 'scout_phone'])) created.push('Preferred Name column'); }
  catch (e) { created.push('Preferred Name column skipped: ' + e.message); }
  try {
    if (Records.columns().indexOf(ProposalOutcome.SIGNING_COLUMN) < 0 &&
        ensureTrackingColumn_(ProposalOutcome.SIGNING_COLUMN, ProposalOutcome.SIGNING_LABEL, [approvedDateColumn_(), 'approved_date', 'notes'].filter(String))) {
      created.push(ProposalOutcome.SIGNING_LABEL + ' column');
    }
    Records.invalidate();
  }
  catch (e) { created.push(ProposalOutcome.SIGNING_LABEL + ' column skipped: ' + e.message); }
  try { var sh2 = syncSectionHeaders_(); if (sh2.length) created.push('section names: ' + sh2.join(', ')); }
  catch (e) { created.push('Section names skipped: ' + e.message); }
  try { var hc = ensureHiddenColumns_(); if (hc.length) created.push('hidden columns: ' + hc.join(', ')); }
  catch (e) { created.push('Hidden columns skipped: ' + e.message); }
  try { if (ensurePendingFormat_()) created.push('new-files colour (Action column)'); } catch (e) { created.push('New-files colour skipped: ' + e.message); }
  try { if (refreshActionDropdowns_()) created.push('Action dropdowns'); } catch (e) { created.push('Action dropdown skipped: ' + e.message); }
  try { protectHidden_(); } catch (e) { created.push('Protection skipped: ' + e.message); }
  if (ensureHelpTab_()) created.push('Help (placeholder)');
  var folders = ensureIntakeFolders_();
  if (folders.length) created.push('folders: ' + folders.join(', '));
  if (!PropertiesService.getScriptProperties().getProperty('HASH_SALT')) {
    PropertiesService.getScriptProperties().setProperty('HASH_SALT', Utilities.getUuid() + Utilities.getUuid());
    created.push('(script property HASH_SALT)');
  }
  return created;
}

/**
 * Action column (machine name `action`): a dropdown of section labels, set
 * PER ROW with the row's current section marked ("● Something missing (here
 * now)") so the next step is the item just below. Re-run after rows move
 * (script moves, sheet open, and hand drags via onTrackingChange).
 * Returns false if the column doesn't exist yet.
 */
function refreshActionDropdowns_() {
  var sh = getTrackingSheet_();
  var lastRow = sh.getLastRow();
  var top = sh.getRange(1, 1, Math.min(15, lastRow), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m || m.map.action === undefined) return false;
  var settings = getSettings_();
  var keys = sh.getRange(1, m.keyCol + 1, lastRow, 1).getValues().map(function (r) { return r[0]; });
  var cache = {};
  function ruleFor(current) {
    var k = current || '';
    if (!cache[k]) {
      var opts = SettingsModel.actionOptionsFor(settings, current);
      if (SettingsModel.offersStatusEmail(current)) opts = opts.concat([SettingsModel.RESEND_LINK]);
      if (current) opts = opts.concat([SettingsModel.CHECKED]);   // clears "new files waiting" (amber) without a move
      cache[k] = SpreadsheetApp.newDataValidation()
        .requireValueInList(opts, true)
        .setAllowInvalid(false)
        .setHelpText('Pick a section to move this Scout there. ● marks where the row is now; the cell clears itself. Amber = new files from the Scout nobody has checked yet.')
        .build();
    }
    return cache[k];
  }
  var sectionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SettingsModel.sectionActionOptions(), true)
    .setAllowInvalid(false)
    .setHelpText('Tools for this section. The cell clears itself.')
    .build();
  var first = m.row + 3;                                  // below the visible label row (1-based)
  if (lastRow >= first) {
    var rules = [];
    for (var r = first - 1; r < lastRow; r++) {
      rules.push([SheetModel.isRecordId(keys[r]) ? ruleFor(SheetModel.sectionForRow(keys, r))
        : SheetModel.isSectionKey(keys[r]) ? sectionRule : ruleFor(null)]);
    }
    sh.getRange(first, m.map.action + 1, rules.length, 1).setDataValidations(rules);
  }
  var rest = sh.getMaxRows() - Math.max(lastRow, first - 1);
  if (rest > 0) sh.getRange(Math.max(lastRow, first - 1) + 1, m.map.action + 1, rest, 1).setDataValidation(ruleFor(null));
  return true;
}

/**
 * Parent/Guardian Email (machine name parent_email): parents are copied on
 * every Scout email and invite. Production never had the column (it was added
 * by hand on the Test Copy), so add it right after Scout Email if missing.
 * Returns true if added.
 */
/** A tracking column by machine name, inserted after the first of afterNames found (copies that column's format). */
function ensureTrackingColumn_(name, label, afterNames) {
  var sh = getTrackingSheet_();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) return false;
  var after = SheetModel.insertAfterFor(top[m.row], name, afterNames);
  if (after < 0) return false;
  sh.insertColumnAfter(after + 1);
  sh.getRange(m.row + 1, after + 2).setValue(name);       // hidden machine row
  sh.getRange(m.row + 2, after + 2).setValue(label);      // visible label row
  return true;
}

/** A header on a log tab (e.g. the Intake Queue's Preferred Name) before a row that needs it is written. */
function ensureTabColumn_(tab, header) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sh) return;
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  if (have.indexOf(header) < 0) sh.getRange(1, have.filter(String).length + 1).setValue(header).setFontWeight('bold');
}

function ensureParentEmailColumn_() {
  var sh = getTrackingSheet_();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) return false;
  var after = SheetModel.insertAfterFor(top[m.row], 'parent_email', ['scout_email', 'scout_phone', 'scout_name']);
  if (after < 0) return false;
  sh.insertColumnAfter(after + 1);                       // 1-based; copies the left column's formatting
  var col = after + 2;
  sh.getRange(m.row + 1, col).setValue('parent_email');   // hidden machine row
  sh.getRange(m.row + 2, col).setValue('Parent/Guardian Email');   // visible label row
  return true;
}

/**
 * Section header rows show the Settings label (column E): rename in Settings, run Setup, the tab follows.
 * The text sits in the Eagle Candidate column (or, if that is empty, the first filled cell after Action).
 * Returns the labels written.
 */
function syncSectionHeaders_() {
  var sh = getTrackingSheet_();
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var top = sh.getRange(1, 1, Math.min(15, lastRow), lastCol).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) return [];
  var keys = sh.getRange(1, m.keyCol + 1, lastRow, 1).getValues().map(function (r) { return r[0]; });
  var rows = SheetModel.sectionRows(keys);
  var labelCol = m.map.scout_name !== undefined ? m.map.scout_name : m.keyCol + 1;
  var done = [];
  getSettings_().sections.forEach(function (sec) {
    var r = rows[sec.key];
    if (r === undefined || !sec.label) return;
    var vals = sh.getRange(r + 1, 1, 1, lastCol).getValues()[0];
    var c = labelCol;
    if (!String(vals[c]).trim()) {
      for (var i = Math.max(m.keyCol, m.map.action === undefined ? m.keyCol : m.map.action) + 1; i < vals.length; i++) {
        if (String(vals[i]).trim()) { c = i; break; }
      }
    }
    if (String(vals[c]).trim() !== sec.label) { sh.getRange(r + 1, c + 1).setValue(sec.label); done.push(sec.label); }
  });
  return done;
}

/**
 * Hidden columns at the far right of the tracking tab, per record:
 *   _folder_id  the Scout's Drive folder (the Scout name cell links to it)
 *   _log_id     the Scout's Life to Eagle Log (the Notes cell links to it)
 *   _cc         "Others to invite" to the EBoR, entered by the Scout/parent
 *   _closed, _close_snooze   Closed records: why/when/from where; "Keep open" snooze (lib/closing.js)
 * They travel with the row when it is dragged or copied to next year's tab.
 */
function ensureHiddenColumns_() {
  var sh = getTrackingSheet_();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) return [];
  var all = ['_folder_id', '_log_id', '_cc', '_pending_since', '_request', '_stage_since', '_closed', '_close_snooze'];
  var want = all.filter(function (n) { return m.map[n] === undefined; });
  if (want.length) {
    var last = sh.getLastColumn();
    sh.insertColumnsAfter(last, want.length);
    sh.getRange(m.row + 1, last + 1, 1, want.length).setValues([want]);
    sh.hideColumns(last + 1, want.length);
    m = SheetModel.findMachineRow(sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues());
  }
  // Labels go on the visible label row (1-based m.row + 2). Before 10/18 they were written one row
  // lower, into the first data row: clear those leftovers ("(folder_id)" etc.) and relabel.
  all.forEach(function (n) {
    var c = m.map[n] + 1, label = '(' + n.slice(1) + ')';
    var below = sh.getRange(m.row + 3, c);
    if (String(below.getValue()) === label) below.clearContent();
    var lab = sh.getRange(m.row + 2, c);
    if (!String(lab.getValue()).trim()) lab.setValue(label);
  });
  return want;
}

/** Best effort: callers never fail because the dropdown couldn't be refreshed. */
function refreshActionDropdownsQuietly_() {
  try {
    CacheService.getScriptCache().put('adv:busy', '1', 20);   // our own change events are ignored
    refreshActionDropdowns_();
  } catch (e) { console.warn('Action dropdown refresh: ' + e); }
}

/** Warning-only protection on the hidden key column and machine row (editors get an "are you sure?"). */
function protectHidden_() {
  var DESC = 'Eagle Tracker: hidden keys (scripts need these)';   // old column-A protection had the same description: removed below
  var sh = getTrackingSheet_();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === DESC) p.remove();
  });
  // No protections any more (Jim W., 2026-10-20): even the header-row warning fired on every expand/collapse of a
  // column group, which the committee uses constantly. The hidden row and column stay hidden; Self-check reports
  // a damaged header row, and Setup re-keys rows. This function now only removes protections it added earlier.
}

/** Placeholder Help tab for a non-programmer successor; content written closer to a finished POC. */
function ensureHelpTab_() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName('Help')) return false;
  var sh = ss.insertSheet('Help');
  sh.getRange(1, 1, 8, 1).setValues([
    ['Eagle Tracker: Help (placeholder, to be written)'],
    ['What the hidden column (_key) and hidden row are, and why to leave them alone'],
    ['Action column: moving a Scout to another section'],
    ['Latest Note column and the Notes doc'],
    ['Adding schedule slots (Slot Type codes, initials) and committee members'],
    ['Intake Queue: what to do with held or confirmed submissions'],
    ['IF THE SCRIPTS STOP: keep working by hand (edit, insert, drag rows); nothing is lost'],
    ['How to switch the Scout web pages off']
  ]);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 700);
  return true;
}

/** Unit Info tab: one row per unit (Under Review = Board Restriction; meeting info). Fake units on dev/staging. */
/**
 * Add Settings keys introduced later, with their default values, so every
 * setting is visible and editable (a missing key silently uses the default).
 * Text settings are written as plain text so "6 PM" stays text. Existing
 * values are never touched. Returns the keys added.
 */
function ensureSettingKeys_(keys) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  if (!sh) return [];
  var have = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var added = keys.filter(function (k) { return have.indexOf(k) < 0; });
  added.forEach(function (k) {
    setSetting_(k, '');
    var col = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).trim(); });
    var cell = sh.getRange(col.indexOf(k) + 1, 2);
    var def = SettingsModel.DEFAULT_VALUES[k];
    if (typeof def === 'string') cell.setNumberFormat('@').setValue(def);
    else cell.setValue(def);
  });
  clearSettingsCache_();
  return added;
}

/**
 * Settings keys (A:C) in alphabetical order (Jim W., 2026-10-25), so they are easy to look up. Only A:C move: the
 * section table in D:G keeps its rows. Settings are found by key, never by row. Returns true when the order changed.
 */
function sortSettingsKeys_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  if (!sh || sh.getLastRow() < 3) return false;
  var n = sh.getLastRow() - 1;
  var keys = sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var last = 0;
  keys.forEach(function (k, i) { if (k) last = i + 1; });
  if (last < 2) return false;
  var used = keys.slice(0, last);
  var sorted = used.slice().sort(function (a, b) {
    if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
  if (sorted.join('\n') === used.join('\n')) return false;
  sh.getRange(2, 1, last, 3).sort({ column: 1, ascending: true });
  clearSettingsCache_();
  return true;
}

function seedUnitInfo_(sh) {
  sh.getRange(1, 1).setNote(unitInfoNote_());
  sh.getRange(2, 2, sh.getMaxRows() - 1, 2).insertCheckboxes();      // Under Review, Lien Doan
  if (!SheetKind.isNonProduction(SpreadsheetApp.getActive().getName())) return;
  sh.getRange(2, 1, 3, 7).setValues([
    ['T910', false, false, 'Fake Church Hall, Room 2', 'Tuesday', '7:00–8:30 PM', 'fake'],
    ['C917', false, false, 'Fake Community Center', '1st & 3rd Thursday', '7:30 PM', 'fake'],
    ['T996', true, true, 'Fake School Gym', 'Monday', '7:00 PM', 'fake: Board Restriction example']]);
}

/** Add default sections that the Settings tab doesn't list yet (e.g. the EBoR ones), in columns D:G. */
function ensureSettingsSections_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SETTINGS_TAB);
  if (!sh) return [];
  var vals = sh.getRange(1, 4, Math.max(sh.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var have = vals.filter(Boolean);
  var add = SettingsModel.DEFAULT_SECTIONS.filter(function (x) { return have.indexOf(x.key) < 0; });
  if (!add.length) return [];
  var row = vals.length;
  while (row > 1 && !vals[row - 1]) row--;                 // last used row in D
  sh.getRange(row + 1, 4, add.length, 4).setValues(add.map(function (x) { return [x.key, x.label, x.scoutStatus, x.order]; }));
  clearSettingsCache_();
  return add.map(function (x) { return x.key; });
}

/**
 * Insert section label rows the tracking tab lacks (e.g. "Application
 * Verified", "EBoR Scheduled"), in Settings order, formatted like the
 * section row above them.
 */
function ensureSectionRows_() {
  var sh = getTrackingSheet_();
  var settings = getSettings_();
  var added = [];
  settings.sections.forEach(function (sec, i) {
    var lastRow = sh.getLastRow();
    var top = sh.getRange(1, 1, Math.min(15, lastRow), sh.getLastColumn()).getValues();
    var m = SheetModel.findMachineRow(top);
    if (!m) return;
    var keys = sh.getRange(1, m.keyCol + 1, lastRow, 1).getValues().map(function (r) { return r[0]; });
    var rows = SheetModel.sectionRows(keys);
    if (rows[sec.key] !== undefined) return;
    var prev = null;
    for (var j = i - 1; j >= 0 && !prev; j--) if (rows[settings.sections[j].key] !== undefined) prev = settings.sections[j].key;
    var newRow, fmtRow;
    if (prev) {
      var at = SheetModel.insertionRow(keys, prev);         // 0-based: first row after prev's records
      sh.insertRowBefore(at + 1);
      newRow = at + 1; fmtRow = rows[prev] + 1;
    } else {
      // First section in the order (e.g. New Submissions): directly above the TOPMOST section on the tab
      // (not "the next one in Settings order", which may sit anywhere if the orders are stale; 10/19 rehearsal).
      var top = -1;
      Object.keys(rows).forEach(function (k) { if (top < 0 || rows[k] < top) top = rows[k]; });
      if (top < 0) return;
      sh.insertRowBefore(top + 1);
      newRow = top + 1; fmtRow = top + 2;                   // the old top header moved down one
    }
    sh.getRange(fmtRow, 1, 1, sh.getLastColumn()).copyTo(sh.getRange(newRow, 1, 1, sh.getLastColumn()),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    var labelCol = m.map.scout_name !== undefined ? m.map.scout_name : 1;
    sh.getRange(newRow, labelCol + 1).setValue(sec.label);
    sh.getRange(newRow, m.keyCol + 1).setValue('S:' + sec.key);
    added.push(sec.key);
  });
  return added;
}

/**
 * Committee tab: schedule names → emails for Calendar invites (M5). The
 * schedule's member cell must match a Name here. Dev (Test Copy) gets fake
 * members matching the fake schedule.
 */
function seedCommittee_(sh) {
  sh.getRange(1, 1).setNote('Committee members. Use "Initials" in Who / Council-District Rep(s) cells ' +
    '(several allowed: "JW/AB" or "JW, AB"). Invites go to "Email". Scouts see "Name".');
  if (!SheetKind.isNonProduction(SpreadsheetApp.getActive().getName())) return;
  var base = '';
  try { base = getSettings_().testRecipient || ''; } catch (e) {}
  sh.getRange(2, 1, 3, 3).setValues([
    ['Member A', 'MA', Anonymize.testEmail(base, 'Member_A')], ['Member B', 'MB', Anonymize.testEmail(base, 'Member_B')],
    ['Member C', 'MC', Anonymize.testEmail(base, 'Member_C')]]);
}

/**
 * Intake Queue rows that need a committee member stand out:
 * Possible duplicate (amber), Error (red), Confirmed but not promoted (blue).
 * Re-running replaces only these rules.
 */
/** Intake Queue "Action" column: Promote / Mark as spam, handled by the installable edit trigger (runs as cc-advancement). */
function queueActionDropdown_() {
  var sh = Tabs.sheet(QUEUE_TAB);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = head.indexOf('Action');
  if (c < 0 || sh.getMaxRows() < 2) return;
  sh.getRange(2, c + 1, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(QUEUE_ACTIONS, true).setAllowInvalid(false)
    .setHelpText('Promote = add to the tracking tab (folder, files, receipt email). The cell clears itself.').build());
}

function highlightQueueStatuses_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Intake Queue');
  if (!sh) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var c = head.indexOf('Status');
  if (c < 0) return;
  var col = SheetModel.colLetter(c);
  var range = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), sh.getLastColumn());
  var colors = { 'Possible duplicate': '#fde7b0', 'Error': '#f6c6c6', 'Confirmed': '#d6e6fb' };
  var formula = function (status) { return '=$' + col + '2="' + status + '"'; };
  var ours = Object.keys(colors).map(formula);
  var keep = sh.getConditionalFormatRules().filter(function (r) {
    var cond = r.getBooleanCondition();
    return !(cond && ours.indexOf(String(cond.getCriteriaValues()[0])) >= 0);
  });
  Object.keys(colors).forEach(function (status) {
    keep.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula(status))
      .setBackground(colors[status]).setRanges([range]).build());
  });
  sh.setConditionalFormatRules(keep);
}

/**
 * Dev convenience: if Settings has no intake/Scouts folder, create them next
 * to the spreadsheet. Production: set intakeFolderId / scoutsFolderId by hand
 * to the folders in the locked Advancement drive.
 */
function ensureIntakeFolders_() {
  var s = getSettings_();
  var made = [];
  if (s.intakeFolderId && s.scoutsFolderId) return made;
  if (!SheetKind.isNonProduction(SpreadsheetApp.getActive().getName())) {
    // Production: never create folders next to real data. Point at the real ones.
    made.push('NOT created: set intakeFolderId and scoutsFolderId in Settings to the folders in the Advancement drive');
    return made;
  }
  var file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  var parents = file.getParents();
  var home = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  if (!s.intakeFolderId) {
    var q = home.createFolder('_Intake Queue');
    setSetting_('intakeFolderId', q.getId());
    made.push('_Intake Queue');
  }
  if (!s.scoutsFolderId) {
    var sc = home.createFolder('Scout Folders (DEV)');
    setSetting_('scoutsFolderId', sc.getId());
    made.push('Scout Folders (DEV)');
  }
  return made;
}

/** Note on the Closed Archive tab's A1: what fills it, and where the live closed records are. */
function closedArchiveNote_() {
  return 'Filled only by the January archive (Admin page): records closed in a past year. Records closed this year are in ' +
    'the Closed section at the bottom of the tracking tab (dashboard: Exceptions, Show closed). No contact details on purpose: ' +
    'these are minors\' records. The Scout\'s folder (Folder column, in Archive/Closed) holds the paperwork.';
}
