/**
 * Admin → "Schedule: check against the tracking sheet" (transition / shadow period). Rules in lib/scheduleCheck.js.
 *
 * For every schedule row with a Scout name (Pre-Review Call, Proposal Review, EBoR):
 *  1. Finds the Scout on the tracking sheet (by Record ID if linked, else name + unit, like typing a name does).
 *     Not found / ambiguous → listed so typos can be fixed.
 *  2. Compares the tracking sheet's Date column for that session type (Settings → *DateColumn):
 *     empty → filled from the schedule (date + time), and the Who column too if empty;
 *     different → listed (nothing overwritten); same → OK.
 *  3. Links each found Scout whose dates agree (OK / FILLED; DIFFERENT rows wait until a person settles them): writes the Record ID into the schedule row (and "shadow" in Calendar Event ID for
 *     types not booked online yet), so the slot belongs to that Scout. Tracking rows are NOT moved (retyping the
 *     name does that). A live type (Pre-Review Call) is linked without an invitation; it is flagged.
 * Sends no email. Results on the "Schedule Check" tab.
 */
var SCHEDULE_CHECK_TAB = 'Schedule Check';

function menuScheduleCheck() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Check the schedule against the tracking sheet?',
    'Finds each scheduled Scout on the tracking sheet, writes their Record ID into the schedule row (Proposal Review / EBoR: ' +
    'as a shadow booking) and compares the session date. Empty tracking dates are filled in from the schedule; different ' +
    'dates are only listed. Tracking rows are not moved. No emails. Results go on the "Schedule Check" tab.',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try {
    var r = scheduleCheck_();
    ui.alert('Schedule check: ' + r.rows.length + ' booked session(s).\n\n' +
      '• Scout not found / unclear: ' + r.count.notFound + '\n' +
      '• Linked to the tracking sheet (Record ID written): ' + r.count.linked + '\n' +
      '• Tracking date filled in: ' + r.count.filled + '\n' +
      '• Tracking date DIFFERENT: ' + r.count.differs + '\n' +
      '• Already the same: ' + r.count.same + '\n\nDetails on the "Schedule Check" tab.');
  } catch (e) { ui.alert('Schedule check failed: ' + (e.userMessage || e.message)); }
}

