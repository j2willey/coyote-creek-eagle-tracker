/**
 * Committee schedule page (/committee): adapter. Rules in lib/committeeSchedule.js.
 *
 * Access: the signed-in email must be on the Committee tab (Email column).
 * Everything runs as the web app's account (cc-advancement); the member's
 * email is recorded as "by" on the Activity tab (Scout = "Schedule").
 *
 * Router actions:
 *   committeeSchedule {session}                    -> {me, members, types, defaultStart, slots, testMode}
 *   saveSlot          {session, slot, confirm}     -> {message, key} | {needsConfirm: true, warnings}
 *                     slot.booked = move a booked session (date, time, place, members): invite updated, ONE email
 *   deleteSlot        {session, key}               -> {message}
 *   saveReps          {session, key, reps}         -> {message}   booked slot: members on it (invite follows)
 *   cancelSlotBooking {session, key}               -> {message}   booked slot: cancel (Scout emailed, slot reopens)
 */

function committeeMe_(session) {
  var email = sessionEmail_(session);
  var committee = committee_();
  var me = CommitteeSchedule.memberFor(committee, email);
  if (!me) throw userError_('This page is for Coyote Creek District Advancement Committee members. ' +
    'Your email address is not on the committee list.');
  return { email: email, me: me, committee: committee };
}

function scheduleActivity_(entry, by) {
  try {
    Tabs.append(ACTIVITY_TAB, { 'When': new Date(), 'Scout': 'Schedule', 'Unit': '', 'Record ID': '', 'Entry': entry, 'By': by || '' });
  } catch (e) { console.warn('Schedule activity not recorded: ' + e); }
}

function actionCommitteeSchedule_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var since = Date.now() - 62 * 24 * 3600 * 1000;
  var rows = readSchedule_().rows;
  var byKey = {};
  rows.forEach(function (r) { byKey[String(r._key || '')] = r; });
  var units = [];
  try { units = units_(); } catch (e) {}
  var announce = eagleAnnounce_();                         // "If awarded: 110th Eagle Scout of Troop 910" (2026-11-01)
  var slots = CommitteeSchedule.entries(rows, s).filter(function (x) { return x.end >= since; }).map(function (x) {
    if (x.type === 'EBoR' && x.booked) {                   // Unit Board Members (entered by the unit or a member)
      var r = byKey[x.key] || {};
      x.eagleNumber = x.end > Date.now() - 12 * 3600 * 1000 ? (announce[String(r.record_id || '')] || '') : '';
      x.board = Units.parseBoard(r.board_members);
      x.unitUnderReview = !!((Units.find(units, x.unit) || {}).underReview);
    }
    return x;
  });
  var scouts = CommitteeSchedule.scoutChoices(Records.all(['scout_name', 'unit']),
    function (k) { return SettingsModel.sectionLabel(s, k); },
    function (id, type) { var b = Booking.currentBooking(rows, id, type, Date.now()); return b ? whenText_(b.start) : ''; });
  Object.keys(scouts).forEach(function (t) { scouts[t].forEach(function (x) { x.unitCode = Units.primary(x.unit); }); });   // reserved-for-unit matching
  return {
    me: { name: String(c.me.name || ''), initials: String(c.me.initials || ''), email: c.email },
    members: c.committee.filter(function (m) { return String(m.initials || '').trim(); })
      .map(function (m) { return { name: String(m.name || ''), initials: String(m.initials).trim(), active: m.active !== false }; }),
    types: CommitteeSchedule.typeDefaults(s),
    defaultStart: CommitteeSchedule.defaultStart(s),
    slots: slots,
    scouts: scouts,
    units: units.map(function (u) { return { code: u.code, label: u.unit, underReview: !!u.underReview }; })
      .sort(function (a, b) { return a.code.localeCompare(b.code, undefined, { numeric: true }); }),
    outboxPending: pendingCount_(),
    testMode: s.testMode !== false
  };
}

function slotLine_(cells, start) {
  var when = cells.time ? whenText_(start) : Utilities.formatDate(new Date(start), Session.getScriptTimeZone(), 'EEE M/d') + ' (whole day)';
  return Booking.label(Booking.typeCode(cells.slot_type)) + ' ' + when + (cells.reps ? ' (' + cells.reps + ')' : ' (no committee member yet)') +
    (cells.location ? ' at ' + cells.location : '') + (cells.reserved ? ', reserved' + (cells.unit ? ' for ' + cells.unit : '') : '');
}

