/**
 * ShadowInvites (Jim W., 2026-10-26): switch-over helper. Sessions booked the old way were mirrored on the schedule
 * as "shadow" (no Calendar invitation). From tomorrow on, give each one a real invitation so it behaves like any
 * booking made in the tool (invite follows member / board changes and moves). Pure.
 */
var ShadowInvites = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }

  /** Local midnight at the start of tomorrow. */
  function tomorrowStart(nowMs) {
    var d = new Date(nowMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  /**
   * rows: schedule rows. -> booked shadow sessions starting tomorrow or later, oldest first:
   * [{key, row (sheet row), recordId, type, label, start, minutes, who: [initials], location, address, scout, unit, board}]
   */
  function candidates(rows, nowMs) {
    var from = tomorrowStart(nowMs);
    return (rows || []).filter(function (r) {
      var t = B().typeCode(r.slot_type);
      return B().isShadow(r.event_id) && str(r.record_id) && B().BOOKABLE.indexOf(t) >= 0 && (B().slotStart(r.date, r.time) || 0) >= from;
    }).map(function (r) {
      var t = B().typeCode(r.slot_type);
      return { key: str(r._key), row: r._row, recordId: str(r.record_id), type: t, label: B().label(t), start: B().slotStart(r.date, r.time),
        minutes: Number(r.duration_min) || (t === 'EBoR' ? 90 : t === 'ESSPPR' ? 60 : 20), who: B().splitWho(r.reps),
        location: str(r.location), address: str(r.address), scout: str(r.scout_name), unit: str(r.unit), board: str(r.board_members) };
    }).sort(function (a, b) { return a.start - b.start; });
  }

  return { tomorrowStart: tomorrowStart, candidates: candidates };
})();

if (typeof module !== 'undefined') module.exports = ShadowInvites;