function scheduleCheck_() {
  var s = getSettings_();
  var sched = readSchedule_();
  var cols = Records.columns();
  var all = Records.all(['scout_name', 'unit', 'preferred_name']);
  var out = [], count = { notFound: 0, filled: 0, differs: 0, same: 0, other: 0, linked: 0 };
  var links = [];                                            // {key, recordId, shadow}
  sched.rows.forEach(function (row) {
    var name = String(row.scout_name || '').trim();
    var type = Booking.typeCode(row.slot_type);
    if (!name || Booking.BOOKABLE.indexOf(type) < 0) return;
    var start = Booking.slotStart(row.date, row.time);
    var when = isNaN(start) ? String(row.date) + ' ' + String(row.time) : whenText_(start);
    var line = { when: when, type: Booking.label(type), scout: name, unit: String(row.unit || ''), result: '', detail: '' };
    out.push(line);

    var id = String(row.record_id || '').trim();
    var rec = id ? Records.get(id) : null;
    if (!rec) {
      var m = Booking.matchScout(all, name, row.unit, Units.code);
      if (m.error) { line.result = 'NOT FOUND'; line.detail = m.error; count.notFound++; return; }
      rec = Records.get(m.recordId);
      if (rec) {
        var shadow = Booking.isShadowType(type, s);
        line.link = { key: String(row._key), recordId: rec.recordId, shadow: shadow && !String(row.event_id || '').trim() };
        line.linked = shadow ? 'linked (shadow)' : 'linked: NO invitation exists for this live ' + Booking.label(type) +
          ' (book it on the committee page to send one)';
      }
    }
    if (!rec) { line.result = 'NOT FOUND'; line.detail = 'Record ' + id + ' is no longer on the tracking tab.'; count.notFound++; return; }
    line.scout = String(rec.fields.scout_name) + (name !== String(rec.fields.scout_name).trim() ? '  (schedule: ' + name + ')' : '');
    line.unit = String(rec.fields.unit || '');
    if (isNaN(start)) { line.result = 'CHECK'; line.detail = 'The schedule row has no readable date/time.'; count.other++; return; }

    var r = Booking.rules(type);
    var dateCol = s[r.dateCol], whoCol = s[r.whoCol];
    if (!dateCol || cols.indexOf(dateCol) < 0) {
      line.result = 'CHECK'; line.detail = 'The tracking tab has no "' + (dateCol || r.dateCol) + '" column (Settings → ' + r.dateCol + ').';
      count.other++; return;
    }
    var cmp = ScheduleCheck.compare(rec.fields[dateCol], start);
    if (cmp.state === 'empty') {
      var upd = {}; upd[dateCol] = new Date(start);
      var who = Booking.splitWho(row.reps).join('/');
      if (whoCol && cols.indexOf(whoCol) >= 0 && !String(rec.fields[whoCol] || '').trim() && who) upd[whoCol] = who;
      Records.update(rec.recordId, upd);
      line.result = 'FILLED'; line.detail = 'Tracking date set to ' + when + (upd[whoCol] ? '; Who: ' + who : '');
      count.filled++;
    } else if (cmp.state === 'same') {
      line.result = 'OK'; count.same++;
    } else {
      line.result = 'DIFFERENT';
      line.detail = 'Tracking sheet says ' + cmp.tracking + (cmp.state === 'unreadable' ? ' (not a date the tool can read)' : '') + '; schedule says ' + when;
      count.differs++;
    }
  });
  // Link the found Scouts whose dates agree (OK / FILLED). A DIFFERENT row is left unlinked: once linked, the sync
  // makes the tracking date follow the schedule, so the difference must be settled by a person first.
  out.forEach(function (l) {
    if (!l.link) return;
    if (l.result === 'OK' || l.result === 'FILLED') links.push(l.link);
    else l.linked = 'not linked until the date is settled';
  });
  if (links.length) {
    withLock_(function () {
      var fresh = readSchedule_();
      links.forEach(function (l) {
        var row = fresh.rows.filter(function (r) { return String(r._key) === l.key; })[0];
        if (!row || String(row.record_id || '').trim()) return;     // changed meanwhile: leave it
        var cells = { record_id: l.recordId };
        if (l.shadow) cells.event_id = Booking.SHADOW;
        writeSchedule_(fresh, row._row, cells);
        count.linked++;
      });
    });
  }
  out.forEach(function (l) { if (l.linked) l.detail = (l.detail ? l.detail + '; ' : '') + l.linked; });
  writeScheduleCheck_(out);
  return { rows: out, count: count };
}

function writeScheduleCheck_(lines) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SCHEDULE_CHECK_TAB) || ss.insertSheet(SCHEDULE_CHECK_TAB);
  sh.clear();
  var order = { 'NOT FOUND': 0, 'DIFFERENT': 1, 'CHECK': 2, 'FILLED': 3, 'OK': 4 };
  lines.sort(function (a, b) { return (order[a.result] - order[b.result]) || 0; });
  var rows = [['Checked ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy h:mm a'), '', '', '', '', ''],
    ['Result', 'Session', 'Type', 'Scout', 'Unit', 'Detail']]
    .concat(lines.map(function (l) { return [l.result, l.when, l.type, l.scout, l.unit, l.detail]; }));
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  sh.getRange(2, 1, 1, 6).setFontWeight('bold');
  sh.setFrozenRows(2);
  var colors = { 'NOT FOUND': '#f4cccc', 'DIFFERENT': '#fce5cd', 'CHECK': '#fff2cc', 'FILLED': '#d9ead3' };
  lines.forEach(function (l, i) { if (colors[l.result]) sh.getRange(i + 3, 1).setBackground(colors[l.result]); });
  sh.autoResizeColumns(1, 6);
}
