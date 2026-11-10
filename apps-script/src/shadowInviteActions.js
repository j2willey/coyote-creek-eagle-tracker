/**
 * Admin → "Old-way bookings: send calendar invitations" (lib/shadowInvites.js). For each picked shadow session from
 * tomorrow on: create the Calendar invitation (as a booking made in the tool would: Scout, parent, the members on the
 * slot; EBoR: + Unit Board Members and others to invite, via the sync right after), write its event ID over "shadow",
 * log it. No other email (use ✉ Email… / bulk drafts for "Booked:" confirmations). Test mode applies.
 *   shadowList    {session}                -> {sessions:[{key, label, when, scout, unit, who, place, problem}]}
 *   shadowInvite  {session, keys:[...]}    -> {results:[{key, ok, message}]}
 */
function actionShadowList_(req) {
  committeeMe_(req.session);
  var committee = committee_();
  return { sessions: ShadowInvites.candidates(readSchedule_().rows, Date.now()).map(function (x) {
    var rec = Records.get(x.recordId);
    var people = Booking.resolveWho(x.who, committee);
    var problem = !rec ? 'Scout no longer on the tracking tab' : !people.emails.length ? 'No committee member with an email on the slot'
      : (!String(rec.fields.scout_email || '').trim() && !String(rec.fields.parent_email || '').trim()) ? 'No Scout or parent email' : '';
    return { key: x.key, label: x.label, when: whenText_(x.start), scout: rec ? String(rec.fields.scout_name) : x.scout, unit: x.unit,
      who: x.who.join('/'), unknown: people.unknown, place: Booking.isVirtual(x.type, x) ? 'Google Meet' : [x.location, x.address].filter(String).join(', '),
      board: Units.parseBoard(x.board).length, problem: problem };
  }) };
}

function actionShadowInvite_(req) {
  var c = committeeMe_(req.session);
  var keys = (req.keys || []).map(String);
  if (!keys.length) throw userError_('Tick at least one session.');
  var ctx = { s: getSettings_(), c: committee_() };
  var started = Date.now();
  var results = ShadowInvites.candidates(readSchedule_().rows, Date.now()).filter(function (x) { return keys.indexOf(x.key) >= 0; }).map(function (x) {
    if (Date.now() - started > 240000) return { key: x.key, ok: false, message: 'Not done (time limit): run again for the rest.' };
    try {
      var rec = Records.get(x.recordId);
      if (!rec) throw userError_('Scout no longer on the tracking tab.');
      var people = Booking.resolveWho(x.who, ctx.c);
      if (!people.emails.length) throw userError_('No committee member with an email on the slot.');
      var ev = createBookingEvent_(x.type, rec, x, people, x.board);   // EBoR: Unit Board Members invited at once
      var row = withLock_(function () {
        var sched = readSchedule_();
        var r = sched.rows.filter(function (y) { return String(y._key) === x.key; })[0];
        if (!r || !Booking.isShadow(r.event_id)) { deleteBookingEvent_(ev.id); throw userError_('The slot changed meanwhile; nothing created.'); }
        writeSchedule_(sched, r._row, { event_id: ev.id });
        r.event_id = ev.id;
        return r;
      });
      try { syncBookedRow_(row, ctx); } catch (e) { console.warn('shadow sync ' + x.key + ': ' + e); }   // board members, others to invite
      addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] Calendar invitation sent for the ' + x.label + ' on ' + whenText_(x.start) +
        ' (booked the old way; by ' + (c.me.initials || c.email) + ')');
      return { key: x.key, ok: true, message: 'invitation sent' };
    } catch (e) { return { key: x.key, ok: false, message: e.userMessage || e.message }; }
  });
  var ok = results.filter(function (r) { return r.ok; }).length;
  scheduleActivity_('Calendar invitations for old-way bookings: ' + ok + ' of ' + results.length + ' sent', c.email);
  return { results: results };
}