function actionSaveSlot_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var input = req.slot || {};
  var key = String(input.key || '').trim();
  var recordId = String(input.recordId || '').trim();
  var rec = null;
  if (recordId) {
    rec = Records.get(recordId);
    if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
    if ((CommitteeSchedule.SCOUT_SECTIONS[input.type] || []).indexOf(rec.section) < 0) {
      throw userError_(rec.fields.scout_name + ' is at a stage that can\'t be booked for this type. Reload the page.');
    }
  }
  if (input.reserved && !recordId) ensureScheduleColumn_('reserved', 'Reserved');   // first reserved slot adds the column
  if (!input.booked && input.leadHours !== undefined && input.leadHours !== null && String(input.leadHours).trim() !== '') ensureScheduleColumn_('lead_hours', 'Lead (h)');
  var out = withLock_(function () {
    var sched = readSchedule_();
    var row = null, bookedRow = null;
    if (key) {
      row = sched.rows.filter(function (r) { return String(r._key) === key; })[0];
      if (!row) throw userError_('That slot is no longer on the schedule. Reload the page.');
      if (String(row.record_id || '').trim() || String(row.scout_name || '').trim()) {
        if (!input.booked || recordId) throw userError_('A Scout is booked in this slot now. Reload the page.');
        bookedRow = row;
      } else if (input.booked) throw userError_('Nobody is booked in this slot any more. Reload the page.');
    }
    if (bookedRow) return moveBookedRow_(sched, bookedRow, input, c, s, req.confirm === true);
    // Booking a Scout into a reserved slot: the slot's own Reserved/unit come from the sheet (the form may not send them).
    var chkIn = input;
    if (rec) {
      var held = !!(row && Booking.isReserved(row));
      chkIn = Object.assign({}, input, { reserved: held, unit: held ? String(row.unit || '').trim() : '', scoutUnit: String(rec.fields.unit || '') });
    }
    var chk = CommitteeSchedule.check(chkIn, sched.rows, c.committee, Date.now(), s);
    if (chk.errors.length) throw userError_(chk.errors.join(' '));
    if (chk.warnings.length && req.confirm !== true) return { needsConfirm: true, warnings: chk.warnings };

    var sh = sched.sheet;
    var cells = chk.cells;
    if (!row) {
      var newKey = Booking.makeSlotKey(chk.start, sched.rows.map(function (r) { return r._key; }));
      cells._key = newKey;
      var before = CommitteeSchedule.insertBefore(sched.rows, chk.start);
      var rowNum;
      if (before) { sh.insertRowBefore(before); rowNum = before; }
      else rowNum = sh.getLastRow() + 1;
      var width = sh.getLastColumn();
      var vals = sh.getRange(rowNum, 1, 1, width).getValues()[0].map(function () { return ''; });
      Object.keys(cells).forEach(function (k) { if (sched.map[k] !== undefined) vals[sched.map[k]] = cells[k]; });
      sh.getRange(rowNum, 1, 1, width).setValues([vals]);
      return { key: newKey, line: 'added ' + slotLine_(cells, chk.start) };
    }

    var moved = chk.start !== (CommitteeSchedule.windowOf(row, s) || {}).start;
    var upd = {};
    Object.keys(cells).forEach(function (k) { if (sched.map[k] !== undefined) upd[k] = cells[k]; });
    writeSchedule_(sched, row._row, upd);
    if (moved) {
      var dest = CommitteeSchedule.insertBefore(sched.rows, chk.start, key) || (sh.getLastRow() + 1);
      if (dest !== row._row && dest !== row._row + 1) sh.moveRows(sh.getRange(row._row + ':' + row._row), dest);
    }
    return { key: key, line: 'changed ' + slotLine_(cells, chk.start) };
  });
  if (out.needsConfirm) return out;
  scheduleActivity_(c.me.initials + ' ' + out.line, c.email);
  if (out.booked) return afterBookedMove_(out, c);
  if (!rec) return { message: 'Saved.', key: out.key };
  var booked = bookForScout_(rec, input.type, out.key, c.email);
  return { message: booked.message, key: out.key, outboxId: booked.outboxId || '' };
}

