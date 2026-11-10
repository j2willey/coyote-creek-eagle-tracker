/**
 * Stats (Jim W., 2026-10-24): the committee's statistics page, the web version of the "Eagle Comparisons" tab.
 * Past years come from the "Stats History" tab (fixed numbers); the current year is computed live here. Pure.
 *
 * records: [{recordId, section, unit, birth, ebor, approved, submitted, verified, female, closed ({reason, date})}] dates 'YYYY-MM-DD'.
 */
var Stats = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAY = 86400000;
  function ms(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function days(a, b) { var x = ms(a), y = ms(b); return x === null || y === null ? null : Math.round((y - x) / DAY); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function median(list) {
    if (!list.length) return null;
    var s = list.slice().sort(function (a, b) { return a - b; }), h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2);
  }

  /** Age in years at a date (one decimal, rounded down), like the dashboard. */
  function age(birth, at) {
    var b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(birth)), a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(at));
    if (!b || !a) return null;
    var ad = Date.UTC(+a[1], +a[2] - 1, +a[3]);
    var bday = function (y) { return Date.UTC(y, +b[2] - 1, +b[3]); };
    var years = +a[1] - +b[1];
    if (bday(+a[1]) > ad) years--;
    if (years < 0) return null;
    var last = bday(+b[1] + years), next = bday(+b[1] + years + 1);
    return Math.floor((years + (ad - last) / (next - last)) * 10) / 10;
  }

  /** The Female column: a checkbox, Y/Yes/X/F/Female count; blank, No, M, Male don't. */
  function isFemale(v) {
    if (v === true) return true;
    return ['true', 'yes', 'y', 'x', 'f', 'female', '1'].indexOf(str(v).toLowerCase()) >= 0;
  }

  var PIPELINE = [
    { key: 'proposals_new', label: 'Proposals received, being checked', sections: ['proposal_received', 'proposal_incomplete'] },
    { key: 'to_schedule', label: 'Proposals waiting to be scheduled (Pre-Review Call or Proposal Review)', sections: ['intake_to_book', 'review_to_book'] },
    { key: 'under_review', label: 'Proposals under review (booked, or revisions requested)', sections: ['intake_booked', 'intake_revisions', 'review_booked', 'proposal_revisions'] },
    { key: 'approved', label: 'Proposals approved, project not yet submitted to Council', sections: ['proposal_approved'] },
    { key: 'submitted', label: 'Eagle applications submitted, not yet verified', sections: ['app_submitted'] },
    { key: 'verified', label: 'Applications verified by Council, EBoR not yet booked', sections: ['app_verified'] },
    { key: 'booked', label: 'EBoRs booked', sections: ['ebor_booked'] },
    { key: 'paused', label: 'EBoRs paused', sections: ['ebor_paused'] }
  ];

  /** Closed records by reason (lib/closing.js; closing.js is loaded first in Node, called only inside functions). */
  function closuresByReason(records, year) {
    var C = typeof Closing !== 'undefined' ? Closing : require('./closing.js');
    return C.closuresByReason(records, year);
  }

  /** The current year, live. today 'YYYY-MM-DD'. */
  function current(records, today) {
    var year = str(today).slice(0, 4), recs = records || [];
    var eagles = recs.filter(function (r) { return r.section === 'eagle_earned' && str(r.ebor).slice(0, 4) === year; });
    var monthly = MONTHS.map(function (m, i) {
      var mm = (i < 9 ? '0' : '') + (i + 1);
      return eagles.filter(function (r) { return str(r.ebor).slice(5, 7) === mm; }).length;
    });
    var ages = eagles.map(function (r) { return age(r.birth, r.ebor); }).filter(function (a) { return a !== null; });
    var female = eagles.filter(function (r) { return isFemale(r.female); }).length;
    var annual = {
      year: year, total: eagles.length, female: female, femalePct: eagles.length ? round1(100 * female / eagles.length) : null,
      avgAge: ages.length ? round1(ages.reduce(function (s, a) { return s + a; }, 0) / ages.length) : null,
      minAge: ages.length ? Math.min.apply(null, ages) : null, maxAge: ages.length ? Math.max.apply(null, ages) : null,
      approved: recs.filter(function (r) { return str(r.approved).slice(0, 4) === year; }).length,
      missingAge: eagles.length - ages.length
    };
    // Future EBoRs by month
    var future = {};
    recs.forEach(function (r) {
      if (r.section !== 'ebor_booked' || !str(r.ebor) || str(r.ebor) < str(today)) return;
      var k = str(r.ebor).slice(0, 7);
      future[k] = (future[k] || 0) + 1;
    });
    var futureList = Object.keys(future).sort().map(function (k) { return { month: MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4), count: future[k] }; });
    var undated = recs.filter(function (r) { return r.section === 'ebor_booked' && !str(r.ebor); }).length;
    // Pipeline
    var pipeline = PIPELINE.map(function (p) {
      return { key: p.key, label: p.label, count: recs.filter(function (r) { return p.sections.indexOf(r.section) >= 0; }).length };
    });
    // Proposal Approved (still open) by approval year
    var openBy = {};
    recs.forEach(function (r) {
      if (r.section !== 'proposal_approved') return;
      var y = str(r.approved).slice(0, 4) || 'no date';
      openBy[y] = (openBy[y] || 0) + 1;
    });
    // Throughput
    var toEagle = eagles.map(function (r) { return days(r.approved, r.ebor); }).filter(function (d) { return d !== null && d >= 0; });
    var council = recs.map(function (r) { return days(r.submitted, r.verified); })
      .filter(function (d) { return d !== null && d >= 0 && d < 365; });
    // Age-out watch: 17.5+ and not an Eagle yet (open stages only)
    var CLOSED = ['eagle_earned', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved', 'closed'];
    var watch = recs.filter(function (r) { return CLOSED.indexOf(r.section) < 0; }).map(function (r) { return { r: r, a: age(r.birth, today) }; })
      .filter(function (x) { return x.a !== null && x.a >= 17.5 && x.a < 18; });
    var watchBy = {};
    watch.forEach(function (x) { watchBy[x.r.section] = (watchBy[x.r.section] || 0) + 1; });
    // Eagles by unit
    var byUnit = {};
    // A Scout in several units counts for the primary (first) unit only (2026-11-01).
    eagles.forEach(function (r) { var u = str(r.unit).split(/\s*[\/,;&+\n]+\s*|\s+(?=[A-Za-z]+\s*-?\s*\d)/)[0] || '?'; byUnit[u] = (byUnit[u] || 0) + 1; });
    return {
      year: year, monthly: monthly, annual: annual, future: futureList, futureUndated: undated, pipeline: pipeline,
      openByYear: Object.keys(openBy).sort().map(function (y) { return { year: y, count: openBy[y] }; }),
      throughput: {
        approvalToEagle: { median: median(toEagle), n: toEagle.length, min: toEagle.length ? Math.min.apply(null, toEagle) : null, max: toEagle.length ? Math.max.apply(null, toEagle) : null },
        councilVerify: { median: median(council), n: council.length }
      },
      ageWatch: { count: watch.length, bySection: watchBy },
      closures: closuresByReason(recs, year),               // Closed records (lib/closing.js): this year by reason
      byUnit: Object.keys(byUnit).map(function (u) { return { unit: u, count: byUnit[u] }; })
        .sort(function (a, b) { return b.count - a.count || a.unit.localeCompare(b.unit); })
    };
  }

  /**
   * Committee sessions held this year by month and type, and by member, from schedule rows
   * [{type ('Intake'|'ESSPPR'|'EBoR'), start (ms), who: [initials], booked: bool}], counting only booked past sessions.
   */
  function workload(rows, year, nowMs) {
    var types = ['Intake', 'ESSPPR', 'EBoR'], byMonth = MONTHS.map(function () { return { Intake: 0, ESSPPR: 0, EBoR: 0 }; }), byMember = {};
    (rows || []).forEach(function (x) {
      if (!x.booked || !x.start || x.start > nowMs || types.indexOf(x.type) < 0) return;
      var d = new Date(x.start);
      if (String(d.getFullYear()) !== String(year)) return;
      byMonth[d.getMonth()][x.type]++;
      (x.who || []).forEach(function (w) { w = str(w).toUpperCase(); if (!w) return; byMember[w] = byMember[w] || { Intake: 0, ESSPPR: 0, EBoR: 0 }; byMember[w][x.type]++; });
    });
    return { byMonth: byMonth, byMember: Object.keys(byMember).sort().map(function (k) {
      var m = byMember[k]; return { who: k, Intake: m.Intake, ESSPPR: m.ESSPPR, EBoR: m.EBoR, total: m.Intake + m.ESSPPR + m.EBoR };
    }).sort(function (a, b) { return b.total - a.total; }) };
  }

  /** Stats History rows -> [{year, total, female, avgAge, minAge, maxAge, approved, monthly[12] (null = unknown)}]. */
  function history(rows) {
    var num = function (v) { var s = str(v); if (s === '' || /^(n\/a|unk\.?|-)$/i.test(s)) return null; var n = Number(s); return isNaN(n) ? null : n; };
    return (rows || []).filter(function (r) { return /^\d{4}$/.test(str(r['Year'])); }).map(function (r) {
      return { year: str(r['Year']), total: num(r['Total Eagles']), female: num(r['Female Eagles']), avgAge: num(r['Avg Age']),
        minAge: num(r['Min Age']), maxAge: num(r['Max Age']), approved: num(r['Projects Approved']),
        monthly: MONTHS.map(function (m) { return num(r[m.slice(0, 3)]); }),
        closed: num(r['Closed']), closedReasons: str(r['Closed Reasons']) };
    }).sort(function (a, b) { return a.year.localeCompare(b.year); });
  }

  // Seed for the Stats History tab: the committee's "Eagle Comparisons" tab as of 2026-10-24 (aggregates only).
  var HISTORY_HEADERS = ['Year', 'Total Eagles', 'Female Eagles', 'Avg Age', 'Min Age', 'Max Age', 'Projects Approved',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Note', 'Closed', 'Closed Reasons'];
  var HISTORY_SEED = [
    [2020, 36, 'N/A', 'unk.', 'unk.', 'unk.', 27, '', '', '', '', '', '', '', '', '', '', '', '', 'from Eagle Comparisons'],
    [2021, 97, 9, 17.4, 14.4, 21.3, 94, 2, 7, 9, 8, 7, 6, 3, 8, 7, 16, 12, 12, 'from Eagle Comparisons'],
    [2022, 93, 6, 17.5, 14.4, 19.1, 67, 12, 10, 7, 7, 6, 8, 6, 9, 4, 7, 9, 8, 'from Eagle Comparisons'],
    [2023, 65, 9, 17.6, 15.3, 19.2, 77, 1, 3, 5, 5, 7, 3, 5, 8, 6, 6, 10, 6, 'from Eagle Comparisons'],
    [2024, 95, 13, 17.4, 13.0, 18.9, 117, 5, 4, 5, 7, 8, 10, 9, 6, 11, 18, 12, 0, 'from Eagle Comparisons'],
    [2025, 87, 14, 17.5, 14.1, 19.3, 81, 3, 4, 5, 7, 8, 12, 4, 7, 6, 13, 8, 10, 'from Eagle Comparisons']
  ].map(function (r) { return r.concat(['', '']); });         // Closed, Closed Reasons: not tracked before 2026

  /** A finished year as a Stats History row (the January archive adds it). */
  function historyRow(cur, note) {
    var a = cur.annual;
    var c = cur.closures || { total: '', reasons: '' };
    return [Number(cur.year), a.total, a.female, a.avgAge, a.minAge, a.maxAge, a.approved].concat(cur.monthly).concat([note || '', c.total, c.reasons]);
  }

  return { MONTHS: MONTHS, PIPELINE: PIPELINE, age: age, isFemale: isFemale, median: median, current: current, workload: workload,
    history: history, HISTORY_HEADERS: HISTORY_HEADERS, HISTORY_SEED: HISTORY_SEED, historyRow: historyRow };
})();

if (typeof module !== 'undefined') module.exports = Stats;
