/**
 * One-time migration of a tracking tab to the Option B structure.
 * The plan is computed by lib/migrationPlan.js (pure, unit-tested).
 *
 * Dry run: writes the plan to a "_Migration Report" tab; changes nothing else.
 * Apply:   refuses unless the spreadsheet is non-production (SheetKind: "Test Copy" / "STAGING …") or
 *          Settings → allowProduction is TRUE. Take a version-history
 *          restore point first (File → Version history → Name current version).
 *          Then does the whole cutover setup in one go: migration (incl. the Action column),
 *          Setup / repair tabs, fake schedule (non-production only, if none is set),
 *          sheet triggers, and shows Self-check.
 */
function menuMigrateDryRun() {
  var res = migrate_(false);
  SpreadsheetApp.getUi().alert(res.summary + '\n\nFull report: tab "_Migration Report".');
}

function menuMigrateApply() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var s = getSettings_();
  if (!SheetKind.isNonProduction(ss.getName()) && !s.allowProduction) {
    ui.alert('Refusing: this spreadsheet is not a "Test Copy" or "STAGING" sheet and Settings → allowProduction is not TRUE.');
    return;
  }
  var ok = ui.alert('Apply migration and set up?',
    'On "' + s.trackingTab + '" this adds a hidden _key column, an Action column, a hidden machine header row, ' +
    'section keys, Record IDs and an "' + SettingsModel.sectionLabel(s, 'intake_to_book') + '" section. Then it runs Setup / repair tabs' +
    (SheetKind.isNonProduction(ss.getName()) && !s.scheduleSheetId ? ', makes a fake schedule sheet' : '') +
    ' and installs the sheet triggers (running as you).\n\n' +
    'Name a version first: File → Version history → Name current version.',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var res = migrate_(true);
  if (res.error) { ui.alert(res.summary + '\n\nFull report: tab "_Migration Report".'); return; }
  var steps = [res.summary];
  try {
    var created = setupTabs_();
    steps.push('Setup / repair tabs: ' + (created.length ? created.join(', ') : 'nothing to add'));
  } catch (e) { steps.push('Setup / repair tabs FAILED: ' + e.message + ' (run it from the Admin menu)'); }
  if (SheetKind.isNonProduction(ss.getName()) && !getSettings_().scheduleSheetId) {
    try { setSetting_('scheduleSheetId', makeFakeScheduleSheet_()); steps.push('Fake schedule sheet created.'); }
    catch (e) { steps.push('Fake schedule FAILED: ' + e.message); }
  } else if (!getSettings_().scheduleSheetId) {
    steps.push('Schedule sheet: NOT SET. Set Settings → scheduleSheetId, then Admin → Install sheet triggers again.');
  }
  try { installTriggers_(); steps.push('Sheet triggers installed.'); }
  catch (e) { steps.push('Triggers FAILED: ' + e.message + ' (Admin → Install sheet triggers)'); }
  ui.alert('Migration and setup', steps.join('\n\n') + '\n\nFull report: tab "_Migration Report". Self-check follows.',
    ui.ButtonSet.OK);
  menuSelfCheck();
}

function migrate_(apply) {
  var s = getSettings_();
  var sh = getTrackingSheet_();
  var values = sh.getDataRange().getValues();
  var plan = MigrationPlan.plan(values, s);

  var lines = ['Migration ' + (apply ? 'APPLY' : 'DRY RUN') + ' — ' + new Date().toISOString(),
               'Spreadsheet: ' + SpreadsheetApp.getActive().getName() + ' / tab: ' + s.trackingTab, ''];
  if (plan.error) {
    lines.push('ERROR: ' + plan.error);
    writeReport_(lines);
    return { summary: 'Error: ' + plan.error, error: true };
  }
  lines = lines.concat(plan.report);
  if (plan.warnings.length) lines = lines.concat(['', 'WARNINGS:'], plan.warnings.map(function (w) { return '  ' + w; }));

  if (plan.alreadyMigrated) {
    writeReport_(lines);
    return { summary: plan.report[0] };
  }

  if (apply) {
    withLock_(function () { applyPlan_(sh, plan); });
    lines.push('', 'APPLIED.');
  }
  writeReport_(lines);
  return {
    summary: (apply ? 'Applied. ' : 'Dry run. ') + plan.sectionWrites.length + ' sections, ' +
             plan.recordWrites.length + ' Candidate Records' +
             (plan.insertPreReview ? ', + Pre-Review Call section' : '') +
             (plan.warnings.length ? '\n\n' + plan.warnings.length + ' warning(s):\n- ' + plan.warnings.join('\n- ') : '')
  };
}

/**
 * Order matters: the new column A first (rows unaffected), then key writes by
 * current row index, then row inserts bottom-up (section row before header row).
 */
function applyPlan_(sh, plan) {
  sh.insertColumnBefore(1);             // new hidden _key column = A
  var K = 1;
  // Action column (left of Eagle Candidate). Column inserts don't move rows, so row indexes below still hold.
  if (plan.addAction) {
    var ac = plan.addAction.col + 1;    // 1-based
    sh.insertColumnBefore(ac);
    var label = sh.getRange(plan.labelRow + 1, ac + 1);   // the header cell now right of it (Eagle Candidate)
    label.copyTo(sh.getRange(plan.labelRow + 1, ac), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(plan.labelRow + 1, ac).setValue(plan.addAction.label);
    sh.setColumnWidth(ac, 170);
  }

  plan.sectionWrites.forEach(function (w) { sh.getRange(w.row + 1, K).setValue('S:' + w.key); });
  plan.recordWrites.forEach(function (w) { sh.getRange(w.row + 1, K).setValue(w.id); });

  // New section row (below the header row, so the header row index is unaffected).
  if (plan.insertPreReview) {
    var ip = plan.insertPreReview;
    sh.insertRowBefore(ip.beforeRow + 1);
    var newRow = ip.beforeRow + 1;             // 1-based index of the inserted row
    var fmtSrc = ip.copyFormatFrom + 2;         // label row shifted down by one
    sh.getRange(fmtSrc, 1, 1, sh.getMaxColumns())
      .copyTo(sh.getRange(newRow, 1, 1, sh.getMaxColumns()), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(newRow, ip.labelCol + 1).setValue(ip.text);
    sh.getRange(newRow, K).setValue('S:intake_to_book');
  }

  // Machine header row directly above the visible label row, hidden.
  sh.insertRowBefore(plan.labelRow + 1);
  var names = plan.machineNames;
  sh.getRange(plan.labelRow + 1, 1, 1, names.length).setValues([names])
    .setFontSize(8).setFontColor('#888888').setFontWeight('normal');
  sh.hideRows(plan.labelRow + 1);

  sh.getRange(1, K, sh.getMaxRows(), 1).setFontColor('#888888').setFontWeight('normal');
  sh.hideColumns(K);
}

function writeReport_(lines) {
  var ss = SpreadsheetApp.getActive();
  var name = '_Migration Report';
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, lines.length, 1).setValues(lines.map(function (l) { return [l]; }));
  sh.setColumnWidth(1, 900);
}
