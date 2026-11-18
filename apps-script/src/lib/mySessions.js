/**
 * MySessions (Jim W., 2026-11-17): the sessions a committee member records an outcome for from a phone. Pure.
 *
 * On a laptop members work from the Dashboard and the Schedule. At a board, on a phone, they want only tonight's
 * session. Two kinds need an outcome from a phone: an Eagle Board of Review (-> the Eagle earned page) and a
 * Proposal Review (-> the Review outcome page with that Scout picked). The window is yesterday and today only: a
 * review not recorded by the next day is recorded at a laptop.
 *
 *  - list():     the member's sessions in the window (their initials among the slot's reps), soonest first.
 *                done = the Scout has left the booked stage (the outcome is already recorded).
 *  - autoOpen(): where a phone goes straight away: the one session still open, or '' (none, or several to pick from).
 *  - tonight():  the member's open sessions today (the dashboard banner).
 */
var MySessions = (function () {
  var KINDS = {
    EBoR: { label: 'Eagle Board of Review', short: 'EBoR', booked: 'ebor_booked', page: '/committee/eagle?r=' },
    ESSPPR: { label: 'Proposal Review', short: 'Proposal Review', booked: 'review_booked', page: '/committee/review?r=' }
  };
  var TYPES = Object.keys(KINDS);

  function str(v) { return v == null ? '' : String(v).trim(); }
  function up(list) { return (list || []).map(function (x) { return str(x).toUpperCase(); }).filter(Boolean); }

  /**
   * sessions: [{key, recordId, type ('EBoR' | 'ESSPPR'), ymd, start, reps, when, where, scout, unit, section}], already
   * limited to yesterday-today. initials: the member's. -> [{...session, kind, label, done, href}] soonest first.
   */
  function list(sessions, initials) {
    var me = str(initials).toUpperCase();
    if (!me) return [];
    return (sessions || []).filter(function (s) { return s && KINDS[s.type] && str(s.recordId) && up(s.reps).indexOf(me) >= 0; })
      .map(function (s) {
        var k = KINDS[s.type];
        return { key: str(s.key), recordId: str(s.recordId), type: s.type, label: k.label, short: k.short, ymd: str(s.ymd),
          start: Number(s.start) || 0, when: str(s.when), where: str(s.where), scout: str(s.scout), unit: str(s.unit),
          done: str(s.section) !== k.booked, href: k.page + encodeURIComponent(str(s.recordId)) };
      })
      .sort(function (a, b) { return a.start - b.start; });
  }

  function open(mine) { return (mine || []).filter(function (s) { return !s.done; }); }

  /** The one session still waiting for its outcome, or '' (none, or several: the member picks). */
  function autoOpen(mine) { var o = open(mine); return o.length === 1 ? o[0].href : ''; }

  /** Open sessions today (not yesterday's): the dashboard's "Tonight" banner. */
  function tonight(mine, today) { return open(mine).filter(function (s) { return s.ymd === str(today); }); }

  return { KINDS: KINDS, TYPES: TYPES, list: list, autoOpen: autoOpen, tonight: tonight };
})();

if (typeof module !== 'undefined') module.exports = MySessions;
