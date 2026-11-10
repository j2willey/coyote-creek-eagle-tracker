/**
 * Pending: "whose move is it" (design note kept outside the repo, 2026-10-23). Pure.
 *
 * Hidden tracking column _pending_since = time of the OLDEST Scout file submission no committee member has acted
 * on yet. Raised by every Scout submission with files (first submission, matched duplicate, Scout Update);
 * cleared by a committee decision (Action move, "✓ Checked: nothing to do", Review outcome). Empty = nothing waiting.
 * In the sheet it shows as an amber Action cell (conditional formatting).
 */
var Pending = (function () {
  var COLUMN = '_pending_since';
  var DAY = 24 * 3600 * 1000;

  /** Cell value -> ms, or 0 when empty / not a date. */
  function ms(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
    if (typeof v === 'number') return v > 0 ? v : 0;
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function isPending(v) { return ms(v) > 0; }

  /** New value when a Scout submits files: the existing time is kept (oldest wins), else now. */
  function raise(current, now) {
    var c = ms(current);
    return c ? new Date(c) : new Date(now instanceof Date ? now.getTime() : now);
  }

  /** Whole days waiting (0 = today). */
  function ageDays(since, nowMs) {
    var s = ms(since);
    return s ? Math.max(0, Math.floor((nowMs - s) / DAY)) : 0;
  }

  function ageText(days) { return days === 0 ? 'today' : days === 1 ? '1 day' : days + ' days'; }

  /**
   * records: [{scout_name, unit, pending (cell value), section}] -> waiting list, oldest first:
   * [{title, since (ms), days}]
   */
  function waiting(records, nowMs) {
    return (records || []).filter(function (r) { return isPending(r.pending) && String(r.scout_name || '').trim(); })
      .map(function (r) {
        return { title: String(r.scout_name).trim() + (String(r.unit || '').trim() ? ' (' + String(r.unit).trim() + ')' : ''),
          since: ms(r.pending), days: ageDays(r.pending, nowMs), section: r.section || '' };
      })
      .sort(function (a, b) { return a.since - b.since; });
  }

  /** Log line when a member clears it. */
  function clearedLine(shortDate, by, how) {
    return shortDate + ' [' + (by || 'committee') + '] New files checked' + (how ? ' (' + how + ')' : '');
  }

  return { COLUMN: COLUMN, ms: ms, isPending: isPending, raise: raise, ageDays: ageDays, ageText: ageText,
    waiting: waiting, clearedLine: clearedLine };
})();

if (typeof module !== 'undefined') module.exports = Pending;
