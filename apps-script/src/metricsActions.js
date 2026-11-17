/**
 * Statistics history and request timings (2026-11-17). Rules in lib/events.js, lib/reviewStats.js, lib/perf.js.
 *
 *  - logEvent_: one row on the hidden "_Events" tab (Setup / repair creates it). Never throws: a missing tab or a
 *    failed write only loses statistics, never the committee's action.
 *  - recordPerf_ / flushPerf_: request timings into the script cache, summarized hourly onto the "Timings" tab.
 */
var ACTOR_ = '';            // who is acting in this request (committeeMe_ sets it); '' = system / trigger
var PERF_FLUSH_PROP = 'perfFlushedThrough';
var TIMINGS_TAB = 'Timings';

function logEvent_(e) {
  try {
    var ev = {}; Object.keys(e || {}).forEach(function (k) { ev[k] = e[k]; });
    if (!ev.by) ev.by = ACTOR_ || 'system';
    var sh = SpreadsheetApp.getActive().getSheetByName(Events.TAB);
    if (!sh) return false;                                              // not set up yet: Setup / repair
    Tabs.append(Events.TAB, Events.row(ev, new Date()));
    return true;
  } catch (err) { console.warn('logEvent_: ' + (err && err.message || err)); return false; }
}

/** The Scout's latest slot of a type on or before ymd: {key, reps} or null. */
function sessionFor_(recordId, typeCode, ymd) {
  try { var s = ReviewStats.sessionOn(statsSessions_(), String(recordId), typeCode, String(ymd || todayYmd_())); return s ? { key: s.key, reps: s.who } : null; }
  catch (e) { console.warn('sessionFor_: ' + e); return null; }
}

/** Booked Pre-Review Calls and Proposal Reviews whose time has passed, for ReviewStats. */
function statsSessions_() {
  var now = Date.now(), tz = Session.getScriptTimeZone();
  return readSchedule_().rows.map(function (x) {
    var type = Booking.typeCode(x.slot_type), start = Booking.slotStart(x.date, x.time) || 0;
    return { key: String(x._key || ''), type: type, recordId: String(x.record_id || '').trim(), start: start,
      ymd: start ? Utilities.formatDate(new Date(start), tz, 'yyyy-MM-dd') : '', who: Booking.splitWho(x.reps) };
  }).filter(function (s) { return (s.type === 'Intake' || s.type === 'ESSPPR') && s.recordId && s.start && s.start <= now; });
}

function eventsRead_() {
  try { return Events.parse(readTabOrEmpty_(Events.TAB)); } catch (e) { console.warn('events read: ' + e); return []; }
}

/** The Stats page's Reviews section: this year and all years. */
function reviewStats_(year) {
  var sessions = [];
  try { sessions = statsSessions_(); } catch (e) { console.warn('review stats schedule: ' + e); }
  var s = getSettings_(), aCol = approvedDateColumn_(), cols = Records.columns();
  var rCol = cols.indexOf(s.proposalReviewDateColumn) >= 0 ? s.proposalReviewDateColumn : '', iCol = cols.indexOf(s.preReviewDateColumn) >= 0 ? s.preReviewDateColumn : '';
  var d = function (v) { return Intake.dateKey(v) || ''; };
  var records = aCol ? Records.all([aCol, rCol, iCol].filter(String)).map(function (r) {
    return { recordId: r.recordId, approved: d(r[aCol]), reviewDate: rCol ? d(r[rCol]) : '', intakeDate: iCol ? d(r[iCol]) : '' };
  }) : [];
  var input = { sessions: sessions, records: records, events: eventsRead_() };
  return { year: ReviewStats.compute(input, String(year)), all: ReviewStats.compute(input, ''), approvedColumn: !!aCol,
    toApproval: ReviewStats.timeToApproval(records, sessions), columns: { review: rCol, intake: iCol } };
}

// ---------- timings ----------

function perfHour_(d) { return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyyMMddHH'); }

/** After each request: this request's server ms, plus the page's report on its previous request. Never throws. */
function recordPerf_(action, ms, report) {
  try {
    var cache = CacheService.getScriptCache(), k = Perf.key(perfHour_());
    cache.put(k, Perf.append(cache.get(k), [Perf.encodeServer(action, ms), Perf.encodeReport(report)]), 21600);
  } catch (e) { /* timings are best-effort: never noisy, never in the way */ }
}

/** Hourly: summarize finished hours (up to the last 5) onto the Timings tab, once each. */
function flushPerf_() {
  var props = PropertiesService.getScriptProperties();
  var done = String(props.getProperty(PERF_FLUSH_PROP) || '');
  var cache = CacheService.getScriptCache(), now = Date.now(), rows = [], last = done;
  for (var h = 5; h >= 1; h--) {
    var d = new Date(now - h * 3600000), stamp = perfHour_(d);
    if (done && stamp <= done) continue;
    var label = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:00');
    rows = rows.concat(Perf.summarize(cache.get(Perf.key(stamp)), label));
    last = stamp;
  }
  if (!rows.length) { if (last !== done) props.setProperty(PERF_FLUSH_PROP, last); return 0; }
  var sh = SpreadsheetApp.getActive().getSheetByName(TIMINGS_TAB);
  if (!sh) return 0;                                                    // Setup / repair creates it
  var head = Perf.HEADERS;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows.map(function (r) { return head.map(function (c) { return r[c]; }); }));
  props.setProperty(PERF_FLUSH_PROP, last);
  return rows.length;
}
