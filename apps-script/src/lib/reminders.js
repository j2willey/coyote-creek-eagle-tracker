/**
 * Reminders (Jim W., 2026-10-24): EBoR reminders only (no no-show problem at Pre-Review Calls / Proposal Reviews).
 * Settings → eborReminderDays (default 3) before the board, the tool drafts ONE email into the Outbox (2026-11-02; was
 * two, 4.3.a Scout + 4.3.b board): 4.3.c "EBoR reminder": day, time, place, who is on the board, how the Scout prepares
 *   -> To the Scout + district reps + Unit Board Members; Cc parent/guardian + committee
 * A member checks it, adds details (back of the church…) and sends or schedules it (Outbox → Send later).
 * Once per board: the key is the slot + its start time, so a board moved to a new date gets new reminders. Pure.
 */
var Reminders = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var DAY = 24 * 3600 * 1000;

  /**
   * slots: [{key, recordId, start (ms), section}] booked EBoR slots (shadow included: EBoRs are still booked the
   * old way). done: {reminderKey: true}. -> slots needing reminders now, with their reminderKey.
   */
  function dueEbors(slots, nowMs, days, done) {
    var lead = (Number(days) || 3) * DAY;
    return (slots || []).filter(function (x) {
      return x.recordId && x.start > nowMs && x.start - nowMs <= lead && x.section === 'ebor_booked' && !(done || {})[key(x)];
    }).map(function (x) { var y = {}; for (var k in x) y[k] = x[k]; y.reminderKey = key(x); return y; });
  }

  function key(x) { return 'rem:' + str(x.key) + ':' + x.start; }

  /** "Dana Reyes (district), Pat Q (unit)" for the board email. */
  function boardList(repNames, unitBoard) {
    return (repNames || []).filter(str).map(function (n) { return str(n) + ' (district)'; })
      .concat((unitBoard || []).filter(function (m) { return str(m.name) || str(m.email); }).map(function (m) { return (str(m.name) || str(m.email)) + ' (unit)'; }))
      .join(', ');
  }

  return { dueEbors: dueEbors, key: key, boardList: boardList };
})();

if (typeof module !== 'undefined') module.exports = Reminders;