/**
 * Inside the lock: move a booked row to the form's date / time / place (and members). Only those cells change; the
 * Scout, unit, Record ID, invite and Unit Board Members stay. Length is not changed here (the invite keeps its length).
 */
function moveBookedRow_(sched, row, input, c, s, confirmed) {
  var chkIn = Object.assign({}, input, { key: String(row._key), recordId: String(row.record_id), minutes: Number(row.duration_min) || input.minutes,
    reserved: false, unit: '' });
  var chk = CommitteeSchedule.check(chkIn, sched.rows, c.committee, Date.now(), s);
  var mv = CommitteeSchedule.checkMove(row, input, chk.start, Date.now(), s);
  var errors = chk.errors.concat(mv.errors), warnings = chk.warnings.concat(mv.warnings);
  if (errors.length) throw userError_(errors.join(' '));
  var before = (CommitteeSchedule.windowOf(row, s) || {}).start;
  var cells = { date: chk.cells.date, day: chk.cells.day, time: chk.cells.time, location: chk.cells.location, address: chk.cells.address, reps: chk.cells.reps };
  var same = before === chk.start && String(row.location || '').trim() === cells.location && String(row.address || '').trim() === cells.address &&
    Booking.splitWho(row.reps).join('/') === cells.reps;
  if (same) return { booked: true, key: String(row._key), same: true };
  if (warnings.length && !confirmed) return { needsConfirm: true, warnings: warnings };
  var upd = {};
  Object.keys(cells).forEach(function (k) { if (sched.map[k] !== undefined) upd[k] = cells[k]; });
  writeSchedule_(sched, row._row, upd);
  if (before !== chk.start) {
    var dest = CommitteeSchedule.insertBefore(sched.rows, chk.start, String(row._key)) || (sched.sheet.getLastRow() + 1);
    if (dest !== row._row && dest !== row._row + 1) sched.sheet.moveRows(sched.sheet.getRange(row._row + ':' + row._row), dest);
  }
  var type = Booking.typeCode(row.slot_type);
  return { booked: true, key: String(row._key), recordId: String(row.record_id), scoutName: String(row.scout_name || ''), type: type,
    from: isNaN(before) ? '' : whenText_(before), to: whenText_(chk.start), shadow: Booking.isShadow(row.event_id),
    line: 'moved ' + String(row.scout_name || '') + '\'s ' + Booking.label(type) + (isNaN(before) ? '' : ' from ' + whenText_(before)) + ' to ' +
      slotLine_(Object.assign({}, chk.cells, { slot_type: type }), chk.start) };
}

/** After a booked move: invite, tracker Date/Who, log note and the ONE "moved" email, through the schedule sync. */
function afterBookedMove_(out, c) {
  if (out.same) return { message: 'No change.', key: out.key };
  var fresh = readSchedule_().rows.filter(function (r) { return String(r._key) === out.key; })[0];
  var rep = { moved: 0 };
  try { if (fresh) rep = syncBookedRow_(fresh, { s: getSettings_(), c: c.committee }); }
  catch (e) {
    console.error('booked move sync: ' + (e && e.stack || e));
    notifyAdmin_('Invite not updated after a move', out.line + '\n\n' + (e && e.stack || e));
    return { message: 'Moved on the schedule, but the invitation could not be updated yet; the hourly check will retry. The admin was told.', key: out.key };
  }
  if (out.recordId) addRecordNote_(out.recordId, Intake.shortDate(new Date()) + ' [tool] ' + Booking.label(out.type) + ' changed on the committee page by ' + c.email);
  if (out.shadow) return { message: 'Moved ' + out.scoutName + ' to ' + out.to + ' (shadow booking: no invitation or email).', key: out.key };
  var unit = Booking.rules(out.type) && Booking.rules(out.type).notifyUnit;
  return { message: 'Moved ' + out.scoutName + ' to ' + out.to + (out.from ? ' (was ' + out.from + ')' : '') + '. ' +
    (rep.moved ? 'The invitation was updated and one email went to the Scout and parent' + (unit ? ' and the unit' : '') +
      (getSettings_().testMode !== false ? ' (test mode).' : '.') : 'The invitation was updated (members only; the time and place did not change).'), key: out.key };
}

