/**
 * Committee menu in the tracking sheet. Committee actions (Intake OK, book
 * on behalf, resend link) arrive in M5; for now: admin/setup tools.
 */
function onOpen() {
  try { refreshActionDropdowns_(); } catch (e) { /* view-only users, or no Action column yet */ }
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Eagle Tracker')
    .addItem('Intake OK (selected Scout)', 'menuIntakeOk')
    .addItem('Resend booking link (selected Scout)', 'menuResendBookingLink')
    .addItem('Book a slot for selected Scout…', 'menuBookOnBehalf')
    .addItem('Cancel booking for selected Scout', 'menuCancelBooking')
    .addItem('Sync invites with the schedule now', 'menuSyncInvites')
    .addSeparator()
    .addSubMenu(ui.createMenu('Intake Queue')
      .addItem('Promote selected row', 'menuPromoteQueueRow')
      .addItem('Mark selected row as spam', 'menuMarkQueueSpam')
      .addSeparator()
      .addItem('Purge old unconfirmed submissions', 'menuPurgeIntake'))
    .addSubMenu(ui.createMenu('Admin')
      .addItem('Setup / repair tabs', 'menuSetup')
      .addItem('Self-check', 'menuSelfCheck')
      .addItem('Name new columns', 'menuNameNewColumns')
      .addItem('Send test email', 'menuSendTestEmail')
      .addItem('Templates: create Doc / add missing tabs', 'menuTemplatesDoc')
      .addItem('Templates: number the tabs (2.3.a …)', 'menuNumberTemplateTabs')
      .addItem('Templates: rebuild catalog (map of every email)', 'menuTemplatesCatalog')
      .addSeparator()
      .addItem('Migration: dry run', 'menuMigrateDryRun')
      .addItem('Migration: apply + set up', 'menuMigrateApply')
      .addSeparator()
      .addItem('Make fake schedule sheet', 'menuMakeFakeSchedule')
      .addItem('Schedule: key new slots', 'menuKeySlots')
      .addItem('Schedule: check against the tracking sheet', 'menuScheduleCheck')
      .addSeparator()
      .addItem('Install sheet triggers (Action, Latest Note, digest)', 'menuInstallTriggers')
      .addItem('Digest: send now', 'menuSendDigestNow')
      .addSeparator()
      .addItem('Folders: match to Scouts (report)', 'menuFolderReport')
      .addItem('Folders: apply report (rename + link)', 'menuFolderApply')
      .addItem('Folders: create for Scouts without an EBoR date (staging/dev)', 'menuCreateMissingFolders')
      .addItem('Folders: make mock folders like production (staging/dev)', 'menuMakeMockFolders')
      .addItem('Folders: place by stage (202x / EBoR year / Exceptions)…', 'menuPlaceFolders')
      .addItem('Anonymize this STAGING sheet (fake Scouts)…', 'menuAnonymizeStaging')
      .addItem('Logs: start a Life to Eagle Log for every Scout', 'menuStartLogs')
      .addItem('New files: flag selected rows (waiting on the committee)', 'menuFlagPending')
      .addItem('Sort EBoR Booked by EBoR date', 'menuSortEborBooked')
      .addItem('Council applications: file new Formsite emails now', 'menuCouncilApps')
      .addItem('Council applications: fetch linked files (earlier emails)', 'menuCouncilFetchLinks')
      .addSeparator()
      .addItem('Unit contacts: import Key 3', 'menuImportKey3'))
    .addToUi();
}

