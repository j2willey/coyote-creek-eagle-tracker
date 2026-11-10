/**
 * Installable on-edit trigger for the tracking tab (Admin → Install sheet
 * triggers). Runs as whoever installed it, so it can move rows, send mail
 * and write Docs. A simple onEdit() could not.
 *
 *  - Action column: picking a section label moves the row to the end of that
 *    section, clears the cell, adds a Notes line. Pre-Review Call also emails
 *    the booking link (same as the Intake OK menu item).
 *  - Notes column: a typed note gets today's date and goes to the top of the
 *    Scout's Life to Eagle Log; the cell shows that line, linked to the log.
 *    No date appearing = automation is off (add to the cell, don't replace it).
 *
 * If the trigger is not installed or fails, the sheet still works by hand:
 * the Action value just stays in the cell (a visible sign), notes stay in the cell.
 */
function onTrackingEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    uncacheTab_(sh.getName());                       // Settings / Committee / unit contacts edited by hand
    var s = getSettings_();
    if (sh.getName() === QUEUE_TAB) { if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) handleQueueAction_(e); return; }
    if (sh.getName() !== s.trackingTab) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;   // ignore paste / fill-down
    var top = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
    var m = SheetModel.findMachineRow(top);
    if (!m || e.range.getRow() <= m.row + 2) return;                            // header rows
    var col = e.range.getColumn() - 1;
    if (col === m.map.action) handleActionEdit_(e, sh, m);
    else if (col === m.map.notes) handleNoteEdit_(e, sh, m);
    else if (col === m.map.scout_name) handleNameEdit_(e, sh, m);
    else if (col === m.map.unit) handleUnitEdit_(e, sh, m);
    else if (col === m.map[String(s.eborDateColumn || 'ebor_date')] &&
      SheetModel.sectionForRow(sh.getRange(1, m.keyCol + 1, e.range.getRow(), 1).getValues().map(function (r) { return r[0]; }), e.range.getRow() - 1) === 'ebor_booked') {
      sortEborBooked_();                                 // a member typed an EBoR Date: keep the section in date order
    }
  } catch (err) {
    console.error('onTrackingEdit: ' + (err && err.stack || err));
    try { e.source.toast(err.userMessage || err.message, 'Eagle Tracker problem', 10); } catch (x) {}
  }
}

/** Editor's email, or '' when Apps Script won't say (e.g. an account outside the domain). */
function editor_(e) {
  try { return (e.user && e.user.getEmail && e.user.getEmail()) || ''; } catch (x) { return ''; }
}

function recordAtRow_(sh, m, row) {
  Records.columns();                                     // auto-keys a hand-inserted row
  var id = String(sh.getRange(row, m.keyCol + 1).getValue());
  return SheetModel.isRecordId(id) ? Records.get(id) : null;
}

function handleActionEdit_(e, sh, m) {
  var s = getSettings_();
  var sectionKey = SheetModel.sectionKeyOf(sh.getRange(e.range.getRow(), m.keyCol + 1).getValue());
  if (sectionKey) { handleSectionAction_(e, sh, m, sectionKey); return; }
  if (SettingsModel.isResendLink(e.value)) { handleResendLink_(e, sh, m); return; }
  if (SettingsModel.isChecked(e.value)) { handleChecked_(e, sh, m); return; }
  var target = SettingsModel.sectionForAction(s, e.value);
  if (!target) return;
  var rec = recordAtRow_(sh, m, e.range.getRow());
  e.range.setValue('');                                  // acts like a button
  if (!rec) { e.source.toast('That row has no Scout name.', 'Eagle Tracker', 6); return; }
  var label = SettingsModel.sectionLabel(s, target);
  if (rec.section === target) { e.source.toast(rec.fields.scout_name + ' is already in ' + label + '.', 'Eagle Tracker', 5); return; }

  Records.move(rec.recordId, target);
  var by = editor_(e);
  var line = Intake.shortDate(new Date()) + ' [sheet] Moved from ' + SettingsModel.sectionLabel(s, rec.section) + ' to ' + label + (by ? ' (by ' + by + ')' : '');
  if (clearPending_(rec.recordId)) line += '; new files checked';   // a move is a committee decision (state-model-v3)
  var extra = '';
  var nextType = Booking.onlineType(target, s);          // booking link only for types booked online (Settings → onlineBooking)
  if (nextType) {
    var sent = sendBookingInvite_(rec, nextType, by);
    var queued = sent && sent.queued;
    line += '; ' + Booking.label(nextType) + ' booking link ' + (queued ? 'waiting in the Outbox' : 'sent');
    extra = ' ' + Booking.label(nextType) + ' booking link ' + (queued ? 'is waiting in the Outbox (committee page).' : 'emailed.');
  }
  addRecordNote_(rec.recordId, line);
  try {
    var up = upcomingBooking_(readSchedule_().rows, rec.recordId);
    if (up) extra += ' NOTE: an upcoming ' + Booking.label(up.type) + ' is still booked (cancel it from the menu if needed).';
  } catch (x) {}
  e.source.toast(rec.fields.scout_name + ' → ' + label + '.' + extra, 'Eagle Tracker', 8);
}

