/**
 * Eagles to Date per unit (Jim W., 2026-11-01). Rules in lib/eagleCount.js. Unit Info → "Eagles to Date" (editable;
 * blank = unknown). "Eagle earned" adds 1 for every unit the Scout is listed in; the board sees the number to announce.
 */

/** {code: count | null} from the Unit Info tab (as displayed). */
function eagleCounts_() {
  var out = {};
  unitInfoDisplayRows_().forEach(function (r) {
    var c = Units.code(r['Unit']);
    if (c && out[c] === undefined) out[c] = EagleCount.parseCount(UnitDirectory.cell(r, 'Eagles to Date'));
  });
  return out;
}

/** Scouts in EBoR Booked -> {recordId: [{code, n, guess}]}: the number each would be, boards in date order. */
function eagleForecast_() {
  var starts = {};
  try {
    readSchedule_().rows.forEach(function (r) {
      var id = String(r.record_id || '').trim();
      if (!id || Booking.typeCode(r.slot_type) !== 'EBoR') return;
      var st = Booking.slotStart(r.date, r.time);
      if (!isNaN(st) && (starts[id] === undefined || st > starts[id])) starts[id] = st;
    });
  } catch (e) { console.warn('eagleForecast_ schedule: ' + e); }
  var pending = Records.all(['scout_name', 'unit']).filter(function (r) { return r.section === 'ebor_booked' && String(r.scout_name || '').trim(); })
    .map(function (r) { return { recordId: r.recordId, unit: r.unit, start: starts[r.recordId] === undefined ? Infinity : starts[r.recordId] }; });
  return EagleCount.forecast(pending, eagleCounts_());
}

/** Best effort: the "If awarded" text for each EBoR Booked Scout ({} on any error). */
function eagleAnnounce_() {
  var out = {};
  try { var f = eagleForecast_(); Object.keys(f).forEach(function (id) { var t = EagleCount.announce(f[id]); if (t) out[id] = t; }); }
  catch (e) { console.warn('eagleAnnounce_: ' + e); }
  return out;
}

/**
 * "Eagle earned": +1 on each of the Scout's units that has a count (blank stays blank). -> [{code, n}] the new numbers.
 * Logged per unit on Activity (old → new) so a mistaken promotion can be undone by hand.
 */
function bumpEagleCounts_(rec, by) {
  var codes = Units.codes(rec.fields.unit);
  if (!codes.length) return [];
  var done = withLock_(function () {
    var head = ensureUnitInfoColumns_();
    var col = UnitDirectory.actualColumn(head, 'Eagles to Date');
    var ci = head.indexOf(col) + 1;
    var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_INFO_TAB);
    var rows = unitInfoDisplayRows_();
    var out = [];
    codes.forEach(function (c) {
      var r = rows.filter(function (x) { return Units.code(x['Unit']) === c; })[0];
      var n = r ? EagleCount.parseCount(UnitDirectory.cell(r, 'Eagles to Date')) : null;
      if (n === null || !ci) return;
      sh.getRange(r._row, ci).setNumberFormat('@').setValue(String(n + 1));
      var upd = {};
      upd[UnitDirectory.actualColumn(head, 'Last Updated')] = new Date();
      upd[UnitDirectory.actualColumn(head, 'Updated By')] = by + ' (Eagle earned)';
      Tabs.update(UNIT_INFO_TAB, r._row, upd);
      out.push({ code: c, n: n + 1, was: n });
    });
    return out;
  });
  done.forEach(function (x) { unitLog_(x.code, 'Eagles to Date ' + x.was + ' → ' + x.n + ' (' + String(rec.fields.scout_name || '') + ' earned Eagle)', by); });
  if (done.length) uncache_(['c:units']);
  return done;
}

/** {code: Eagles this calendar year} from the tracking tab (Eagle Earned, EBoR date this year). */
function eaglesThisYear_() {
  var eCol = stageColumns_().ebor;
  var recs = Records.all(['unit', eCol].filter(String)).map(function (r) { return { section: r.section, unit: r.unit, ebor: eCol ? (Intake.dateKey(r[eCol]) || '') : '' }; });
  return EagleCount.yearCounts(recs, todayYmd_().slice(0, 4));
}