/** Guard for menu items on staging/production: must run as the Council account. Alerts and returns false otherwise. */
function councilAccountOk_() {
  var email = '';
  try { email = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var p = SheetKind.accountProblem(SpreadsheetApp.getActive().getName(), email, getSettings_().councilDomain);
  if (p) { SpreadsheetApp.getUi().alert(p); return false; }
  return true;
}

function menuSetup() {
  if (!councilAccountOk_()) return;
  SpreadsheetApp.getUi().alert(setupRunText_());
}

/** Setup / repair tabs (the menu item and Admin → System). -> what it did, as text */
function setupRunText_() {
  var created = setupTabs_();
  try { if (getSettings_().scheduleSheetId && ensureScheduleColumn_('reserved', 'Reserved')) created.push('Schedule column "Reserved"'); }
  catch (e) { created.push('(Schedule column "Reserved" NOT added: ' + e.message + ')'); }
  uncache_(['c:settings', 'c:committee', 'c:units']);
  return created.length ? 'Created: ' + created.join(', ') : 'All tabs already exist.';
}

function menuSelfCheck() {
  SpreadsheetApp.getUi().alert(selfCheckLines_().join('\n\n'));
}

/** The Self-check report lines (the menu item and Admin → System). */
function selfCheckLines_() {
  var s = getSettings_();
  var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var acct = SheetKind.accountProblem(SpreadsheetApp.getActive().getName(), who, s.councilDomain);
  var lines = ['Running as: ' + (who || 'unknown') + (acct ? '  ⚠ NOT the Council account: menu items are blocked here.' : ''),
    'Sheet code: API ' + API_VERSION + '. The landing page shows the web app\'s API version; if they differ, run npm run deploy:api.',
    'Test mode: ' + (s.testMode !== false ? 'ON (mail → ' + (s.testRecipient || 'NOBODY') + ')' : 'OFF (live mail!)')];
  try {
    var probs = Records.selfCheck();
    lines.push(probs.length ? 'Problems:\n- ' + probs.join('\n- ') : 'Tracking tab structure OK.');
  } catch (e) {
    lines.push('Error: ' + e.message);
  }
  try {   // email-first: only the Scout's own address signs in (Settings parentsSignIn)
    var noEmail = Records.all(['scout_name', 'scout_email']).filter(function (r) {
      return String(r.scout_name || '').trim() && !String(r.scout_email || '').trim() && UNIT_PIPELINE_SECTIONS_.indexOf(r.section) >= 0;
    }).map(function (r) { return String(r.scout_name).trim(); });
    lines.push('Scouts in progress with no Scout email (can\'t sign in' + (s.parentsSignIn === true ? '' : '; parents don\'t sign in') + '): ' +
      (noEmail.length ? noEmail.length + ' (' + noEmail.slice(0, 8).join(', ') + (noEmail.length > 8 ? ', …' : '') + ')' : 'none'));
  } catch (e) { lines.push('Scout email check: ' + e.message); }
  try {   // an adult is copied on every email (2026-11-08): rows with no parent/guardian email of their own
    var noParent = Records.all(['scout_name', 'scout_email', 'parent_email']).filter(function (r) {
      return String(r.scout_name || '').trim() && UNIT_PIPELINE_SECTIONS_.indexOf(r.section) >= 0 && Intake.needsParent(r);
    }).map(function (r) { return String(r.scout_name).trim(); });
    lines.push('Scouts in progress with no parent/guardian email (the committee group is copied instead; their page asks for one): ' +
      (noParent.length ? noParent.length + ' (' + noParent.slice(0, 8).join(', ') + (noParent.length > 8 ? ', …' : '') + ')' : 'none'));
  } catch (e) { lines.push('Parent email check: ' + e.message); }
  lines.push('Schedule sheet: ' + (s.scheduleSheetId ? 'set' : 'not set'));
  if (s.scheduleSheetId) {
    try {
      var sch = readSchedule_();
      var att = CommitteeSchedule.attention(sch.rows, Date.now(), s);
      lines.push('Reserved column: ' + (sch.map.reserved !== undefined ? 'present' : 'not yet (added by Setup / repair or the first reserved slot)') +
        '. Sessions with no committee member (next 30 days): ' + att.unstaffed.length + (att.unstaffed.length ? ' (not bookable until one signs up)' : '') +
        '. Reserved, no Scout yet (next 14 days): ' + att.reserved.length + '.');
    } catch (e) { lines.push('Schedule check: ' + e.message); }
  }
  var ob = Booking.parseOnline(s.onlineBooking);
  lines.push('Shadow (committee records only, no invites/emails): ' + (Booking.BOOKABLE.filter(function (t) { return Booking.isShadowType(t, s); }).map(Booking.label).join(', ') || 'none'));
  lines.push('Booked online: ' + (ob.codes.length ? ob.codes.map(Booking.label).join(', ') : 'nothing') +
    '. Others are scheduled the usual way (Settings → onlineBooking).' + (ob.error ? ' PROBLEM: ' + ob.error : ''));
  ['intakeFolderId', 'scoutsFolderId'].forEach(function (k) {
    if (!s[k]) { lines.push(k + ': NOT SET (run Setup / repair tabs)'); return; }
    try { lines.push(k + ': ' + DriveApp.getFolderById(s[k]).getName()); }
    catch (e) { lines.push(k + ': cannot open folder ' + s[k]); }
  });
  lines.push('webOrigin: ' + (s.webOrigin || 'NOT SET (links in emails will fail)'));
  try { lines.push(digestStatus_()); } catch (e) { lines.push('Digest: ' + e.message); }
  try { lines.push(templatesStatus_()); } catch (e) { lines.push('Email templates: ' + e.message); }
  lines.push('Sheet edit trigger: ' + (editTriggerInstalled_() ? 'installed' : 'NOT installed (Admin → Install sheet triggers)'));
  try {
    var cols = Records.columns();
    lines.push('Action column: ' + (cols.indexOf('action') >= 0 ? 'yes' : 'no (add a column labelled "Action", then Name new columns)'));
    lines.push('Notes column: ' + (cols.indexOf('notes') >= 0 ? 'yes (links to each Scout\'s Life to Eagle Log)' : 'MISSING'));
    lines.push('New files waiting (amber Action cells): ' + (cols.indexOf(Pending.COLUMN) >= 0 ? pendingWaiting_().length + ' Scout(s)'
      : 'NO ' + Pending.COLUMN + ' column (run Setup / repair tabs)'));
    var sc = stageColumns_();
    lines.push('Row actions: ' + Object.keys(sc).map(function (r) { return StageActions.COLUMNS[r].label + ' = ' + (sc[r] || 'NOT FOUND'); }).join('; ') +
      ' (Settings → appSubmittedColumn / appVerifiedColumn / eborEmailedColumn to override)');
    var ad = approvedDateColumn_();
    lines.push('Review page: Approved Date column ' + (ad || 'NOT FOUND (Settings → approvedDateColumn)') +
      '; Proposal Review date/who ' + [s.proposalReviewDateColumn, s.proposalReviewWhoColumn].map(function (c) { return cols.indexOf(c) >= 0 ? c : c + ' MISSING'; }).join(', '));
    try {
      var ur = units_().filter(function (u) { return u.underReview; }).map(function (u) { return u.unit; });
      var badUnits = readTabOrEmpty_(UNIT_INFO_TAB).filter(function (r) { return String(r['Unit'] || '').trim() && !Units.code(r['Unit']); }).map(function (r) { return r['Unit']; });
      // Key 3: which titles count (Unit Leader / Committee Chair) and which are ignored, with counts (no names).
      var k3 = readTabOrEmpty_(KEY3_TAB), seen = {}, ignored = {}, badUnit = 0;
      k3.forEach(function (r) {
        var t = String(r['Role'] || r['Position'] || '').trim() || '(blank)';
        if (!Units.code(r['Unit'])) badUnit++;
        var k = Units.key3Role(r['Role'], r['Position']);
        if (k) seen[k + ' ← ' + t] = (seen[k + ' ← ' + t] || 0) + 1; else ignored[t] = (ignored[t] || 0) + 1;
      });
      var fmt = function (o) { return Object.keys(o).sort().map(function (k) { return k + ' (' + o[k] + ')'; }).join(', ') || 'none'; };
      lines.push('Key 3 (' + k3.length + ' rows): used ' + fmt(seen) + '. Ignored ' + fmt(ignored) + (badUnit ? '. Unit not understood: ' + badUnit + ' row(s)' : '') + '.');
      lines.push('Units under review (Unit Info → Under Review): ' + (ur.length ? ur.join(', ') : 'none') +
        (badUnits.length ? '. Unit names not understood: ' + badUnits.join(', ') + ' (write them like T945 or Troop 945)' : ''));
    } catch (x) { lines.push('Units: could not read (' + x.message + ')'); }
    var missing = ['councilEaglesEmail', 'committeeGroupEmail', 'adminEmail', 'councilDomain'].filter(function (k) { return !String(s[k] || '').trim(); });
    if (missing.length) lines.push('Settings to fill in: ' + missing.join(', ') + ' (addresses and the Council domain live only on the Settings tab).');
    lines.push('Hidden link columns (_folder_id, _log_id): ' +
      (cols.indexOf('_folder_id') >= 0 && cols.indexOf('_log_id') >= 0 ? 'yes' : 'NO (run Setup / repair tabs)'));
  } catch (e) {}
  return lines;
}

/**
 * After adding a column to the tracking tab: give it a hidden machine name
 * (from its visible header and group header). Existing names never change,
 * so renaming visible headers is always safe.
 */
function menuNameNewColumns() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var sh = getTrackingSheet_();
  var lastCol = sh.getLastColumn();
  var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), lastCol).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) { ui.alert('No machine header row yet. Run the migration first.'); return; }
  var groupRow = m.row > 0 ? top[m.row - 1] : [];
  var labelRow = top[m.row + 1] || [];
  var res = SheetModel.fillMissingNames(top[m.row], groupRow, labelRow);
  if (!res.added.length) { ui.alert('Every labelled column already has a machine name.'); return; }
  var list = res.added.map(function (a) {
    return SheetModel.colLetter(a.col) + ': ' + a.name + '   ("' + labelRow[a.col] + '")';
  }).join('\n');
  if (ui.alert('Add these machine names?', list, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  withLock_(function () {
    sh.getRange(m.row + 1, 1, 1, res.row.length).setValues([res.row]);
  });
  ui.alert('Done. Tell Claude/the code which name to use for each new column.');
}