function actionDeleteSlot_(req) {
  var c = committeeMe_(req.session);
  var key = String(req.key || '').trim();
  var line = withLock_(function () {
    var sched = readSchedule_();
    var row = sched.rows.filter(function (r) { return String(r._key) === key; })[0];
    if (!row) throw userError_('That slot is no longer on the schedule. Reload the page.');
    if (String(row.record_id || '').trim() || String(row.scout_name || '').trim()) {
      throw userError_('A Scout is booked in this slot. Cancel the booking first (schedule sheet: clear the Scout name).');
    }
    if (CommitteeSchedule.FORM_TYPES.indexOf(Booking.typeCode(row.slot_type)) < 0) throw userError_('Only review slots and Blocked entries can be deleted here.');
    var start = Booking.slotStart(row.date, row.time);
    var text = Booking.label(Booking.typeCode(row.slot_type)) + ' ' + (isNaN(start) ? String(row.location || '') : whenText_(start)) +
      (String(row.reps || '').trim() ? ' (' + String(row.reps).trim() + ')' : '');
    sched.sheet.deleteRow(row._row);
    return text;
  });
  scheduleActivity_(c.me.initials + ' deleted ' + line, c.email);
  return { message: 'Deleted.' };
}

function bookedRow_(sched, key) {
  var row = sched.rows.filter(function (r) { return String(r._key) === String(key || ''); })[0];
  if (!row) throw userError_('That slot is no longer on the schedule. Reload the page.');
  if (!String(row.record_id || '').trim()) throw userError_('Nobody is booked in this slot any more. Reload the page.');
  return row;
}

/** Members on a booked slot. At least one; to free the slot, cancel the booking. */
function actionSaveReps_(req) {
  var c = committeeMe_(req.session);
  var reps = (req.reps || []).map(function (t) { return String(t || '').trim(); })
    .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  if (!reps.length) throw userError_('A booked session needs at least one committee member. To free the slot, cancel the booking.');
  var unknown = reps.filter(function (t) { return !Booking.findMember(t, c.committee); });
  if (unknown.length) throw userError_('Not on the Committee tab: ' + unknown.join(', ') + '.');
  var hit = withLock_(function () {
    var sched = readSchedule_();
    var row = bookedRow_(sched, req.key);
    var before = Booking.splitWho(row.reps).join('/');
    writeSchedule_(sched, row._row, { reps: reps.join('/') });
    row.reps = reps.join('/');
    return { row: row, before: before };
  });
  var after = reps.join('/');
  if (hit.before === after) return { message: 'No change.' };
  var shadowRow = Booking.isShadow(hit.row.event_id);
  var type = Booking.typeCode(hit.row.slot_type);
  var start = Booking.slotStart(hit.row.date, hit.row.time);
  var line = Booking.label(type) + ' ' + whenText_(start) + ': committee ' + (hit.before || '(none)') + ' → ' + after;
  var res = { added: 0, removed: 0 };
  try { res = syncBookedRow_(hit.row, { s: getSettings_(), c: c.committee }); }
  catch (e) { console.error('saveReps sync: ' + (e && e.stack || e)); notifyAdmin_('Invite not updated', line + '\n\n' + (e && e.stack || e)); }
  addRecordNote_(String(hit.row.record_id), Intake.shortDate(new Date()) + ' [tool] ' + line + ' (by ' + c.email + ')');
  if (shadowRow) return { message: 'Saved (shadow booking: no invitation to update).' };
  return { message: 'Saved. The calendar invitation was updated' +
    (getSettings_().testMode !== false ? ' (test mode: only its "Would have invited" list).' : '.') };
}