/**
 * "✉ Email status + page link" in a Scout row's Action cell (runs as the trigger owner). To Book stage booked
 * online → the booking email; otherwise a status email (status line + any upcoming booking). Both link to /signin.
 */
/** Status + page link (or, for an online To Book stage with nothing booked, the "Book: …" email). -> {res, what} */
function statusOrBookingEmail_(rec, by, statusOnly) {
  var s = getSettings_();
  var type = Booking.onlineType(rec.section, s);
  var cur = null;
  try { cur = upcomingBooking_(readSchedule_().rows, rec.recordId); } catch (x) {}
  if (type && !cur && !statusOnly) return { res: sendBookingInvite_(rec, type, by), what: Booking.label(type) + ' booking email' };
  var status = Booking.committeeType(rec.section, s) ? Booking.committeeStatus(Booking.bookableType(rec.section))
                                                       : scoutStatusOf_(s, rec);
  var booking = cur ? 'Your ' + Booking.label(cur.type) + ': ' + whenText_(cur.b.start) +
    (Booking.isVirtual(cur.type, cur.b) ? ' (online; the Google Meet link is in your calendar invitation).' : (Booking.place(cur.b) ? ' at ' + Booking.place(cur.b) + '.' : '.')) : '';
  var msg = Booking.statusEmail(rec.fields.scout_name, status, booking, pageUrl_());
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail);
  var res = mailFromTemplate_('Status + page link', { scout: String(rec.fields.scout_name), status: status, booking: booking, pageLink: pageUrl_() }, {
    committee: true, by: by, recordId: rec.recordId, scout: String(rec.fields.scout_name), to: fam.to, cc: fam.cc, keepCc: fam.keepCc,
    subject: msg.subject, body: msg.body });
  return { res: res, what: 'Status email' };
}

function handleResendLink_(e, sh, m) {
  e.range.setValue('');
  var rec = recordAtRow_(sh, m, e.range.getRow());
  if (!rec) return;
  var s = getSettings_();
  if (!SettingsModel.offersStatusEmail(rec.section)) { e.source.toast('No email for this stage.', 'Eagle Tracker', 5); return; }
  var by = editor_(e);
  var st = statusOrBookingEmail_(rec, by), res = st.res, what = st.what;
  var queued = res && res.queued;
  if (!queued) addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [sheet] ' + what + ' sent' + (by ? ' (by ' + by + ')' : ''));
  e.source.toast(queued ? what + ' for ' + rec.fields.scout_name + ' is waiting in the Outbox (committee page).'
    : what + ' sent to ' + rec.fields.scout_name + '.', 'Eagle Tracker', 6);
}

/** "✓ Checked: nothing to do": a member looked at the Scout's new files; no move, no email. */
function handleChecked_(e, sh, m) {
  e.range.setValue('');
  var rec = recordAtRow_(sh, m, e.range.getRow());
  if (!rec) return;
  var by = editor_(e);
  var cleared = clearPending_(rec.recordId, by ? memberTag_(by) : 'sheet', 'no change');
  e.source.toast(cleared ? rec.fields.scout_name + ': new files marked as checked.' : rec.fields.scout_name + ' had no new files waiting.',
    'Eagle Tracker', 5);
}

/** Action picked on a section label row: e.g. sort that section's Scouts by age. */
function handleSectionAction_(e, sh, m, sectionKey) {
  var action = SettingsModel.sectionActionFor(e.value);
  e.range.setValue('');                                  // acts like a button
  if (!action) return;
  var label = SettingsModel.sectionLabel(getSettings_(), sectionKey);
  if (action === 'sort_age') {
    if (m.map.birth_date === undefined) { e.source.toast('No Birth Date column (birth_date) to sort by.', 'Eagle Tracker', 6); return; }
    var n = withLock_(function () {
      var keys = sh.getRange(1, m.keyCol + 1, sh.getLastRow(), 1).getValues().map(function (r) { return r[0]; });
      var span = SheetModel.recordSpan(keys, sectionKey);
      if (!span) return 0;
      // Whole rows (hidden key and link columns travel along). Earliest birth date = oldest first; blanks last.
      sh.getRange(span.first + 1, 1, span.last - span.first + 1, sh.getLastColumn())
        .sort({ column: m.map.birth_date + 1, ascending: true });
      return span.last - span.first + 1;
    });
    refreshActionDropdownsQuietly_();
    e.source.toast(n ? label + ': sorted by age, oldest first.' : label + ' has no Scouts to sort.', 'Eagle Tracker', 5);
  }
}

