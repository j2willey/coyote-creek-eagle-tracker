/**
 * Events (Jim W., 2026-11-17): an append-only history on the hidden "_Events" tab, for statistics the tracking sheet
 * never kept (who ran the Pre-Review Call, what each Proposal Review decided, when a row changed stage). The tracking
 * tab stays the record; this is history built beside it, so a failed write only loses statistics. Rows carry Record
 * IDs and committee initials, never Scout names. A Firestore copy may come later (see the backend decision note).
 *
 * Event types:
 *   stage           a row moved: From / To section keys
 *   review_outcome  a Proposal Review outcome: Outcome approved | revisions | not_approved; Date = the review's date;
 *                   Session = the ESSPPR slot key, Reps = its members
 *   intake_outcome  a Pre-Review Call outcome: Outcome ready | changes | not_approved; Session = the Intake slot
 * Pure.
 */
var Events = (function () {
  var TAB = '_Events';
  var HEADERS = ['At', 'Record ID', 'Event', 'From', 'To', 'Outcome', 'Date', 'Session', 'Reps', 'By', 'Source'];
  var TYPES = ['stage', 'review_outcome', 'intake_outcome'];
  var INTAKE_OUTCOME = { review_ok: 'ready', intake_revisions: 'changes', not_approved: 'not_approved' };

  function str(v) { return v == null ? '' : String(v).trim(); }
  function ymd(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function reps(v) { return (Array.isArray(v) ? v : str(v).split(/[\s,\/&]+/)).map(function (x) { return str(x).toUpperCase(); }).filter(Boolean); }

  /** e: {event, recordId, from, to, outcome, date, session, reps, by, source}; now: Date -> a row object for Tabs.append. */
  function row(e, now) {
    if (TYPES.indexOf(e.event) < 0) throw new Error('Unknown event: ' + e.event);
    if (!str(e.recordId)) throw new Error('Event without a Record ID');
    return { 'At': now, 'Record ID': str(e.recordId), 'Event': e.event, 'From': str(e.from), 'To': str(e.to), 'Outcome': str(e.outcome),
      'Date': ymd(e.date), 'Session': str(e.session), 'Reps': reps(e.reps).join(' '), 'By': str(e.by) || 'system', 'Source': str(e.source) || 'live' };
  }

  /** Tab rows -> [{at (ms), recordId, event, from, to, outcome, date, session, reps[], by, source}], oldest first. */
  function parse(rows) {
    return (rows || []).filter(function (r) { return str(r['Record ID']) && TYPES.indexOf(str(r['Event'])) >= 0; }).map(function (r) {
      var at = r['At'] instanceof Date ? r['At'].getTime() : Date.parse(str(r['At'])) || 0;
      return { at: at, recordId: str(r['Record ID']), event: str(r['Event']), from: str(r['From']), to: str(r['To']), outcome: str(r['Outcome']),
        date: ymd(r['Date']), session: str(r['Session']), reps: reps(r['Reps']), by: str(r['By']), source: str(r['Source']) || 'live' };
    }).sort(function (a, b) { return a.at - b.at; });
  }

  /** A dashboard action that records a Pre-Review Call outcome (from a stage after the call) -> outcome, or ''. */
  function intakeOutcome(actionKey, fromSection) {
    return ['intake_booked', 'intake_revisions'].indexOf(fromSection) >= 0 ? (INTAKE_OUTCOME[actionKey] || '') : '';
  }

  return { TAB: TAB, HEADERS: HEADERS, TYPES: TYPES, row: row, parse: parse, intakeOutcome: intakeOutcome };
})();

if (typeof module !== 'undefined') module.exports = Events;