/** A committee member sets the Unit Board Members on a booked EBoR (same cell the unit page writes). */
function actionSaveUnitBoard_(req) {
  var c = committeeMe_(req.session);
  var v = Units.validateBoard(req.members);
  if (!v.ok) throw userError_(v.errors.join(' '));
  var cell = Units.formatBoard(v.members);
  var hit = withLock_(function () {
    var sched = readSchedule_();
    var row = bookedRow_(sched, req.key);
    if (Booking.typeCode(row.slot_type) !== 'EBoR') throw userError_('Unit Board Members are only for Eagle Boards of Review.');
    var before = String(row.board_members || '');
    writeSchedule_(sched, row._row, { board_members: cell });
    row.board_members = cell;
    return { row: row, before: before };
  });
  if (hit.before.trim() === cell.trim()) return { message: 'No change.' };
  addRecordNote_(String(hit.row.record_id), Intake.shortDate(new Date()) + ' [tool] Unit Board Members set by ' + c.email + ': ' +
    (v.members.map(function (m) { return m.name; }).join(', ') || '(none)'));
  try { syncInvites_(); } catch (e) { console.warn('saveUnitBoard sync: ' + e); }
  var total = Units.boardSize(hit.row.reps, cell, Booking.splitWho);
  return { message: 'Saved. Board: ' + total + ' (district/council + unit)' + (total < Units.BOARD_MIN ? ': an EBoR needs at least 3.' : total > Units.BOARD_MAX ? ': more than 6, check who sits on the board.' : '.') +
    (Booking.isShadow(hit.row.event_id) ? ' (Shadow booking: no invitation to update.)' : ' Members with an email get the calendar invitation.'), board: v.members };
}

function actionCancelSlotBooking_(req) {
  var c = committeeMe_(req.session);
  var row = bookedRow_(readSchedule_(), req.key);
  var rec = Records.get(String(row.record_id));
  if (!rec) throw userError_('The Scout booked here is no longer on the tracking tab. Clear the slot on the schedule sheet.');
  var cur = upcomingBooking_(readSchedule_().rows, rec.recordId);
  if (!cur || cur.b.key !== String(row._key)) throw userError_('This booking is in the past or not the Scout\'s current one. Change it on the schedule sheet.');
  var res = cancelBooking_(rec, c.email, false);
  if (res.shadow) return { message: 'Cleared the shadow booking for ' + rec.fields.scout_name + ' on ' + res.when + ' (no email; the slot is open again).' };
  return { message: 'Cancelled ' + rec.fields.scout_name + '\'s ' + res.label + ' on ' + res.when + '. The invitation was removed and the slot is open again; ' +
    (res.mailQueued ? 'the email to the Scout and parent is waiting in the Outbox.' : 'the Scout and parent were emailed.'), outboxId: res.outboxId };
}

/**
 * Create-and-book: put the Scout into the slot just saved. If the Scout already has an upcoming
 * booking of this type, it is released first (old invite removed, old slot open again), so the
 * family gets one "booked" email with the new time. No online cutoff (committee booking).
 */
function bookForScout_(rec, type, key, by) {
  var released = '';
  var sched = readSchedule_();
  var cur = Booking.currentBooking(sched.rows, rec.recordId, type, Date.now());
  if (cur && cur.key !== key) {
    withLock_(function () {
      var s2 = readSchedule_();
      var old = s2.rows.filter(function (r) { return String(r._key) === cur.key; })[0];
      if (old && String(old.record_id) === rec.recordId) writeSchedule_(s2, old._row, { scout_name: '', unit: '', record_id: '', event_id: '' });
    });
    deleteBookingEvent_(cur.eventId);
    released = whenText_(cur.start);
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + Booking.label(type) + ' on ' + released +
      ' released (moved to a new time by ' + by + ')');
  }
  var res;
  try { res = bookSlot_(rec, type, key, by, 0, true); }
  catch (e) {
    throw userError_('The slot was saved but ' + rec.fields.scout_name + ' could not be booked into it: ' + (e.userMessage || e.message) +
      (released ? ' Their earlier time (' + released + ') was already released.' : ''));
  }
  scheduleActivity_('booked ' + rec.fields.scout_name + ' (' + rec.fields.unit + ') for ' + Booking.label(type) + ' ' + res.when +
    (released ? ', moved from ' + released : '') + (res.shadow ? ' (shadow)' : ''), by);
  if (res.shadow) {
    return { message: 'Recorded ' + rec.fields.scout_name + ' for ' + res.when + (released ? ' (moved from ' + released + ')' : '') +
      ' as a shadow booking: ' + Booking.label(type) + ' is still scheduled on the old system, so no invitation or email was sent.', outboxId: '' };
  }
  return { message: 'Booked ' + rec.fields.scout_name + ' for ' + res.when + (released ? ' (moved from ' + released + ')' : '') +
    '. The invitation was sent' + (res.mailQueued ? '; the confirmation email is waiting in the Outbox.'
      : ' with the confirmation email' + (getSettings_().testMode !== false ? ' (test mode: to you only).' : '.')), outboxId: res.outboxId };
}
