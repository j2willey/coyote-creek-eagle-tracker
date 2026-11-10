/**
 * Stats page (/committee/stats; rules in lib/stats.js). Past years: the "Stats History" tab (fixed numbers, seeded from
 * the Eagle Comparisons tab; the January archive adds each finished year). This year: live from the tracking tab and
 * the schedule sheet.
 *   stats {session} -> {current, history, workload, columns}
 */
var STATS_HISTORY_TAB = 'Stats History';

function femaleColumn_() {
  var set = String(getSettings_().femaleColumn || '').trim(), cols = Records.columns();
  if (set && cols.indexOf(set) >= 0) return set;
  return cols.filter(function (c) { return /(^|[._])female$|^female/i.test(c); })[0] || '';
}

function statsRecords_() {
  var s = getSettings_(), sc = stageColumns_();
  var aCol = approvedDateColumn_(), eCol = s.eborDateColumn || 'ebor_date', fCol = femaleColumn_();
  var want = ['scout_name', 'unit', 'birth_date', aCol, eCol, sc.submitted, sc.verified, fCol, Closing.COLUMN].filter(String);
  var d = function (v) { return Intake.dateKey(v) || ''; };
  return Records.all(want).filter(function (r) { return String(r.scout_name || '').trim(); }).map(function (r) {
    return { recordId: r.recordId, section: r.section, unit: String(r.unit || '').trim(), birth: d(r.birth_date),
      ebor: d(r[eCol]), approved: aCol ? d(r[aCol]) : '', submitted: sc.submitted ? d(r[sc.submitted]) : '',
      verified: sc.verified ? d(r[sc.verified]) : '', female: fCol ? r[fCol] : '', closed: Closing.parseClosed(r[Closing.COLUMN]) };
  });
}

function actionStats_(req) {
  committeeMe_(req.session);
  var today = todayYmd_();
  var cur = Stats.current(statsRecords_(), today);
  var rows = [];
  try {
    rows = readSchedule_().rows.map(function (x) {
      return { type: Booking.typeCode(x.slot_type), start: Booking.slotStart(x.date, x.time) || 0, who: Booking.splitWho(x.reps),
        booked: !!(String(x.record_id || '').trim() || String(x.scout_name || '').trim()) };
    });
  } catch (e) { console.warn('stats schedule: ' + e); }
  return { current: cur, history: Stats.history(readTabOrEmpty_(STATS_HISTORY_TAB)).filter(function (h) { return h.year !== cur.year; }),
    workload: Stats.workload(rows, cur.year, Date.now()), femaleColumn: femaleColumn_(), today: today };
}

/**
 * January archive: add the finished year to Stats History (once). A year already there without closure numbers (a row
 * added before the Closed Records columns existed) gets them filled in, only when blank.
 */
function addStatsYear_(year) {
  try {
    var existing = readTabOrEmpty_(STATS_HISTORY_TAB).filter(function (r) { return String(r['Year']) === String(year); })[0];
    if (existing) {
      if (String(existing['Closed'] === undefined ? 'x' : existing['Closed']).trim() === '' && existing._row) {
        var cl = Closing.closuresByReason(statsRecords_(), year);
        if (cl.total) Tabs.update(STATS_HISTORY_TAB, existing._row, { 'Closed': cl.total, 'Closed Reasons': cl.reasons });
      }
      return false;
    }
    var row = Stats.historyRow(Stats.current(statsRecords_(), year + '-12-31'), 'from the tracker, ' + todayYmd_());
    var obj = {};
    Stats.HISTORY_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    Tabs.append(STATS_HISTORY_TAB, obj);
    return true;
  } catch (e) { console.warn('addStatsYear_: ' + e); return false; }
}

function seedStatsHistory_(sh) {
  sh.getRange(2, 1, Stats.HISTORY_SEED.length, Stats.HISTORY_HEADERS.length).setValues(Stats.HISTORY_SEED);
  sh.getRange(1, 1).setNote('Past years for the committee Stats page (one row per year). The current year is computed live from the ' +
    'tracking tab. Admin → archive adds each finished year in January. Fix a number here and the Stats page shows it.');
}
