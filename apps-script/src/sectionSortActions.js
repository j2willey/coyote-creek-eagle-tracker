/**
 * Keep EBoR Booked in EBoR Date order (lib/sectionSort.js): after a record moves in, after the tool writes an EBoR
 * Date, after a member types one (edit trigger), and from Admin → "Sort EBoR Booked by date". Whole rows are moved
 * (Sheet.moveRows), so formatting, notes and links go with them. Never throws.
 */
var SORTED_SECTION_ = 'ebor_booked';

function sortEborBooked_() {
  try {
    var col = String(getSettings_().eborDateColumn || 'ebor_date');
    var moved = 0;
    Records.invalidate();
    Records.columns();                                   // gives a hand-inserted row (name, no key) its Record ID
    withLock_(function () {
      var sh = getTrackingSheet_();
      var data = sh.getDataRange().getValues();
      var m = SheetModel.findMachineRow(data.slice(0, 15));
      if (!m || m.map[col] === undefined) return;
      var keys = data.map(function (r) { return String(r[m.keyCol]); });
      var span = SheetModel.recordSpan(keys, SORTED_SECTION_);
      if (!span) return;
      var rows = [];
      for (var r = span.first; r <= span.last; r++) rows.push({ key: SheetModel.isRecordId(keys[r]) ? keys[r] : '#' + r, date: data[r][m.map[col]], blank: !SheetModel.isRecordId(keys[r]) });
      var current = rows.map(function (x) { return x.key; });
      SectionSort.moves(current, SectionSort.latestFirst(rows)).forEach(function (mv) {
        var from = span.first + mv.from, to = span.first + mv.to;     // 0-based sheet rows
        sh.moveRows(sh.getRange(from + 1, 1), to + 1);
        moved++;
      });
    });
    Records.invalidate();
    return moved;
  } catch (e) { console.warn('sortEborBooked_: ' + e); return 0; }
}

function menuSortEborBooked() {
  var n = sortEborBooked_();
  SpreadsheetApp.getActive().toast(n ? 'EBoR Booked sorted (' + n + ' row' + (n === 1 ? '' : 's') + ' moved).' : 'EBoR Booked is already in date order.', 'Eagle Tracker', 6);
}
