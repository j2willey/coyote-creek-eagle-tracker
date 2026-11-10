/**
 * ScheduleCheck: transition helper (shadow period, Jim W. 2026-10-22). Compares the schedule sheet's booked
 * sessions with the tracking sheet: is each Scout found, and does the tracking Date column agree?
 * Pure; the adapter is scheduleCheckActions.js.
 */
var ScheduleCheck = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Tracking Date cell (Date, "10/26/2026", "10/26/2026 7:00 PM", "10/26") -> {y, m, d, h, min} or null. h = -1: no time. */
  function readCell(v, defaultYear) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      var hasTime = v.getHours() !== 0 || v.getMinutes() !== 0;
      return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), h: hasTime ? v.getHours() : -1, min: hasTime ? v.getMinutes() : 0 };
    }
    var s = str(v);
    var m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?)?$/i.exec(s);
    if (!m) return null;
    var y = m[3] ? Number(m[3]) : defaultYear;
    if (y < 100) y += 2000;
    var h = -1, min = 0;
    if (m[4]) { h = Number(m[4]) % 12 + (m[6].toLowerCase() === 'p' ? 12 : 0); min = Number(m[5] || 0); }
    return { y: y, m: Number(m[1]), d: Number(m[2]), h: h, min: min };
  }

  function show(c) {
    return c.m + '/' + c.d + '/' + c.y + (c.h >= 0 ? ' ' + ((c.h % 12) || 12) + ':' + pad2(c.min) + (c.h < 12 ? ' AM' : ' PM') : '');
  }

  /**
   * Tracking Date cell vs the schedule's start (ms).
   * -> { state: 'empty' | 'same' | 'differs' | 'unreadable', tracking: text }
   * Same day and (no time on the tracking side, or the same time) = same.
   */
  function compare(cell, startMs) {
    if (cell == null || str(cell) === '') return { state: 'empty', tracking: '' };
    var s = new Date(startMs);
    var c = readCell(cell, s.getFullYear());
    if (!c) return { state: 'unreadable', tracking: str(cell) };
    var sameDay = c.y === s.getFullYear() && c.m === s.getMonth() + 1 && c.d === s.getDate();
    var sameTime = c.h < 0 || (c.h === s.getHours() && c.min === s.getMinutes());
    return { state: sameDay && sameTime ? 'same' : 'differs', tracking: show(c) };
  }

  return { readCell: readCell, compare: compare };
})();

if (typeof module !== 'undefined') module.exports = ScheduleCheck;
