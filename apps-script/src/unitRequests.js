/**
 * Unit-hosted boards (Jim W., 2026-10-24): a unit contact proposes holding a Scout's EBoR on the unit's meeting
 * night. Kept on the "Unit Requests" tab; the committee sees it on the Admin page and in the digest, and marks it Done
 * once the slot is on the schedule.
 *   hostRequest      {session, scout, date, time, place, note}   (unit contacts) -> {message}
 *   adminRequestDone {session, id}                               (committee)     -> {message}
 */
var UNIT_REQUESTS_TAB = 'Unit Requests';

function openUnitRequests_() {
  var rows = [];
  try { rows = Tabs.read(UNIT_REQUESTS_TAB); } catch (e) { return []; }
  return rows.filter(function (r) { return String(r['Status'] || '') === 'Open'; }).map(function (r) {
    var d = r['Date'] instanceof Date ? Utilities.formatDate(r['Date'], digestTz_(), 'EEE M/d') : String(r['Date'] || '');
    var sub = r['Submitted'] instanceof Date ? r['Submitted'].getTime() : Date.parse(r['Submitted']) || 0;
    return { id: String(r['Id']), unit: String(r['Unit'] || ''), from: String(r['From'] || ''), scout: String(r['Scout'] || ''),
      recordId: String(r['Record ID'] || ''), date: d, time: String(r['Time'] || ''), place: String(r['Place'] || ''),
      note: String(r['Note'] || ''), submitted: sub };
  });
}

function actionHostRequest_(req) {
  var me = myUnits_(req.session);
  var name = String(req.scout || '').trim();
  var date = String(req.date || '').trim(), time = String(req.time || '').trim();
  if (!name) throw userError_('Pick the Scout.');
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw userError_('Pick the date.');
  if (date < todayYmd_()) throw userError_('That date has passed.');
  if (!time) throw userError_('Enter the time.');
  var scouts = unitScouts_(me.units);
  var hit = scouts.filter(function (x) { return x.name === name; })[0];
  if (!hit) throw userError_('That Scout is not on your unit\'s list.');
  var rec = Records.all(['scout_name', 'unit']).filter(function (r) { return String(r.scout_name || '').trim() === name && String(r.unit) === hit.unit; })[0];
  var id = 'UR-' + Utilities.formatDate(new Date(), digestTz_(), 'yyMMddHHmmss');
  withLock_(function () {
    Tabs.append(UNIT_REQUESTS_TAB, { 'Id': id, 'Submitted': new Date(), 'Unit': hit.unit, 'From': me.email, 'Scout': name,
      'Record ID': rec ? rec.recordId : '', 'Date': date, 'Time': time, 'Place': String(req.place || '').trim().slice(0, 200),
      'Note': String(req.note || '').trim().slice(0, 1000), 'Status': 'Open' });
  });
  if (rec) addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [unit] ' + hit.unit + ' asked to host the EBoR on ' + date + ' ' + time +
    (req.place ? ' at ' + String(req.place).trim() : ''));
  notifyCommittee_('Unit request: host the EBoR for ' + name + ' (' + hit.unit + ')',
    me.email + ' asked to hold the Eagle Board of Review for ' + name + ' at the unit:\n\n' +
    'When: ' + date + ' ' + time + '\nWhere: ' + (String(req.place || '').trim() || '(not given)') + '\nNote: ' + (String(req.note || '').trim() || '-') + '\n\n' +
    'Add the slot on the schedule, then mark the request Done on the Admin page: ' + committeeUrl_() + '/admin');
  return { message: 'Thank you. The committee has your request and will confirm by email.' };
}

function actionAdminRequestDone_(req) {
  var c = committeeMe_(req.session);
  var id = String(req.id || '');
  var row = Tabs.read(UNIT_REQUESTS_TAB).filter(function (r) { return String(r['Id']) === id; })[0];
  if (!row) throw userError_('That request is no longer on the Unit Requests tab. Reload the page.');
  withLock_(function () { Tabs.update(UNIT_REQUESTS_TAB, row._row, { 'Status': 'Done', 'Done': new Date(), 'Done by': c.email }); });
  adminLog_('Unit request ' + id + ' (' + row['Unit'] + ', ' + row['Scout'] + ') done', c.email);
  return { message: 'Marked done.' };
}
