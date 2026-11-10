/**
 * Unit Contacts (EBoR workflow): an adult listed on the Key 3 or Unit Contacts tab signs in
 * with the same emailed link as Scouts and sees the upcoming EBoRs of EVERY
 * unit they are a contact for. Units not under review can set their Unit
 * Board Members (name, email, phone), stored in the schedule's Board Members
 * cell and added to the invite. They see only Scout name, unit, date, place.
 *
 * Router actions:
 *   unitEbors {session}                     -> {ebors:[{key, scoutName, unit, when, where, canEdit, board}]}
 *   saveBoard {session, slotKey, members}   -> {message, board}
 */
function myUnits_(session) {
  var email = sessionEmail_(session);
  var mine = Units.forEmail(units_(), email);
  if (!mine.length) throw userError_('This email address is not listed as a contact for any unit.');
  return { email: email, units: mine };
}

/** Upcoming EBoR bookings for the given units. */
function unitEborRows_(units) {
  var codes = units.map(function (u) { return u.code; });
  var out = [];
  readSchedule_().rows.forEach(function (row) {
    if (Booking.typeCode(row.slot_type) !== Booking.EBOR || !String(row.record_id || '').trim()) return;
    var start = Booking.slotStart(row.date, row.time);
    if (!(start > Date.now() - 3600 * 1000)) return;
    var rec = Records.get(String(row.record_id));
    if (!rec) return;
    // Every unit the Scout is in sees the board; only the primary (first) unit sets the Unit Board Members (2026-11-01).
    var mine = Units.codes(rec.fields.unit).filter(function (c) { return codes.indexOf(c) >= 0; });
    if (!mine.length) return;
    var primary = Units.primary(rec.fields.unit);
    var c = mine.indexOf(primary) >= 0 ? primary : mine[0];
    var u = units.filter(function (x) { return x.code === c; })[0];
    out.push({ row: row, rec: rec, unit: u, start: start, primary: c === primary, primaryLabel: Units.label(primary) });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

function actionUnitEbors_(req) {
  var me = myUnits_(req.session);
  var ebors = unitEborRows_(me.units).map(function (x) {
    return { key: String(x.row._key), scoutName: String(x.rec.fields.scout_name), unit: x.unit.unit,
      when: whenText_(x.start), where: Booking.place(x.row), canEdit: x.primary && !x.unit.underReview,
      notPrimary: x.primary ? '' : x.primaryLabel,
      board: x.unit.underReview ? [] : Units.parseBoard(x.row.board_members) };
  });
  return { units: me.units.map(function (u) { return { unit: u.unit, code: u.code, underReview: u.underReview }; }), ebors: ebors,
    scouts: getSettings_().unitPipeline === false ? null : unitScouts_(me.units),
    committeeEmail: getSettings_().committeeGroupEmail || '' };
}

function actionSaveBoard_(req) {
  var me = myUnits_(req.session);
  var v = Units.validateBoard(req.members);
  if (!v.ok) throw userError_(v.errors.join(' '));
  var hit = unitEborRows_(me.units).filter(function (x) { return String(x.row._key) === String(req.slotKey || ''); })[0];
  if (!hit) throw userError_('That Eagle Board of Review is no longer listed for your unit.');
  if (!hit.primary) throw userError_('Only ' + hit.primaryLabel + ', ' + String(hit.rec.fields.scout_name) + '\'s primary unit, sets the Unit Board Members.');
  if (hit.unit.underReview) throw userError_('Your unit is under review: Unit Board Members are arranged by the committee. Please email the committee.');
  var cell = Units.formatBoard(v.members);
  withLock_(function () {
    var sched = readSchedule_();
    var row = sched.rows.filter(function (r) { return String(r._key) === String(req.slotKey); })[0];
    if (!row || String(row.record_id) !== hit.rec.recordId) throw userError_('That booking changed. Please reload the page.');
    writeSchedule_(sched, row._row, { board_members: cell });
  });
  addRecordNote_(hit.rec.recordId, Intake.shortDate(new Date()) + ' [unit] Unit Board Members set by ' + me.email + ': ' +
    (v.members.map(function (m) { return m.name; }).join(', ') || '(none)'));
  try { syncInvites_(); } catch (e) { console.warn('saveBoard sync: ' + e); }
  var total = Units.boardSize(hit.row.reps, cell, Booking.splitWho);
  var size = total < Units.BOARD_MIN ? ' The board now has ' + total + ' member' + (total === 1 ? '' : 's') + ' with the district members; an Eagle Board of Review needs at least ' + Units.BOARD_MIN + '.'
    : total > Units.BOARD_MAX ? ' The board list now has ' + total + ' people; a board has at most ' + Units.BOARD_MAX + ' members. Guests (Eagle coach, leaders) are welcome to observe; the committee will confirm who sits on the board.' : '';
  return { message: 'Saved. Board members with an email address will receive the calendar invitation.' + size, board: v.members };
}

/**
 * "Your unit's Eagle candidates" (Jim W., 2026-10-24): read-only, so unit leaders can nudge during the quiet period.
 * Name, stage, age, approval date; never committee notes. Active stages only (not Eagles, not closed).
 * Settings → unitPipeline FALSE hides it.
 */
var UNIT_PIPELINE_SECTIONS_ = ['proposal_received', 'proposal_incomplete', 'intake_to_book', 'intake_booked', 'intake_revisions',
  'review_to_book', 'review_booked', 'proposal_revisions', 'proposal_approved', 'app_submitted', 'app_verified', 'ebor_booked',
  'ebor_paused', 'beyond_age'];
function unitScouts_(units) {
  var s = getSettings_();
  var codes = units.map(function (u) { return u.code; });
  var aCol = approvedDateColumn_();
  var order = {};
  (s.sections || []).forEach(function (x, i) { order[x.key] = i; });
  var today = todayYmd_();
  return Records.all(['scout_name', 'unit', 'birth_date', aCol].filter(String))
    .filter(function (r) { return UNIT_PIPELINE_SECTIONS_.indexOf(r.section) >= 0 && String(r.scout_name || '').trim() && Units.codes(r.unit).some(function (c) { return codes.indexOf(c) >= 0; }); })
    .map(function (r) {
      return { name: String(r.scout_name).trim(), unit: String(r.unit || ''), stage: SettingsModel.sectionLabel(s, r.section), order: order[r.section] || 0,
        age: Board.age(Intake.dateKey(r.birth_date) || '', today), approved: aCol ? (Intake.dateKey(r[aCol]) || '') : '' };
    })
    .sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); })
    .map(function (x) { delete x.order; return x; });
}

/** Unit page calendar (lib/unitCalendar.js): the unit's Scouts' sessions, and open times of the types booked online. */
function actionUnitCalendar_(req) {
  var me = myUnits_(req.session);
  var s = getSettings_();
  var recs = {};
  Records.all(['scout_name', 'unit']).forEach(function (r) { recs[r.recordId] = { name: String(r.scout_name || ''), unitCodes: Units.codes(r.unit) }; });
  var cal = UnitCalendar.build(readSchedule_().rows, function (id) { return recs[id] || null; }, me.units.map(function (u) { return u.code; }),
    Booking.parseOnline(s.onlineBooking).codes, Date.now(), function (code) { return s[Booking.rules(code).lead] || 0; });
  return { booked: cal.booked, open: cal.open };
}
