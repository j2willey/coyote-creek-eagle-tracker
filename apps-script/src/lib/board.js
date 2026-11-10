/**
 * Board: the committee dashboard's tabs (Jim W., 2026-10-23). Pure.
 *
 * One read of the tracking tab, split into tabs; inside a tab, Scouts are grouped by stage in sheet order
 * (= order of arrival). Columns per tab: Candidate, Unit, Age, and the dates that matter there, plus the first
 * line of the Notes cell. Age = birth date to today; for Eagles it is fixed at the EBoR date (age the rank was earned).
 * Waiting on Council (derived, no column of its own): signed EBoR paperwork sent (date) but SVMBC Received empty.
 */
var Board = (function () {
  var TABS = [
    { key: 'proposals', label: 'Proposals', cols: ['session'], sections: ['proposal_received', 'proposal_incomplete', 'intake_to_book',
      'intake_booked', 'intake_revisions', 'review_to_book', 'review_booked', 'proposal_revisions'] },
    { key: 'underway', label: 'Underway', cols: ['approved'], sections: ['proposal_approved'] },
    { key: 'ebors', label: 'EBoRs', cols: ['ebor'], sections: ['app_submitted', 'app_verified', 'ebor_booked'] },
    { key: 'eagles', label: 'Eagles', cols: ['ebor'], sections: ['eagle_earned'], ageAt: 'ebor' },
    { key: 'exceptions', label: 'Exceptions', cols: ['approved', 'ebor'], stage: true,
      sections: ['ebor_paused', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved'] }
  ];

  function str(v) { return v == null ? '' : String(v).trim(); }
  /** 'Theodore Sample ("Teddy")' (Preferred Name, 2026-11-04; same rule as EagleDone.display). */
  function display(name, pref) {
    var p = str(String(pref == null ? '' : pref).split(';')[0]);
    return p && p.toLowerCase() !== str(name).toLowerCase() ? str(name) + ' ("' + p + '")' : str(name);
  }
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }
  // The booked session a stage is about (Jim W., 2026-11-03): its date links to the session on the schedule page.
  var SESSION_OF = { intake_booked: 'Intake', review_booked: 'ESSPPR', ebor_booked: 'EBoR' };
  var EBOR_SECTIONS = ['ebor_booked', 'ebor_paused'];
  var BOARD_MIN = 3, BOARD_MAX = 6;

  /** Age in years, one decimal, rounded DOWN (17.96 shows 17.9, never 18.0 before the birthday). Dates 'YYYY-MM-DD'. */
  function age(birthYmd, atYmd) {
    var b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(birthYmd)), a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(atYmd));
    if (!b || !a) return null;
    var ad = Date.UTC(+a[1], +a[2] - 1, +a[3]);
    if (ad < Date.UTC(+b[1], +b[2] - 1, +b[3])) return null;
    // Whole years by the calendar (exact on birthdays), then the fraction of the current year of age.
    var years = +a[1] - +b[1];
    var bday = function (y) { return Date.UTC(y, +b[2] - 1, +b[3]); };
    if (bday(+a[1]) > ad) years--;
    var last = bday(+b[1] + years), next = bday(+b[1] + years + 1);
    return Math.floor((years + (ad - last) / (next - last)) * 10) / 10;
  }

  function days(fromYmd, toYmd) {
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(fromYmd)), t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(toYmd));
    if (!f || !t) return null;
    return Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - Date.UTC(+f[1], +f[2] - 1, +f[3])) / 86400000);
  }

  /** Paperwork sent, no acknowledgement: days waiting, else null. received: the SVMBC Received cell (any mark counts). */
  function councilWait(sentYmd, received, today) {
    var r = received === true || (received !== false && str(received) !== '' && str(received).toUpperCase() !== 'FALSE');
    return str(sentYmd) && !r ? Math.max(0, days(sentYmd, today) || 0) : null;
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ym(ymd) { var m = /^(\d{4})-(\d{2})/.exec(str(ymd)); return m ? +m[1] * 12 + (+m[2] - 1) : null; }

  /** EBoR Date vs today, like the sheet's colours: 'past' | 'this' (this month, still to come) | 'next' (next month) | 'later' | ''. */
  function eborBand(eborYmd, today) {
    var e = ym(eborYmd), t = ym(today);
    if (e === null || t === null) return '';
    if (str(eborYmd) < str(today)) return 'past';
    return e === t ? 'this' : e === t + 1 ? 'next' : 'later';
  }

  /** EBoR Booked summary: {thisMonth, next, later, past, none, thisLabel, nextLabel}. */
  function monthCounts(rows, today) {
    var t = ym(today), out = { thisMonth: 0, next: 0, later: 0, past: 0, none: 0,
      thisLabel: t === null ? '' : MONTHS[t % 12], nextLabel: t === null ? '' : MONTHS[(t + 1) % 12] };
    (rows || []).forEach(function (r) {
      var b = eborBand(r.ebor, today);
      if (b === 'this') out.thisMonth++; else if (b === 'next') out.next++; else if (b === 'later') out.later++; else if (b === 'past') out.past++; else out.none++;
    });
    return out;
  }

  /**
   * Each Scout's NEXT booked session of each type, from the schedule rows. A session started less than 12 hours ago
   * still counts (tonight's board), and an older or duplicate row never hides a later one.
   * -> {recordId: {Intake|ESSPPR|EBoR: {key, start (ms), reps: [initials], row}}}
   */
  function nextSessions(rows, nowMs) {
    var out = {};
    (rows || []).forEach(function (x) {
      var id = str(x.record_id), code = B().typeCode(x.slot_type), st = B().slotStart(x.date, x.time) || 0;
      if (!id || !str(x._key) || ['Intake', 'ESSPPR', 'EBoR'].indexOf(code) < 0 || !(st > nowMs - 12 * 3600 * 1000)) return;
      var m = out[id] = out[id] || {};
      if (m[code] && m[code].start <= st) return;
      m[code] = { key: str(x._key), start: st, reps: B().splitWho(x.reps), row: x };
    });
    return out;
  }

  /** First line of the Notes cell (the newest log line). */
  function firstLine(notes) { return str(String(notes == null ? '' : notes).split(/\r?\n/)[0]); }

  /**
   * records: [{recordId, section, scout_name, unit, birth, approved, ebor ('YYYY-MM-DD'), notes, pending (ms), folderId}]
   * in sheet order. sections: settings.sections (labels). -> [{key, label, cols, stage, count, pending, groups:[{key, label, rows}]}]
   */
  function build(records, sections, today, ackDays) {
    var overdueAfter = Number(ackDays) || 7;
    var label = {};
    (sections || []).forEach(function (s) { label[s.key] = s.label || s.key; });
    return TABS.map(function (t) {
      var groups = t.sections.map(function (k) { return { key: k, label: label[k] || k, rows: [] }; });
      (records || []).forEach(function (r) {
        var g = groups.filter(function (x) { return x.key === r.section; })[0];
        if (!g || !str(r.scout_name)) return;
        var at = t.ageAt === 'ebor' ? (str(r.ebor) || today) : today;
        g.rows.push({ recordId: r.recordId, name: display(r.scout_name, r.preferred_name), unit: str(r.unit), age: age(r.birth, at),
          approved: str(r.approved), ebor: str(r.ebor), note: firstLine(r.notes), pending: r.pending > 0,
          folder: str(r.folderId) ? 'https://drive.google.com/drive/folders/' + str(r.folderId) : '',
          councilSent: str(r.signedSent), councilWait: councilWait(r.signedSent, r.svmbcReceived, today),
          councilOverdue: (councilWait(r.signedSent, r.svmbcReceived, today) || 0) >= overdueAfter,
          band: EBOR_SECTIONS.indexOf(r.section) >= 0 ? eborBand(r.ebor, today) : '',
          // EBoR Booked: unit under review (committee fills the board) / no Unit Board Members yet (4.1.h)
          underReview: r.section === 'ebor_booked' && !!r.underReview,
          unitReview: !!r.underReview,                     // any stage: the Unit cell is highlighted
          // (only for boards this month or next: units usually add members a few weeks ahead)
          // Board size (district/council + unit), 3..6: 'short' (<3) | 'ok' | 'big' (>6); '' when no slot is booked
          eagleNumber: str(r.eagleNumber),                 // EBoR Booked: "110th Eagle Scout of Troop 910" to announce
          // Booked stages: the next session of that type {key, start, reps (initials), names}; links to the schedule page
          session: session(r),
          // Proposal Approved with committee signatures still out (Signing column): {waiting: ['CD'], since, signed}
          signing: r.section === 'proposal_approved' && r.signing ? r.signing : null,
          formsite: r.formsite && str(r.formsite.why) ? { why: str(r.formsite.why), folder: str(r.formsite.folder) } : null,
          boardSize: r.section === 'ebor_booked' && typeof r.boardSize === 'number' ? r.boardSize : null,
          boardState: r.section === 'ebor_booked' && typeof r.boardSize === 'number'
            ? (r.boardSize < BOARD_MIN ? 'short' : r.boardSize > BOARD_MAX ? 'big' : 'ok') : '' });
      });
      groups.forEach(function (g) { if (g.key === 'ebor_booked') g.months = monthCounts(g.rows, today); });
      var rows = groups.reduce(function (n, g) { return n + g.rows.length; }, 0);
      var pend = groups.reduce(function (n, g) { return n + g.rows.filter(function (x) { return x.pending; }).length; }, 0);
      var council = groups.reduce(function (n, g) { return n + g.rows.filter(function (x) { return x.councilWait !== null; }).length; }, 0);
      return { key: t.key, label: t.label, cols: t.cols, stage: !!t.stage, ageLocked: t.ageAt === 'ebor',
        count: rows, pending: pend, council: council, groups: groups };
    });
  }

  function session(r) {
    var s = SESSION_OF[r.section] && r.sessions ? r.sessions[SESSION_OF[r.section]] : null;
    return s && str(s.key) ? { key: str(s.key), start: Number(s.start) || 0, reps: (s.reps || []).map(str).filter(Boolean),
      names: (s.names || []).map(str).filter(Boolean) } : null;
  }

  /** Every row waiting on Council, oldest first: [{title, sentYmd, days, overdue}] (dashboard strip + digest). */
  function councilWaiting(tabs) {
    var out = [];
    (tabs || []).forEach(function (t) { t.groups.forEach(function (g) { g.rows.forEach(function (r) {
      if (r.councilWait !== null) out.push({ title: r.name + (r.unit ? ' (' + r.unit + ')' : ''), sentYmd: r.councilSent, days: r.councilWait, overdue: r.councilOverdue });
    }); }); });
    return out.sort(function (a, b) { return b.days - a.days; });
  }

  return { TABS: TABS, age: age, firstLine: firstLine, build: build, councilWait: councilWait, councilWaiting: councilWaiting,
    eborBand: eborBand, monthCounts: monthCounts, nextSessions: nextSessions, SESSION_OF: SESSION_OF };
})();

if (typeof module !== 'undefined') module.exports = Board;
