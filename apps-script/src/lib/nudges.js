/**
 * Nudges (Jim W., 2026-10-24): the hourly emails that keep things moving, and the digest's "Awaiting action" list. Pure.
 *   _stage_since       hidden column "<section> <YYYY-MM-DD>": when the Scout reached the stage. Reset by the hourly
 *                      job whenever the section differs, so rows moved by hand (drag) count too.
 *   4.1.h boardMissing EBoR within 7 days, unit not under review, no Unit Board Members -> unit contacts (Outbox)
 *   6.2.c pleaseBook   7 and 14 days in a To Book stage of a type booked online -> Scout + parent (Outbox)
 *   6.2.b briefings    a session within 24 h with members on it -> those members (sent)
 * Each fires once: done = {key: true} (Script Properties).
 */
var Nudges = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
  var TO_BOOK = { intake_to_book: 'Intake', review_to_book: 'ESSPPR', app_verified: 'EBoR' };
  var BOOK_WHAT = { Intake: 'a Pre-Review Call', ESSPPR: 'a Proposal Review', EBoR: 'an Eagle Board of Review (EBoR)' };

  function ymdMs(ymd) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(str(ymd)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function daysBetween(a, b) { return Math.round((ymdMs(b) - ymdMs(a)) / DAY); }

  /** records [{recordId, section, since}] -> {updates:[{recordId, value}], days:{recordId: n}}. */
  function stageSince(records, today) {
    var updates = [], days = {};
    (records || []).forEach(function (r) {
      var m = /^(\S+)\s+(\d{4}-\d\d-\d\d)$/.exec(str(r.since));
      if (!m || m[1] !== r.section) { updates.push({ recordId: r.recordId, value: r.section + ' ' + today }); days[r.recordId] = 0; }
      else days[r.recordId] = Math.max(0, daysBetween(m[2], today));
    });
    return { updates: updates, days: days };
  }

  // "Please book" reminders (6.2.c), days in the To Book stage per session type (Jim W., 2026-11-07: an EBoR can be
  // held up to 24 months after the requirements are done, so one reminder is enough there; the Proposal stages still
  // race the 18th birthday). Settings → pleaseBookDays, e.g. "Intake 7,14; ESSPPR 7,14; EBoR 7".
  var BOOK_DAYS_DEFAULT = { Intake: [7, 14], ESSPPR: [7, 14], EBoR: [7] };

  /**
   * "Intake 7,14; ESSPPR 7,14; EBoR 7" -> {Intake: [7, 14], ESSPPR: [7, 14], EBoR: [7]}. Types by code or label
   * ("Pre-Review Call", "Proposal Review", "Eagle Board of Review"); a type listed with no days = no reminders;
   * a type left out (or a blank setting) keeps its default. -> {days: {...}, errors: [text]}
   */
  function parseBookDays(text) {
    var out = {}, errors = [];
    Object.keys(BOOK_DAYS_DEFAULT).forEach(function (k) { out[k] = BOOK_DAYS_DEFAULT[k].slice(); });
    str(text).split(/\s*;\s*/).filter(Boolean).forEach(function (part) {
      var m = /^(.*?)\s*((?:\d+\s*,?\s*)*)$/.exec(part);
      var code = B().typeCode(str(m[1]));
      if (!code || !BOOK_DAYS_DEFAULT[code]) { errors.push('pleaseBookDays: unknown session type "' + str(m[1]) + '"'); return; }
      out[code] = (m[2].match(/\d+/g) || []).map(Number).filter(function (n) { return n > 0; })
        .sort(function (a, b) { return a - b; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
    });
    return { days: out, errors: errors };
  }

  /**
   * records [{recordId, section, days}], onlineCodes: types booked online, done: keys already drafted, bookDays:
   * parseBookDays().days (default if omitted). One reminder per mark reached; none from a week after the last mark
   * (the digest lists them instead). -> [{recordId, section, type, days, key}]
   */
  function pleaseBook(records, onlineCodes, done, bookDays) {
    var out = [], plan = bookDays || BOOK_DAYS_DEFAULT;
    (records || []).forEach(function (r) {
      var type = TO_BOOK[r.section];
      if (!type || (onlineCodes || []).indexOf(type) < 0) return;
      var marks = plan[type] || [];
      if (!marks.length) return;
      var reached = marks.filter(function (d) { return r.days >= d; });
      var mark = reached.length ? reached[reached.length - 1] : 0;
      if (!mark || r.days >= marks[marks.length - 1] + 7) return;
      var key = 'pb:' + r.recordId + ':' + r.section + ':' + mark;
      if ((done || {})[key]) return;
      out.push({ recordId: r.recordId, section: r.section, type: type, days: r.days, key: key });
    });
    return out;
  }

  /** slots [{key, recordId, start, section, board, underReview}] -> the ones needing 4.1.h, with key. */
  function boardMissing(slots, nowMs, days, done) {
    var lead = (Number(days) || 7) * DAY;
    return (slots || []).filter(function (x) {
      return x.recordId && x.section === 'ebor_booked' && !x.underReview && !str(x.board) &&
        x.start > nowMs && x.start - nowMs <= lead && !(done || {})['bm:' + str(x.key) + ':' + x.start];
    }).map(function (x) { var y = {}; for (var k in x) y[k] = x[k]; y.nudgeKey = 'bm:' + str(x.key) + ':' + x.start; return y; });
  }

  /** slots [{key, recordId, start, reps}] -> sessions starting within 24 h with members on them, with key. */
  function briefings(slots, nowMs, done) {
    return (slots || []).filter(function (x) {
      return x.recordId && str(x.reps) && x.start > nowMs && x.start - nowMs <= 24 * HOUR && !(done || {})['br:' + str(x.key) + ':' + x.start];
    }).map(function (x) { var y = {}; for (var k in x) y[k] = x[k]; y.nudgeKey = 'br:' + str(x.key) + ':' + x.start; return y; });
  }

  /**
   * The digest's "Awaiting action" list, most urgent first; empty groups dropped.
   * a: {files, outbox, boards, unstaffed:[{what, when, booked}], reserved:[{what, when}], reviews, intake, unitRequests, council,
   *     toBook:[{title, stage, days, type}], closeReview:[{title, why}], openSlots} -> [{title, items:[text]}]
   * toBook is split into one group per session type (type = Intake | ESSPPR | EBoR).
   */
  function awaiting(a) {
    a = a || {};
    var age = function (d) { return d === 0 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
    var g = [
      { title: 'New files to check', items: (a.files || []).map(function (w) { return w.title + ', waiting ' + age(w.days); }) },
      { title: 'Council applications to check (tick Checked on the Council Applications tab when done)',
        items: (a.councilApps || []).map(function (x) { return x.title + ': ' + x.why; }) },
      { title: 'Proposal signatures waiting (Record outcomes page: add a signature, or finish with the signatures there are)',
        items: (a.signing || []).map(function (x) { return x.title + ': waiting on ' + x.waiting + ', ' + age(x.days); }) },
      { title: 'Emails waiting in the Outbox', items: (a.outbox || []).map(function (o) { return o.title + (o.days ? ', ' + age(o.days) : ''); }) },
      { title: 'Eagle Boards of Review short of members (fewer than 3)', items: (a.boards || []).map(function (b) { return b.title + ', ' + b.when + ': ' + b.size + ' on the board'; }) },
      { title: 'Sessions with no committee member (not bookable until one signs up)', items: (a.unstaffed || []).map(function (x) { return x.what + ', ' + x.when + (x.booked ? ': a Scout is booked' : ''); }) },
      { title: 'Reserved slots with no Scout yet', items: (a.reserved || []).map(function (x) { return x.what + ', ' + x.when; }) },
      { title: 'Reviews with no outcome yet', items: (a.reviews || []).map(function (r) { return r.title + ', held ' + r.when; }) },
      { title: 'Web submissions held', items: (a.intake || []).map(function (x) { return x.title + ': ' + x.why; }) },
      { title: 'Unit requests', items: (a.unitRequests || []).map(function (x) { return x.title; }) },
      { title: 'EBoR paperwork not yet acknowledged by Council', items: (a.council || []).map(function (w) { return w.title + ', sent ' + (w.days ? age(w.days) + ' ago' : 'today'); }) }
    ].concat(['Intake', 'ESSPPR', 'EBoR'].map(function (type) {                // one group per session type
      return { title: 'Scouts waiting to book ' + BOOK_WHAT[type], items: (a.toBook || []).filter(function (x) { return x.type === type; })
        .sort(function (x, y) { return y.days - x.days; }).map(function (x) { return x.title + ': ' + x.stage + ', ' + age(x.days); }) };
    })).concat([
      { title: 'Exceptions to review (' + (a.closeReview || []).length + '): Close record…, or Keep open in the dashboard Action menu',
        items: (a.closeReview || []).map(function (x) { return x.title + ': ' + x.why; }) },
      { title: 'Open times (next 30 days)', items: (a.openSlots || []).map(function (x) { return x.label + ': ' + x.count + (x.next ? ' (next ' + x.next + ')' : ''); }) }
    ]);
    return g.filter(function (x) { return x.items.length; });
  }

  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }

  /**
   * Digest "Reviews with no outcome yet": booked sessions held (2 h to 60 days ago) whose Scout is still in the Booked
   * stage FOR THAT TYPE. Jim W., 2026-10-29: a Pre-Review Call was listed after the Scout had moved on and booked the
   * In-Person Review (any Booked stage used to count). rows: schedule rows; sectionOf(recordId) -> section or ''.
   * -> [{recordId, type, start}]
   */
  function reviewsDue(rows, sectionOf, nowMs) {
    return (rows || []).map(function (r) {
      var id = str(r.record_id), type = B().typeCode(r.slot_type), rule = B().rules(type);
      var st = B().slotStart(r.date, r.time) || 0;
      if (!id || !rule || !st || !(st < nowMs - 2 * 3600 * 1000 && st > nowMs - 60 * DAY)) return null;
      return sectionOf(id) === rule.movesTo ? { recordId: id, type: type, start: st } : null;
    }).filter(Boolean);
  }

  return { TO_BOOK: TO_BOOK, stageSince: stageSince, pleaseBook: pleaseBook, parseBookDays: parseBookDays, BOOK_DAYS_DEFAULT: BOOK_DAYS_DEFAULT, boardMissing: boardMissing, briefings: briefings,
    awaiting: awaiting, daysBetween: daysBetween, reviewsDue: reviewsDue };
})();

if (typeof module !== 'undefined') module.exports = Nudges;
