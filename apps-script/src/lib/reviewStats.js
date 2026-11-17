/**
 * ReviewStats (Jim W., 2026-11-17): how Pre-Review Calls and Proposal Reviews go, for the Stats page. Pure.
 *
 * Inputs:
 *   sessions  [{key, type: 'Intake'|'ESSPPR', recordId, ymd, who: ['AB']}]  booked schedule slots whose time has passed
 *   records   [{recordId, approved: 'YYYY-MM-DD'|''}]                      the tracking tab
 *   events    Events.parse(...)                                            outcomes recorded since 2026-11-17
 *
 * A Scout counts once, by the FIRST Proposal Review on the schedule. Its outcome comes from a review_outcome event
 * for that session (exact), else is inferred from the Approved Date: same day (or earlier) = approved at the review;
 * later = approved later; none = still open (left out of rates). Inferred numbers are labelled as such on the page.
 */
var ReviewStats = (function () {
  var DAY = 86400000;
  function str(v) { return v == null ? '' : String(v).trim(); }
  function ms(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(d)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function days(a, b) { var x = ms(a), y = ms(b); return x === null || y === null ? null : Math.round((y - x) / DAY); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function spread(list) {
    if (!list.length) return { n: 0, avg: null, median: null, min: null, max: null };
    var s = list.slice().sort(function (a, b) { return a - b; }), h = Math.floor(s.length / 2);
    return { n: s.length, avg: round1(s.reduce(function (a, b) { return a + b; }, 0) / s.length),
      median: s.length % 2 ? s[h] : round1((s[h - 1] + s[h]) / 2), min: s[0], max: s[s.length - 1] };
  }
  function byDate(a, b) { return a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0; }

  /** The record's latest session of a type on or before ymd (else null). */
  function sessionOn(sessions, recordId, type, ymd) {
    var mine = (sessions || []).filter(function (s) { return s.recordId === recordId && s.type === type && s.ymd && s.ymd <= ymd; }).sort(byDate);
    return mine.length ? mine[mine.length - 1] : null;
  }

  /** scope: 'YYYY' (first Proposal Review in that year) or '' (all). */
  function compute(input, scope) {
    var sessions = (input.sessions || []).filter(function (s) { return str(s.recordId) && s.ymd; });
    var approved = {};
    (input.records || []).forEach(function (r) { approved[r.recordId] = str(r.approved); });
    var events = input.events || [];
    var reviews = sessions.filter(function (s) { return s.type === 'ESSPPR'; }).sort(byDate);
    var first = {};
    reviews.forEach(function (s) { if (!first[s.recordId]) first[s.recordId] = s; });
    var since = reviews.length ? reviews[0].ymd : '';

    var out = { scope: scope || 'all', since: since, scouts: 0, atFirst: 0, later: 0, notApproved: 0, open: 0, skipped: 0, exact: 0, inferred: 0,
      laterDays: null, reviewsPerApproval: { one: 0, two: 0, more: 0 }, intakeToReview: null, byIntake: [], intakeOutcomes: [] };
    var laterDays = [], gap = [], intake = {};
    var credit = function (who, field) { intake[who] = intake[who] || { who: who, scouts: 0, decided: 0, atFirst: 0 }; intake[who][field]++; };

    Object.keys(first).forEach(function (id) {
      var f = first[id];
      if (scope && f.ymd.slice(0, 4) !== String(scope)) return;
      var ap = approved[id] || '';
      if (ap && ap < f.ymd) { out.skipped++; return; }               // approved before any review on the schedule: older history
      out.scouts++;
      var ev = events.filter(function (e) { return e.event === 'review_outcome' && e.recordId === id && (e.session ? e.session === f.key : e.date === f.ymd); }).pop();
      var res;
      if (ev) { out.exact++; res = ev.outcome === 'approved' ? 'atFirst' : ev.outcome === 'not_approved' ? 'notApproved' : (ap ? 'later' : 'open'); }
      else { out.inferred++; res = !ap ? 'open' : ap === f.ymd ? 'atFirst' : 'later'; }
      out[res]++;
      if (res === 'later' && ap) laterDays.push(days(f.ymd, ap));
      if (ap && res !== 'notApproved') {
        var n = reviews.filter(function (s) { return s.recordId === id && s.ymd <= ap; }).length;
        out.reviewsPerApproval[n <= 1 ? 'one' : n === 2 ? 'two' : 'more']++;
      }
      // Who ran the Scout's (last) Pre-Review Call before that review; no call = its own row.
      var call = sessionOn(sessions, id, 'Intake', f.ymd);
      var who = call && call.who.length ? call.who : ['(no Pre-Review Call)'];
      if (call) { var g = days(call.ymd, f.ymd); if (g !== null) gap.push(g); }
      who.forEach(function (w) {
        credit(w, 'scouts');
        if (res !== 'open') credit(w, 'decided');
        if (res === 'atFirst') credit(w, 'atFirst');
      });
    });
    out.laterDays = spread(laterDays);
    out.intakeToReview = spread(gap);
    out.byIntake = Object.keys(intake).map(function (k) { return intake[k]; })
      .sort(function (a, b) { return (a.who.charAt(0) === '(') - (b.who.charAt(0) === '(') || b.scouts - a.scouts || (a.who < b.who ? -1 : 1); });

    // Pre-Review Call outcomes, by member (recorded from 2026-11-17 on).
    var io = {};
    events.filter(function (e) { return e.event === 'intake_outcome' && (!scope || e.date.slice(0, 4) === String(scope)); }).forEach(function (e) {
      var call = e.session ? sessions.filter(function (s) { return s.key === e.session; })[0] : sessionOn(sessions, e.recordId, 'Intake', e.date);
      (e.reps.length ? e.reps : call && call.who.length ? call.who : ['?']).forEach(function (w) {
        io[w] = io[w] || { who: w, ready: 0, changes: 0, notApproved: 0 };
        io[w][e.outcome === 'ready' ? 'ready' : e.outcome === 'changes' ? 'changes' : 'notApproved']++;
      });
    });
    out.intakeOutcomes = Object.keys(io).sort().map(function (k) { return io[k]; });
    return out;
  }

  return { compute: compute, sessionOn: sessionOn, spread: spread };
})();

if (typeof module !== 'undefined') module.exports = ReviewStats;
