/**
 * EagleBoards (Jim W., 2026-11-17): the "Eagle earned" page (/committee/eagle), built for a phone at the board. Pure.
 *
 *  - The member's own boards come first: EBoR slots from yesterday through today (a board marked the next morning
 *    still counts) whose reps include the member's initials.
 *  - The Scout picked from the dashboard is checked against them. Picking a Scout whose board the member is not listed
 *    on is allowed (an Admin, a last-minute fill-in, two boards of one unit in an evening) but never silent: the page
 *    warns and offers the member's own board. No redirect.
 *  - Undo: for UNDO_MINUTES after saving, the member who saved (or an Admin) can put the Scout back at EBoR Booked.
 */
var EagleBoards = (function () {
  var UNDO_MINUTES = 10;
  function str(v) { return v == null ? '' : String(v).trim(); }
  function up(list) { return (list || []).map(function (x) { return str(x).toUpperCase(); }).filter(Boolean); }

  /**
   * boards: [{key, recordId, ymd, start, reps: ['AB'], ...}] already limited to the window. initials: the member's.
   * -> the boards the member sits on, soonest first.
   */
  function mine(boards, initials) {
    var me = str(initials).toUpperCase();
    if (!me) return [];
    return (boards || []).filter(function (b) { return up(b.reps).indexOf(me) >= 0; })
      .sort(function (a, b) { return (Number(a.start) || 0) - (Number(b.start) || 0); });
  }

  /**
   * What the page shows. pickedId: the Scout chosen on the dashboard ('' = none). myBoards: mine(...).
   * -> {mode, recordId, own: [recordIds]}
   *    'own'     the picked Scout is on one of the member's boards (or none picked and the member has exactly one)
   *    'warn'    a Scout was picked whose board the member is not listed on, and the member has boards in the window
   *    'other'   a Scout was picked and the member has no boards in the window (nothing to compare: no warning)
   *    'choose'  nothing picked and the member has several boards: pick one
   *    'none'    nothing picked and no boards for the member
   */
  function decide(pickedId, myBoards) {
    var own = (myBoards || []).map(function (b) { return str(b.recordId); });
    var p = str(pickedId);
    if (p) {
      if (own.indexOf(p) >= 0) return { mode: 'own', recordId: p, own: own };
      return { mode: own.length ? 'warn' : 'other', recordId: p, own: own };
    }
    if (own.length === 1) return { mode: 'own', recordId: own[0], own: own };
    return { mode: own.length ? 'choose' : 'none', recordId: '', own: own };
  }

  /** Whether the member's initials are among a board's reps (for the log line "not listed on this board"). */
  function onBoard(reps, initials) { var me = str(initials).toUpperCase(); return !!me && up(reps).indexOf(me) >= 0; }

  /**
   * Undo allowed? ticket: {by (email), at (ms)} or null; section: the row's stage now.
   * -> '' (allowed) or the reason it isn't.
   */
  function undoProblem(ticket, now, email, isAdmin, section) {
    if (!ticket) return 'Undo is only possible for ' + UNDO_MINUTES + ' minutes after saving.';
    if (now - Number(ticket.at) > UNDO_MINUTES * 60000) return 'Undo is only possible for ' + UNDO_MINUTES + ' minutes after saving.';
    if (str(ticket.by).toLowerCase() !== str(email).toLowerCase() && !isAdmin) return 'Only the member who saved it (or an Admin) can undo it.';
    if (section !== 'eagle_earned') return 'This Scout is no longer at Eagle Earned: nothing to undo.';
    return '';
  }

  /**
   * Eagles to Date after an undo. nums: what Eagle earned set ([{code, n, was}]); current: {code: count now}.
   * Only a unit still at the number it was given goes back (someone may have changed it since). -> [{code, from, to}]
   */
  function unbump(nums, current) {
    return (nums || []).filter(function (x) { return x && str(x.code) && current && current[x.code] === x.n && typeof x.was === 'number'; })
      .map(function (x) { return { code: x.code, from: x.n, to: x.was }; });
  }

  return { UNDO_MINUTES: UNDO_MINUTES, mine: mine, decide: decide, onBoard: onBoard, undoProblem: undoProblem, unbump: unbump };
})();

if (typeof module !== 'undefined') module.exports = EagleBoards;
