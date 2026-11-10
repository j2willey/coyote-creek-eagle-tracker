/**
 * UnitCalendar: the unit page's read-only calendar (Jim W., 2026-10-24). Pure.
 *
 * Default: the unit's own Scouts' sessions (Pre-Review Calls, Proposal Reviews, EBoRs; booked online or the old way),
 * so unit leaders see what is coming. "Show open times": open slots of the types Scouts book online now
 * (Settings → onlineBooking), to advise their Scouts. Other units' Scouts are never shown; open slots carry no names.
 */
var UnitCalendar = (function () {
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  var DAY = 24 * 3600 * 1000;

  /**
   * rows: schedule rows. recordUnit(recordId) -> {name, unitCodes:[...]} | null (several units: any). codes: the viewer's unit codes.
   * online: type codes booked online. -> {booked: [...], open: [...]} events {title, type, start, end, where}.
   */
  function build(rows, recordUnit, codes, online, nowMs, leadHoursFor) {
    var b = B();
    var from = nowMs - 14 * DAY, to = nowMs + 180 * DAY;
    var where = function (code, r) { return b.isVirtual(code, r) ? 'Online (Google Meet)' : b.place(r); };
    var booked = [];
    (rows || []).forEach(function (r) {
      var code = b.typeCode(r.slot_type);
      var id = str(r.record_id);
      if (!id || b.BOOKABLE.indexOf(code) < 0) return;
      var who = recordUnit(id);
      if (!who || !(who.unitCodes || [who.unitCode]).some(function (c) { return codes.indexOf(c) >= 0; })) return;   // any of the Scout's units
      var start = b.slotStart(r.date, r.time);
      if (!(start >= from && start <= to)) return;
      booked.push({ title: who.name, type: b.label(code), code: code, start: start,
        end: start + (Number(r.duration_min) || 60) * 60000, where: where(code, r) });
    });
    var open = [];
    (online || []).forEach(function (code) {
      b.openSlots(rows, code, nowMs, leadHoursFor ? leadHoursFor(code) : 0).forEach(function (x) {
        if (x.start > to) return;
        open.push({ title: 'Open ' + b.label(code), type: b.label(code), code: code, start: x.start, end: x.start + x.minutes * 60000,
          where: where(code, x) });
      });
    });
    var byStart = function (x, y) { return x.start - y.start; };
    return { booked: booked.sort(byStart), open: open.sort(byStart) };
  }

  return { build: build };
})();

if (typeof module !== 'undefined') module.exports = UnitCalendar;
