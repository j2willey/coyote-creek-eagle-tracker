/**
 * Several new sessions at once + the "new times are open" email (Jim W., 2026-10-31).
 * Rules in lib/committeeSchedule.js (checkBatch) and lib/openTimes.js.
 *
 * Router actions (committee schedule page):
 *   saveSlots         {session, slot, times:[{date, time}], confirm}  -> {message, keys, type} | {needsConfirm, warnings}
 *   openTimesChoices  {session, type, keys}                          -> {label, scouts, times, held, othersOpen, testMode}
 *   openTimesDraft    {session, type, keys, recordIds, includeOthers} -> {message, outboxId}
 */

/** Inside the lock: add one new open session row in date order. -> its key. */
function insertSlotRow_(cells, start) {
  var sched = readSchedule_();
  var sh = sched.sheet;
  var row = Object.assign({}, cells, { _key: Booking.makeSlotKey(start, sched.rows.map(function (r) { return r._key; })) });
  var before = CommitteeSchedule.insertBefore(sched.rows, start);
  var rowNum;
  if (before) { sh.insertRowBefore(before); rowNum = before; }
  else rowNum = sh.getLastRow() + 1;
  var width = sh.getLastColumn();
  var vals = sh.getRange(rowNum, 1, 1, width).getValues()[0].map(function () { return ''; });
  Object.keys(row).forEach(function (k) { if (sched.map[k] !== undefined) vals[sched.map[k]] = row[k]; });
  sh.getRange(rowNum, 1, 1, width).setValues([vals]);
  readSchedule_._memo = null;
  return row._key;
}

/** The schedule columns a slot needs (added on first use). */
function ensureSlotColumns_(slot) {
  if (slot.reserved) ensureScheduleColumn_('reserved', 'Reserved');
  if (slot.leadHours !== undefined && slot.leadHours !== null && String(slot.leadHours).trim() !== '') ensureScheduleColumn_('lead_hours', 'Lead (h)');
}

function actionSaveSlots_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var shared = Object.assign({}, req.slot || {}, { key: '', recordId: '', booked: false });
  var times = (req.times || []).map(function (t) { return { date: String((t && t.date) || ''), time: String((t && t.time) || '') }; });
  ensureSlotColumns_(shared);
  var out = withLock_(function () {
    var chk = CommitteeSchedule.checkBatch(shared, times, readSchedule_().rows, c.committee, Date.now(), s);
    if (chk.errors.length) throw userError_(chk.errors.join(' '));
    if (chk.warnings.length && req.confirm !== true) return { needsConfirm: true, warnings: chk.warnings };
    var keys = [], lines = [];
    chk.items.forEach(function (it) {
      keys.push(insertSlotRow_(it.cells, it.start));
      lines.push(slotLine_(it.cells, it.start));
    });
    return { keys: keys, lines: lines };
  });
  if (out.needsConfirm) return out;
  scheduleActivity_(c.me.initials + ' added ' + out.keys.length + ' session' + (out.keys.length === 1 ? '' : 's') + ': ' + out.lines.join('; '), c.email);
  return { message: 'Added ' + out.keys.length + ' session' + (out.keys.length === 1 ? '' : 's') + '.', keys: out.keys, type: shared.type };
}

/** Shared by choices + draft: who is ready to book, and which open times to list. */
function openTimesContext_(type, keys, includeOthers) {
  if (Booking.BOOKABLE.indexOf(type) < 0) throw userError_('Pick a Pre-Review Call, Proposal Review or EBoR.');
  var s = getSettings_();
  var rows = readSchedule_().rows;
  var now = Date.now();
  var scouts = OpenTimes.recipients(Records.all(['scout_name', 'unit', 'scout_email', 'parent_email', 'preferred_name']), type, rows, now);
  var open = Booking.openSlots(rows, type, now, s[Booking.rules(type).lead]);       // what Scouts are offered right now
  var picked = OpenTimes.pick(open, keys, !!includeOthers);
  var mine = OpenTimes.pick(open, keys, false);
  return { s: s, scouts: scouts, picked: picked, held: mine.held, othersOpen: open.length - mine.list.length,
    times: OpenTimes.timesList(picked.list, type, whenText_, Booking.place) };
}

function actionOpenTimesChoices_(req) {
  committeeMe_(req.session);
  var type = String(req.type || '');
  var x = openTimesContext_(type, req.keys || [], !!req.includeOthers);
  return {
    type: type, label: Booking.label(type),
    scouts: x.scouts.map(function (r) {
      return { recordId: r.recordId, name: r.name, unit: r.unit, noEmail: r.noEmail, parent: r.parentEmails.length > 0, scoutEmail: r.scoutEmails.length > 0 };
    }),
    times: x.times, held: x.held.length, othersOpen: x.othersOpen, testMode: x.s.testMode !== false
  };
}

function actionOpenTimesDraft_(req) {
  var c = committeeMe_(req.session);
  var type = String(req.type || '');
  var x = openTimesContext_(type, req.keys || [], !!req.includeOthers);
  var want = (req.recordIds || []).map(String);
  var chosen = x.scouts.filter(function (r) { return want.indexOf(r.recordId) >= 0 && !r.noEmail; });
  if (!chosen.length) throw userError_('Tick at least one Scout with an email address.');
  if (!x.picked.list.length) throw userError_('None of these times can be booked online right now (booked, or inside their lead time).');
  var group = String(x.s.committeeGroupEmail || '');
  var fam = OpenTimes.addresses(chosen, '');                 // To the Scouts; parents in keepCc (always copied)
  var label = Booking.label(type);
  var firstNames = OpenTimes.namesText(chosen.map(function (r) { return EagleDone.firstName(r.name, r.preferred); }));
  var vars = { firstNames: firstNames, type: label, times: x.times, pageLink: pageUrl_() };
  var body = firstNames + ',\n\nThe committee just opened new ' + label + ' times:\n' + x.times.map(function (t) { return '  - ' + t; }).join('\n') +
    '\n\nFirst come, first served: book soon to get the time you want. The page always shows what is still open.\n\nSign in and pick a time: ' +
    pageUrl_() + '\n\nCoyote Creek District Advancement Committee';
  var res = mailFromTemplate_(OpenTimes.TEMPLATE[type], vars, {
    committee: true, outbox: true, by: c.email, recordId: '', scout: OpenTimes.namesText(chosen.map(function (r) { return r.name; })),
    to: fam.to, cc: MailPlan.merge(fam.cc, group), keepCc: fam.cc, subject: 'New ' + label + ' times open: please book', body: body });
  scheduleActivity_(c.me.initials + ' drafted the open-times email (' + label + ', ' + x.times.length + ' time' + (x.times.length === 1 ? '' : 's') + ') to ' +
    chosen.length + ' Scout' + (chosen.length === 1 ? '' : 's'), c.email);
  if (res && res.queued) return { message: 'The email is waiting in the Outbox: check it, then Send.', outboxId: res.id };
  if (res && res.reason === 'template off') throw userError_('The "' + OpenTimes.TEMPLATE[type] + '" template is set to Off in the template Doc.');
  return { message: res && res.send ? 'Sent.' : 'Not sent: ' + ((res && res.reason) || 'unknown'), outboxId: '' };
}
