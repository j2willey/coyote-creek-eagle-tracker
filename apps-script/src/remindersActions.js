/**
 * EBoR reminders (rules in lib/reminders.js). Runs from the hourly trigger (digestHourly): Settings →
 * eborReminderDays before each booked EBoR, drafts ONE "4.3.c EBoR reminder" to the Scout and the board
 * (tab in Review mode = Outbox, where a member adds details and sends or schedules it; Automatic = sent at once).
 * Each board is done once (Script Properties "rem:<slot>:<start>").
 */
function runReminders_() {
  var s = getSettings_();
  var sched;
  try { sched = readSchedule_(); } catch (e) { return 0; }
  var sections = {};
  Records.all(['scout_name']).forEach(function (r) { sections[r.recordId] = r.section; });
  var slots = sched.rows.filter(function (r) { return Booking.typeCode(r.slot_type) === 'EBoR' && String(r.record_id || '').trim(); })
    .map(function (r) {
      var id = String(r.record_id).trim();
      return { key: String(r._key || ''), recordId: id, start: Booking.slotStart(r.date, r.time) || 0, section: sections[id] || '', row: r };
    });
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties(), done = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('rem:') === 0) done[k] = true; });
  var due = Reminders.dueEbors(slots, Date.now(), s.eborReminderDays, done);
  due.forEach(function (x) {
    try {
      draftEborReminder_(x.recordId, x.row, x.start);
      props.setProperty(x.reminderKey, String(Date.now()));
    } catch (e) { console.error('reminder ' + x.reminderKey + ': ' + e); notifyAdmin_('EBoR reminder not drafted', x.reminderKey + ': ' + e.message); }
  });
  return due.length;
}

/**
 * One EBoR reminder per board (Jim W., 2026-11-02; was two emails): To the Scout, the district reps on the slot and
 * the Unit Board Members; Cc the parent/guardian (none on file: the committee) and the committee.
 */
function draftEborReminder_(recordId, row, start) {
  var s = getSettings_();
  var rec = Records.get(recordId);
  if (!rec) return;
  var key = 'EBoR reminder';
  var scout = String(rec.fields.scout_name || '');
  var reps = Booking.resolveWho(Booking.splitWho(row.reps), committee_());
  var board = Units.parseBoard(row.board_members);
  var vars = { scout: scout, firstName: EagleDone.firstName(scout, rec.fields.preferred_name), unitName: EagleDone.unitName(rec.fields.unit),
    when: whenText_(start), where: Booking.place(row) || 'to be confirmed', board: Reminders.boardList(reps.names, board) || 'to be confirmed',
    dayOfContact: String(s.dayOfContact || '') };
  var adults = EagleDone.recipients([reps.emails, board.map(function (m) { return m.email; })]);
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail, adults);
  var p = reviewBuiltIn_(TemplateCatalog.get(key), vars);
  return mailFromTemplate_(key, vars, { committee: true, outbox: true, by: 'Eagle Tracker', recordId: recordId, scout: scout,
    eventAt: start, to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: p.subject, body: p.body });
}
