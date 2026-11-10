/**
 * Builds a FAKE schedule sheet for development (the real one is still .xlsx).
 * Same columns as the committee's signup sheet, plus a hidden machine header
 * row. Open slot = empty Scout cell. Stores its ID in Settings → scheduleSheetId.
 */
var SCHEDULE_COLUMNS_ = [
  ['Date', 'date'], ['Day', 'day'], ['Time', 'time'], ['Scout Name', 'scout_name'], ['Unit', 'unit'],
  ['Council/District Rep(s)', 'reps'], ['Board Members', 'board_members'], ['Slot Type', 'slot_type'],
  ['Location', 'location'], ['Address', 'address'], ['Duration (min)', 'duration_min'],
  ['Record ID', 'record_id'], ['Calendar Event ID', 'event_id'], ['_key', '_key']
];

function menuMakeFakeSchedule() {
  if (!councilAccountOk_()) return;
  var s = getSettings_();
  var ui = SpreadsheetApp.getUi();
  if (s.scheduleSheetId) {
    var r = ui.alert('A schedule sheet is already set in Settings. Make a new one anyway?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  var id = makeFakeScheduleSheet_();
  setSetting_('scheduleSheetId', id);
  ui.alert('Created "DEV Schedule (fake data)" next to this spreadsheet.\nSettings → scheduleSheetId updated.');
}

function makeFakeScheduleSheet_() {
  var ss = SpreadsheetApp.create('DEV Schedule (fake data)');
  // Put it in the same folder as the tracking sheet.
  var file = DriveApp.getFileById(ss.getId());
  var parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  if (parents.hasNext()) file.moveTo(parents.next());

  var sh = ss.getSheets()[0];
  sh.setName('Schedule');
  var machine = SCHEDULE_COLUMNS_.map(function (c) { return c[1]; });
  var labels = SCHEDULE_COLUMNS_.map(function (c) { return c[0]; });
  var rows = fakeSlots_(new Date(), 21);
  sh.getRange(1, 1, 1, machine.length).setValues([machine]);
  sh.getRange(2, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
  if (rows.length) sh.getRange(3, 1, rows.length, machine.length).setValues(rows);
  sh.hideRows(1);
  sh.setFrozenRows(2);
  sh.getRange(3, 1, Math.max(rows.length, 1), 1).setNumberFormat('ddd m/d/yyyy');
  sh.autoResizeColumns(1, machine.length);
  return ss.getId();
}

/**
 * Fake slots using the short Slot Type codes (Intake = Pre-Review Call,
 * ESSPPR = Proposal Review, EBoR, CCAC = committee meeting) and member INITIALS
 * in Council/District Rep(s). Keys are left blank on purpose: the script
 * keys new rows (SL_yymmdd_XXX) the first time it reads the schedule.
 */
function fakeSlots_(start, days) {
  var who = ['MA', 'MB', 'MC', 'MA/MB'];
  var out = [];
  var n = 0;
  for (var d = 1; d <= days; d++) {
    var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    var dow = day.getDay();
    var dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
    if (dow >= 1 && dow <= 4) {
      ['7:00 PM', '7:30 PM'].forEach(function (t, i) {
        var booked = (n++ % 5 === 0);
        out.push([day, dayName, t, booked ? 'Scout ' + (10 + n) : '', booked ? 'T1' + n : '',
          who[(d + i) % who.length], '', 'Intake', 'Online (Meet)', '', 20, '', '', '']);
      });
    }
    if (dow === 2 || dow === 4) {
      ['7:00 PM', '7:45 PM'].forEach(function (t) {
        out.push([day, dayName, t, '', '', '', '', 'ESSPPR', 'East Valley YMCA', '(fake address)', 45, '', '', '']);
      });
    }
    if (dow === 1 || dow === 3) {          // Mon/Wed EBoRs at the YMCA, a District Rep pre-assigned on some
      out.push([day, dayName, '8:00 PM', '', '', d % 2 ? 'MC' : '', '', 'EBoR', 'East Valley YMCA', '(fake address)', 45, '', '', '']);
    }
    if (d === 9 && dow >= 1 && dow <= 4) {   // one committee meeting that blocks that evening's Intake slots
      out.push([day, dayName, '6:30 PM', '', '', '', '', 'CCAC', 'East Valley YMCA', '(fake address)', 120, '', '', '']);
    }
  }
  return out;
}