function handleNoteEdit_(e, sh, m) {
  var text = String(e.value == null ? '' : e.value).trim();
  if (!text) return;                                     // cleared: nothing to post
  var rec = recordAtRow_(sh, m, e.range.getRow());
  if (!rec) return;
  var line = ScoutFiles.datedNote(text, Intake.shortDate(new Date()));
  postNote_(rec, line, e.oldValue);                      // log + cell (dated, re-linked); oldValue seeds a brand-new log
  recordActivity_(rec, line, editor_(e));
  e.source.toast('Added to ' + rec.fields.scout_name + "'s Life to Eagle Log.", 'Eagle Tracker', 4);
}

/**
 * Installable on-change trigger: rows dragged or inserted by hand get their
 * Action dropdown refreshed (the ● marker follows the row's new section).
 */
function onTrackingChange(e) {
  try {
    var t = e && e.changeType;
    if (t !== 'INSERT_ROW' && t !== 'REMOVE_ROW' && t !== 'OTHER') return;
    if (CacheService.getScriptCache().get('adv:busy')) return;
    refreshActionDropdownsQuietly_();
  } catch (err) { console.warn('onTrackingChange: ' + err); }
}

/** A corrected Scout name keeps linking to the folder (folder name is NOT changed automatically). */
function handleNameEdit_(e, sh, m) {
  var text = String(e.value == null ? '' : e.value).trim();
  if (!text) return;
  var rec = recordAtRow_(sh, m, e.range.getRow());
  if (!rec) return;
  var folder = linkedFolder_(rec);
  if (folder) linkCellText_(rec.recordId, 'scout_name', folder.getUrl(), text);
  // Typed straight into the sheet (2026-11-04): folder, log and the tool's files follow, as with the Scout detail Save.
  var old = String(e.oldValue == null ? '' : e.oldValue).trim();
  if (old && old !== text) sheetRename_(e, rec.recordId, old, rec.fields.unit, 'Name');
}

/** Unit typed straight into the sheet: same renaming (the unit is part of the folder and file names). */
function handleUnitEdit_(e, sh, m) {
  var text = String(e.value == null ? '' : e.value).trim(), old = String(e.oldValue == null ? '' : e.oldValue).trim();
  if (!text || !old || old === text) return;
  var rec = recordAtRow_(sh, m, e.range.getRow());
  if (rec) sheetRename_(e, rec.recordId, rec.fields.scout_name, old, 'Unit');
}

function sheetRename_(e, recordId, oldName, oldUnit, what) {
  var after = Records.get(recordId);
  if (!after) return;
  var extra = renameForChange_(after, oldName, oldUnit);
  var who = '';
  try { who = (e.user && e.user.getEmail()) || ''; } catch (x) {}
  addRecordNote_(recordId, Intake.shortDate(new Date()) + ' [sheet] ' + what + ' changed: "' + (what === 'Name' ? oldName : oldUnit) + '" → "' +
    (what === 'Name' ? after.fields.scout_name : after.fields.unit) + '"' + extra + (who ? ' (by ' + who + ')' : ''));
  if (extra) { try { e.source.toast(extra.replace(/^; /, ''), 'Eagle Tracker', 6); } catch (x) {} }
}

function editTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onTrackingEdit'; });
}

function menuInstallTriggers() {
  if (!councilAccountOk_()) return;
  installTriggers_();
  SpreadsheetApp.getUi().alert('Installed. Edits to the Action and Notes columns are now handled by the script ' +
    '(it runs as you; anyone editing the sheet triggers it).\n\nThe committee digest is checked every hour and sent at Settings → digestHours.');
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'onTrackingEdit' || h === 'onTrackingChange' || h === 'syncInvitesHourly' || h === 'onScheduleEdit' || h === 'digestHourly') ScriptApp.deleteTrigger(t);
  });
  var schedId = getSettings_().scheduleSheetId;
  if (schedId) ScriptApp.newTrigger('onScheduleEdit').forSpreadsheet(schedId).onEdit().create();
  ScriptApp.newTrigger('syncInvitesHourly').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('digestHourly').timeBased().everyHours(1).create();     // sends only at Settings → digestHours
  ScriptApp.newTrigger('onTrackingEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('onTrackingChange').forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  refreshActionDropdownsQuietly_();
}
