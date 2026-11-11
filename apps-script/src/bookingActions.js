/**
 * Booking adapter (M5). Rules in lib/booking.js.
 *
 * Schedule sheet (Settings → scheduleSheetId / scheduleTab): hidden machine
 * header row (the row whose cells include `_key`), visible labels below it.
 * Calendar events use the Advanced Calendar service (needed for Meet links)
 * on the deploying account's calendar (Settings → calendarId).
 *
 * Bookable types (lib/booking.js RULES): Intake = Pre-Review Call (Meet,
 * member named, adult-21+ confirm) and ESSPPR = Proposal Review (in person,
 * panel not named, row moves to "Proposal Reviews scheduled").
 *
 * Router actions:
 *   slots         {session, recordId}                          -> {type, showWho, adult, slots:[{key, when, member, where}]}
 *   book          {session, recordId, slotKey, adultConfirmed} -> {message, when}
 *   cancelBooking {session, recordId}                          -> {message}
 */

// ---------- schedule sheet ----------

function scheduleSheet_() {
  if (scheduleSheet_._memo) return scheduleSheet_._memo;
  var s = getSettings_();
  var id = settingFresh_('scheduleSheetId');
  if (!id) throw new Error('Settings → scheduleSheetId is empty');
  s = getSettings_();
  var ss = SpreadsheetApp.openById(id);
  scheduleSheet_._memo = ss.getSheetByName(s.scheduleTab || 'Schedule') || ss.getSheets()[0];
  return scheduleSheet_._memo;
}

/** -> {sheet, map: name->col index, rows: [{...fields, _row}]} */
function readSchedule_() {
  if (readSchedule_._memo) return readSchedule_._memo;   // one read per request; cleared by writes and withLock_
  var sh = scheduleSheet_();
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var vals = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  var m = SheetModel.findMachineRow(vals.slice(0, 10));
  if (!m) throw new Error('Schedule sheet has no machine header row (a row containing "_key")');
  var rows = [];
  for (var r = m.row + 2; r < vals.length; r++) {        // skip the visible label row
    var o = { _row: r + 1 };
    Object.keys(m.map).forEach(function (k) { o[k] = vals[r][m.map[k]]; });
    rows.push(o);
  }
  // Slots added by committee members have no key yet: give them one (SL_yymmdd_XXX, never changes).
  Booking.missingKeys(rows).forEach(function (mk) {
    rows[mk.index]._key = mk.key;
    sh.getRange(rows[mk.index]._row, m.keyCol + 1).setValue(mk.key);
  });
  readSchedule_._memo = { sheet: sh, map: m.map, rows: rows };
  return readSchedule_._memo;
}

/** Admin menu: key new slots now (also happens automatically whenever slots are read). */
function menuKeySlots() {
  if (!councilAccountOk_()) return;
  var sched = readSchedule_();
  SpreadsheetApp.getUi().alert('Schedule checked: ' + sched.rows.filter(function (r) { return r._key; }).length +
    ' slots have keys. New rows (with a date) get one automatically.');
}

/**
 * Add a column to the schedule sheet if missing: machine name in the machine header row, label in the visible
 * label row under it (e.g. 'reserved' / 'Reserved', reserved-slots-design.md). Returns true when added.
 * No tick boxes: they fill every empty row with FALSE, which moves getLastRow() (new slots are appended there).
 * Booking.isReserved reads TRUE / x / yes.
 */
function ensureScheduleColumn_(machine, label) {
  var sh = scheduleSheet_();
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var top = sh.getRange(1, 1, Math.min(Math.max(sh.getLastRow(), 1), 10), lastCol).getValues();
  var m = SheetModel.findMachineRow(top);
  if (!m) throw new Error('Schedule sheet has no machine header row (a row containing "_key")');
  if (m.map[machine] !== undefined) return false;
  var col = lastCol + 1;
  sh.getRange(m.row + 1, col).setValue(machine);
  sh.getRange(m.row + 2, col).setValue(label).setFontWeight('bold');
  readSchedule_._memo = null;
  return true;
}

function writeSchedule_(sched, rowNum, obj) {
  readSchedule_._memo = null;
  Object.keys(obj).forEach(function (k) {
    if (sched.map[k] === undefined) throw new Error('Schedule sheet has no column ' + k);
    sched.sheet.getRange(rowNum, sched.map[k] + 1).setValue(obj[k]);
  });
}

function committee_() {
  if (committee_._memo) return committee_._memo;
  // A failed read must NOT be cached: an empty list would lock every member out for the cache lifetime
  // (2026-10-28: Jim W. "not recognized as a committee member" right after Setup / repair). The error escapes
  // cached_ (nothing stored), is logged, and this request alone gets [].
  try {
    committee_._memo = cached_('c:committee', function () {
      return Tabs.read('Committee').map(function (r) {
        var a = r['Active'];
        var active = !(a === false || /^(false|no|n|0)$/i.test(String(a == null ? '' : a).trim()));   // blank = active
        return { name: String(r['Name'] || ''), initials: String(r['Initials'] || ''), email: String(r['Email'] || ''), active: active };
      });
    });
  } catch (e) {
    console.error('Committee tab not read (not cached): ' + (e && e.stack || e));
    return [];
  }
  return committee_._memo;
}

function whenText_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'EEE M/d h:mm a');
}

function pageUrl_() { return String(getSettings_().webOrigin).replace(/\/+$/, '') + '/signin'; }

// ---------- calendar ----------

function calId_() { return getSettings_().calendarId || 'primary'; }

function intendedGuests_(rec, people, boardCell, withCc) {
  var board = Units.parseBoard(boardCell).map(function (m) { return m.email; }).filter(Boolean);
  var cc = withCc ? Units.parseCc(rec.fields._cc).map(function (x) { return x.email; }) : [];
  return people.emails.concat([rec.fields.scout_email, rec.fields.parent_email], board, cc)
    .map(function (e) { return String(e || '').trim().toLowerCase(); })
    .filter(function (e, i, a) { return e && a.indexOf(e) === i; });
}

/**
 * Create the invite. Pre-Review: Meet link, guests visible. Proposal Review:
 * location, guest list hidden (panel not named to the Scout).
 * Test mode: only testRecipient is invited; intended guests listed in the description.
 */
function createBookingEvent_(type, rec, slot, people, boardCell) {
  var s = getSettings_();
  var r = Booking.rules(type);
  var start = new Date(slot.start);
  var end = new Date(slot.start + slot.minutes * 60000);
  var text = Booking.inviteText(type, rec.fields.scout_name, rec.fields.unit, people.names.join(', '), whenText_(slot.start), slot);
  var intended = intendedGuests_(rec, people, r.boardOnInvite ? (boardCell || '') : '', !!r.notifyUnit);
  var attendees = intended, summary = text.summary, description = text.description;
  if (s.testMode !== false) {
    if (!s.testRecipient) throw new Error('Test mode on but testRecipient is empty: no invite sent');
    attendees = [s.testRecipient];
    summary = '[TEST] ' + summary;
    description = 'TEST MODE. Would have invited: ' + intended.join(', ') + '\n\n' + description;
  }
  var tz = Session.getScriptTimeZone();
  var ev = {
    summary: summary,
    description: description,
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    attendees: attendees.map(function (e) { return { email: e }; }),
    guestsCanSeeOtherGuests: true   // everyone invited can see who else is coming (showWho only governs names on the Scout page and emails)
  };
  if (Booking.isVirtual(type, slot)) ev.conferenceData = { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  else ev.location = Booking.place(slot);
  var made = Calendar.Events.insert(ev, calId_(), { conferenceDataVersion: 1, sendUpdates: 'all' });
  return { id: made.id, meetUrl: made.hangoutLink || '' };
}

function deleteBookingEvent_(eventId) {
  if (!eventId) return;
  try { Calendar.Events.remove(calId_(), eventId, { sendUpdates: 'all' }); }
  catch (e) { console.warn('Could not delete event ' + eventId + ': ' + e); }
}

function meetUrlFor_(eventId) {
  if (!eventId) return '';
  try { return Calendar.Events.get(calId_(), eventId).hangoutLink || ''; }
  catch (e) { return ''; }
}

/**
 * Booked slots and their invites stay in step with the schedule sheet, both ways:
 * members added to a slot (initials) are added to the invite, members removed from it
 * are removed (Google sends them a cancellation), a moved row moves the invite, and
 * the tracking Who column follows. Runs on schedule edits, hourly, from the Admin menu
 * and from the committee page.
 * Test mode: nobody real is invited; the description's "Would have invited" list is updated.
 */
function syncInvites_() {
  var ctx = { s: getSettings_(), c: committee_() };
  var sched = readSchedule_();
  var report = { checked: 0, added: 0, removed: 0, moved: 0 };
  sched.rows.forEach(function (row) { syncBookedRow_(row, ctx, report); });
  return report;
}

/** One booked schedule row (see syncInvites_). ctx: {s: settings, c: committee}. */
function syncBookedRow_(row, ctx, report) {
  report = report || { checked: 0, added: 0, removed: 0, moved: 0 };
  var s = ctx.s, c = ctx.c;
  var type = Booking.typeCode(row.slot_type);
  if (Booking.BOOKED_TYPES.indexOf(type) < 0 || !String(row.record_id || '').trim() || !String(row.event_id || '').trim()) return report;
  var r = Booking.rules(type);
  var start = Booking.slotStart(row.date, row.time);
  if (!(start > Date.now())) return report;
  var rec = Records.get(String(row.record_id));
  if (!rec) return report;
  report.checked++;
  if (Booking.isShadow(row.event_id)) {                     // no invite to keep in step: only the tracking Date/Who
    // Outcome already recorded on the Review page: the review date there wins over a stale slot.
    if (type === 'ESSPPR' && ['proposal_approved', 'proposal_revisions', 'proposal_not_approved'].indexOf(rec.section) >= 0) return report;
    if (type === 'EBoR' && ['eagle_earned', 'ebor_paused', 'eagle_not_awarded'].indexOf(rec.section) >= 0) return report;   // board outcome recorded
    var w0 = Booking.splitWho(row.reps).join('/');
    var dCol = s[r.dateCol], wCol = s[r.whoCol];
    var curD = rec.fields[dCol] instanceof Date ? rec.fields[dCol].getTime() : NaN;
    if (curD !== start || String(rec.fields[wCol] || '') !== w0) setTrackingDateWho_(rec.recordId, type, new Date(start), w0);
    return report;
  }
  var who = Booking.splitWho(row.reps);
  var people = Booking.resolveWho(who, c);
  var intended = intendedGuests_(rec, people, r.boardOnInvite ? row.board_members : '', !!r.notifyUnit);
  var ev;
  try { ev = Calendar.Events.get(calId_(), String(row.event_id)); } catch (e) { return report; }

  // A member moved the booked row (new date/time/place, same key): update the invite, tell the Scout (and unit).
  var evStart = ev.start && ev.start.dateTime ? new Date(ev.start.dateTime).getTime() : NaN;
  var ch = Booking.slotChanges(row, { startMs: evStart, location: ev.location || '' }, type);
  if (ch.timeChanged || ch.placeChanged) {
    var mins = Number(row.duration_min) || ((new Date(ev.end.dateTime).getTime() - evStart) / 60000) || 30;
    var tz = Session.getScriptTimeZone();
    var patch = { start: { dateTime: new Date(ch.start).toISOString(), timeZone: tz },
                  end: { dateTime: new Date(ch.start + mins * 60000).toISOString(), timeZone: tz } };
    var virtR = Booking.isVirtual(type, row);
    if (!virtR) patch.location = ch.place;
    Calendar.Events.patch(patch, calId_(), ev.id, { sendUpdates: s.testMode !== false ? 'none' : 'all' });
    var whenNow = whenText_(ch.start);
    setTrackingDateWho_(rec.recordId, type, new Date(ch.start), who.join('/'));
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + (r.committeeOnly ? Booking.followupLog('moved', whenNow, who) : Booking.label(type) + ' moved to ' + whenNow) +
      (virtR ? '' : ' at ' + ch.place));
    if (r.notifyUnit) {
      eborMail_(rec, 'moved', whenNow, virtR ? '' : ch.place, { start: evStart, where: String(ev.location || ''), newStart: ch.start,
        placeChanged: !!ch.placeChanged }, '', true);
    } else {
      var mv = Booking.movedEmail(Booking.label(type), rec.fields.scout_name, whenNow, virtR ? '' : ch.place, pageUrl_());
      mailFromTemplate_('Moved: ' + Booking.label(type), { scout: String(rec.fields.scout_name), type: Booking.label(type), when: whenNow,
        where: virtR ? '' : ch.place, pageLink: pageUrl_() },
        { committee: true, by: '', recordId: rec.recordId, scout: String(rec.fields.scout_name),
          to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc, subject: mv.subject, body: mv.body });
    }
    report.moved++;
  }
  if (s.testMode !== false) {
    var line = 'TEST MODE. Would have invited: ' + intended.join(', ');
    var desc = String(ev.description || '').replace(/^TEST MODE\. Would have invited: [^\n]*/, line);
    if (desc !== ev.description) { Calendar.Events.patch({ description: desc }, calId_(), ev.id, { sendUpdates: 'none' }); report.added++; }
  } else {
    var current = (ev.attendees || []).map(function (a) { return a.email; });
    var gc = Booking.guestChanges(intended, current, c.map(function (m) { return m.email; }));
    if (gc.add.length || gc.remove.length) {
      var all = (ev.attendees || []).filter(function (a) { return gc.remove.indexOf(String(a.email).toLowerCase()) < 0; })
        .concat(gc.add.map(function (e) { return { email: e }; }));
      Calendar.Events.patch({ attendees: all }, calId_(), ev.id, { sendUpdates: 'all' });
      report.added += gc.add.length;
      report.removed += gc.remove.length;
    }
  }
  var cols = Records.columns();
  var whoCol = r.whoCol ? s[r.whoCol] : '';              // a Follow-Up / Consult has no tracking Who column
  if (whoCol && cols.indexOf(whoCol) >= 0 && String(rec.fields[whoCol] || '') !== who.join('/')) {
    var upd = {}; upd[whoCol] = who.join('/');
    Records.update(rec.recordId, upd);
  }
  return report;
}

/** Hourly time trigger (installed by Admin → Install sheet triggers). */
function syncInvitesHourly() {
  try { syncInvites_(); } catch (e) { console.error('syncInvitesHourly: ' + (e && e.stack || e)); }
  try { healthCheck_(); } catch (e) { console.error('healthCheck_: ' + (e && e.stack || e)); }   // notices a missing digestHourly
}

function menuSyncInvites() {
  if (!councilAccountOk_()) return;
  var r = syncInvites_();
  SpreadsheetApp.getUi().alert('Checked ' + r.checked + ' upcoming booking(s); ' + r.added + ' added, ' + r.removed + ' removed, ' + r.moved + ' moved.');
}

// ---------- units (EBoR) ----------

/**
 * The one EBoR email (Jim W., 2026-10-29): Booked / Moved / Cancelled go To the Scout AND the unit contacts together,
 * Cc the parent/guardian and the committee. (It used to be two emails, and the committee got both.)
 * kind: 'booked' | 'moved' | 'cancelled'. was (moved): {start, where, newStart, placeChanged}: the old time and place,
 * so the email says what changed. by: 'Scout', a member's email, or ''
 * (schedule sync). committee: a committee member caused it (a Review-mode tab then waits in the Outbox).
 * extra: more msg fields (e.g. eventAt). -> mailFromTemplate_'s result.
 */
function eborMail_(rec, kind, whenText, where, was, by, committee, extra) {
  var s = getSettings_();
  var lbl = Booking.label(Booking.EBOR);
  var key = (kind === 'booked' ? 'Booked: ' : kind === 'moved' ? 'Moved: ' : 'Cancelled: ') + lbl;
  var scout = String(rec.fields.scout_name || ''), unit = String(rec.fields.unit || '');
  var u = Units.find(units_(), unit);
  var contacts = u ? u.contacts : [];
  if (!contacts.length) {
    notifyAdmin_('No unit contacts for ' + unit, 'EBoR ' + kind + ' for ' + scout + ': the email went to the Scout and parent only, because ' +
      'neither the Key 3 nor the Unit Contacts tab has a contact for ' + unit + '. Notify the unit by hand.');
  }
  var mv = was && typeof was === 'object' ? Booking.changeWords(Number(was.start), Number(was.newStart), !!was.placeChanged) : null;
  var vars = { scout: scout, unit: unit, type: lbl, when: whenText, where: String(where || ''), pageLink: pageUrl_(),
    was: mv && mv.timeChanged ? whenText_(Number(was.start)) : '', wasWhere: mv && was.placeChanged ? String(was.where || '') : '',
    change: mv ? mv.subject : '', changeText: mv ? mv.text : '',
    // Only a unit that fills its own board gets the ask (under review: the committee fills it).
    boardLink: kind === 'booked' && u && !u.underReview && contacts.length ? pageUrl_() : '',
    committeeEmail: String(s.committeeGroupEmail || '') };
  var built = reviewBuiltIn_(TemplateCatalog.get(key), vars);
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail, contacts);
  var res = mailFromTemplate_(key, vars, Object.assign({ committee: !!committee, by: by || '', recordId: rec.recordId, scout: scout,
    to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: built.subject, body: built.body }, extra || {}));
  if (contacts.length && !FORCE_OUTBOX_) addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] EBoR ' + kind +
    ' email to the Scout and unit ' + u.unit + (kind === 'booked' && u.underReview ? ' (under review: no board request)' : ''));
  return res;
}

/** Schedule sheet edited (installable trigger): members move booked slots or add reps; keep invites in step. */
function onScheduleEdit(e) {
  try { if (e && e.range && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) handleScheduleNameEdit_(e); }
  catch (err) { console.error('handleScheduleNameEdit_: ' + (err && err.stack || err)); }
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sched:busy')) return;
    cache.put('sched:busy', '1', 10);
    syncInvites_();
  } catch (err) { console.error('onScheduleEdit: ' + (err && err.stack || err)); }
}

/**
 * Committee booking on the schedule sheet (runs as the trigger owner, cc-advancement):
 *  - type a Scout's name into an open bookable slot → linked to the Scout, invite + email + row move (like the menu);
 *  - clear the name of a booked slot → booking cancelled (invite removed, Scout emailed, row moved back).
 * Problems are shown as a note on the name cell ("Not linked: …").
 */
function handleScheduleNameEdit_(e) {
  var sh = e.range.getSheet();
  if (sh.getSheetId() !== scheduleSheet_().getSheetId()) return;
  var sched = readSchedule_();
  if (sched.map.scout_name === undefined || e.range.getColumn() !== sched.map.scout_name + 1) return;
  var row = sched.rows.filter(function (x) { return x._row === e.range.getRow(); })[0];
  if (!row) return;
  var name = String(e.value == null ? '' : e.value).trim();
  var linked = String(row.record_id || '').trim();
  var by = editor_(e) || 'committee (schedule sheet)';
  var note = function (t) { try { e.range.setNote(t); } catch (x) {} };
  if (!name && linked) {
    var r0 = Records.get(linked);
    if (r0) { try { cancelBooking_(r0, by, false, Booking.isCommitteeOnly(Booking.typeCode(row.slot_type)) ? String(row._key) : ''); note(''); } catch (err) { note('Not cancelled: ' + (err.userMessage || err.message)); } }
    return;
  }
  if (!name) return;
  if (linked) { note('Already booked for another Scout. To change it: clear the name (cancels), then type the new name.'); return; }
  var type = Booking.typeCode(row.slot_type);
  if (Booking.BOOKED_TYPES.indexOf(type) < 0) return;      // not a bookable slot (e.g. committee meeting): leave it alone
  var m = Booking.matchScout(Records.all(['scout_name', 'unit', 'preferred_name']), name, row.unit, Units.code);
  if (m.error) { note('Not linked: ' + m.error); return; }
  try {
    bookSlot_(Records.get(m.recordId), type, String(row._key), by, 0, true);
    note('');
  } catch (err) { note('Not linked: ' + (err.userMessage || err.message)); }
}

// ---------- shared booking steps (Scout page and committee menu) ----------

function setTrackingDateWho_(recordId, type, date, whoText) {
  var s = getSettings_();
  var r = Booking.rules(type);
  if (!r.dateCol) return;                                  // Follow-Up / Consult: no tracking date or Who column
  var cols = Records.columns();
  var upd = {};
  if (cols.indexOf(s[r.dateCol]) >= 0) upd[s[r.dateCol]] = date;
  if (cols.indexOf(s[r.whoCol]) >= 0) upd[s[r.whoCol]] = whoText;
  if (Object.keys(upd).length) Records.update(recordId, upd);
}

/**
 * Claim a slot for a record, then invite, row move, tracking columns, log, email.
 * by: 'Scout' or the committee member's email. leadHours: 0 for the committee.
 */
function bookSlot_(rec, type, slotKey, by, leadHours, prefilled) {
  var s = getSettings_();
  var r = Booking.rules(type);
  var lbl = Booking.label(type);
  var shadow = by !== 'Scout' && Booking.isShadowType(type, s);   // not online yet: mirror of an old-system booking
  if (!shadow && r.notifyUnit && !units_().length) notifyAdmin_('No unit contacts', 'EBoR booked but the Key 3 and Unit Contacts tabs list no units, so no unit was notified.');
  var slot = withLock_(function () {
    var sched = readSchedule_();
    if (!r.multiple && Booking.currentBooking(sched.rows, rec.recordId, type, Date.now())) {
      throw userError_('You already have a ' + lbl + ' booked. Cancel it first to pick another time.');
    }
    // prefilled: a committee member typed the Scout's name into the slot on the schedule sheet; treat it as open.
    var rows = !prefilled ? sched.rows : sched.rows.map(function (x) {
      return String(x._key) === slotKey && !String(x.record_id || '').trim() ? Object.assign({}, x, { scout_name: '' }) : x;
    });
    var open = Booking.openSlots(rows, type, Date.now(), leadHours, { committee: by !== 'Scout' });   // committee may fill a reserved slot
    var hit = open.filter(function (x) { return x.key === slotKey; })[0];
    var row = sched.rows.filter(function (x) { return String(x._key) === slotKey; })[0];
    if (!hit) {
      if (row && by !== 'Scout' && !Booking.isStaffed(row) && !String(row.record_id || '').trim()) {
        throw userError_('No committee member is on that slot yet. Add one before booking a Scout into it.');
      }
      throw userError_('Sorry, that time was just taken or is no longer available. Please pick another.');
    }
    var cells = { scout_name: rec.fields.scout_name, unit: rec.fields.unit, record_id: rec.recordId };
    if (sched.map.reserved !== undefined && Booking.isReserved(row)) cells.reserved = '';   // the reservation is used up
    if (shadow) cells.event_id = Booking.SHADOW;
    writeSchedule_(sched, row._row, cells);
    hit._row = row._row;
    return hit;
  });

  if (shadow) {
    var moveS = CommitteeSchedule.moveOnBook(rec.section, type);
    if (moveS) Records.move(rec.recordId, moveS);
    setTrackingDateWho_(rec.recordId, type, new Date(slot.start), slot.who.join('/'));
    var whenS = whenText_(slot.start);
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + lbl + ' booked for ' + whenS +
      (slot.who.length ? ' with ' + slot.who.join('/') : '') + ' (by ' + by + '; shadow: recorded only, scheduled on the old system)');
    return { when: whenS, member: '', meetUrl: '', where: Booking.isVirtual(type, slot) ? '' : Booking.place(slot), shadow: true, mailQueued: false, outboxId: '' };
  }

  var people = Booking.resolveWho(slot.who, committee_());
  var ev = { id: '', meetUrl: '' };
  try {
    ev = createBookingEvent_(type, rec, slot, people);
    withLock_(function () { writeSchedule_(readSchedule_(), slot._row, { event_id: ev.id }); });
  } catch (err) {
    console.error('Calendar invite failed: ' + (err && err.stack || err));
    notifyAdmin_('Calendar invite failed for ' + rec.recordId,
      'The slot is booked but no invite was created. Send one by hand.\n\n' + (err && err.stack || err));
  }
  if (people.unknown.length) {
    notifyAdmin_('Unknown committee initials: ' + people.unknown.join(', '),
      'Add them to the Committee tab (Name | Initials | Email) so they get ' + lbl + ' invites.');
  }

  // Move only from the stages before "Booked" (lib/committeeSchedule.js MOVE_FROM); a Scout elsewhere stays put.
  var moveTo = CommitteeSchedule.moveOnBook(rec.section, type);
  if (moveTo) Records.move(rec.recordId, moveTo);
  setTrackingDateWho_(rec.recordId, type, new Date(slot.start), slot.who.join('/'));
  var when = whenText_(slot.start);
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + (r.committeeOnly ? Booking.followupLog('booked', when, slot.who, by)
    : lbl + ' booked for ' + when + (slot.who.length ? ' with ' + slot.who.join('/') : '') + ' (by ' + by + ')') + (ev.id ? '' : '. NO INVITE: calendar failed'));

  var shown = r.showWho ? people.names.join(', ') : '';
  var virtS = Booking.isVirtual(type, slot);
  var m = r.committeeOnly ? Booking.followupBookedEmail(rec.fields.scout_name, when, shown, ev.meetUrl, virtS ? '' : Booking.place(slot))
    : Booking.bookedEmail(lbl, rec.fields.scout_name, when, shown, ev.meetUrl, pageUrl_(), virtS ? '' : Booking.place(slot));
  var mailRes = r.notifyUnit ? eborMail_(rec, 'booked', when, virtS ? '' : Booking.place(slot), '', by, by !== 'Scout')
    : mailFromTemplate_('Booked: ' + lbl, { scout: String(rec.fields.scout_name), type: lbl, when: when, where: virtS ? '' : Booking.place(slot),
    with: shown, meetLink: ev.meetUrl || '', pageLink: pageUrl_() }, {
    committee: by !== 'Scout', by: by, recordId: rec.recordId, scout: String(rec.fields.scout_name), to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: m.subject, body: m.body });
  return { when: when, member: shown, meetUrl: ev.meetUrl, where: virtS ? '' : Booking.place(slot),
    mailQueued: !!(mailRes && mailRes.queued), outboxId: (mailRes && mailRes.id) || '' };
}

/** The record's upcoming booking of any bookable type: {type, b} or null. */
function upcomingBooking_(rows, recordId) {
  for (var i = 0; i < Booking.BOOKABLE.length; i++) {
    var b = Booking.currentBooking(rows, recordId, Booking.BOOKABLE[i], Date.now());
    if (b) return { type: Booking.BOOKABLE[i], b: b };
  }
  return null;
}

/**
 * Cancel the record's upcoming booking. slotKey (optional): cancel the booking in that schedule row instead (a Scout can
 * have several Follow-Ups / Consults). A Follow-Up / Consult row is removed from the schedule: it is never open for booking.
 */
function cancelBooking_(rec, by, enforceCutoff, slotKey) {
  var s = getSettings_();
  var hit = withLock_(function () {
    var sched = readSchedule_();
    var cur = slotKey ? Booking.bookingAt(sched.rows, rec.recordId, slotKey) : upcomingBooking_(sched.rows, rec.recordId);
    if (!cur) throw userError_('No upcoming booking to cancel.');
    if (slotKey && !(cur.b.start >= Date.now() - 3600 * 1000)) throw userError_('That session has already happened.');
    if (enforceCutoff && !Booking.canCancel(cur.b.start, Date.now(), s.cancelCutoffHours)) {
      throw userError_('It is less than ' + (s.cancelCutoffHours || 24) + ' hours away. Please email the committee to change it.');
    }
    var row = sched.rows.filter(function (x) { return String(x._key) === cur.b.key; })[0];
    if (Booking.isCommitteeOnly(cur.type)) { sched.sheet.deleteRow(row._row); readSchedule_._memo = null; }
    else writeSchedule_(sched, row._row, { scout_name: '', unit: '', record_id: '', event_id: '' });
    return cur;
  });
  var r = Booking.rules(hit.type);
  var lbl = Booking.label(hit.type);
  if (Booking.isShadow(hit.b.eventId)) {
    setTrackingDateWho_(rec.recordId, hit.type, '', '');
    var now0 = Records.get(rec.recordId);
    if (r.cancelBackTo && now0 && now0.section === r.movesTo) Records.move(rec.recordId, r.cancelBackTo);
    var when0 = whenText_(hit.b.start);
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + lbl + ' on ' + when0 + ' cancelled (by ' + by + '; shadow: no email)');
    return { when: when0, label: lbl, shadow: true, mailQueued: false, outboxId: '' };
  }
  deleteBookingEvent_(hit.b.eventId);
  setTrackingDateWho_(rec.recordId, hit.type, '', '');
  if (r.cancelBackTo) {
    var now = Records.get(rec.recordId);
    if (now && now.section === r.movesTo) Records.move(rec.recordId, r.cancelBackTo);
  }
  var when = whenText_(hit.b.start);
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + (r.committeeOnly ? Booking.followupLog('cancelled', when, [], by)
    : lbl + ' on ' + when + ' cancelled (by ' + by + ')'));
  var m = r.committeeOnly ? Booking.followupCancelledEmail(rec.fields.scout_name, when) : Booking.cancelledEmail(lbl, rec.fields.scout_name, when, pageUrl_());
  var mailRes = r.notifyUnit ? eborMail_(rec, 'cancelled', when, Booking.place(hit.b), '', by, by !== 'Scout')
    : mailFromTemplate_('Cancelled: ' + lbl, { scout: String(rec.fields.scout_name), type: lbl, when: when, pageLink: pageUrl_() }, {
    committee: by !== 'Scout', by: by, recordId: rec.recordId, scout: String(rec.fields.scout_name), to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: m.subject, body: m.body });
  return { when: when, label: lbl, mailQueued: !!(mailRes && mailRes.queued), outboxId: (mailRes && mailRes.id) || '' };
}

/** Type the Scout in this section books online now (Settings → onlineBooking), or null. */
function onlineType_(section) { return Booking.onlineType(section, getSettings_()); }

/** For myRecord: what the Scout can book or has booked. */
function bookingInfo_(rec) {
  var s = getSettings_();
  var out = { canBook: null, booking: null, followups: [] };
  try {
    var cur = upcomingBooking_(readSchedule_().rows, rec.recordId);
    if (cur) {
      var r = Booking.rules(cur.type);
      out.booking = { type: Booking.label(cur.type), when: whenText_(cur.b.start),
        member: r.showWho ? Booking.resolveWho(cur.b.who, committee_()).names.join(', ') : '',
        where: Booking.isVirtual(cur.type, cur.b) ? '' : Booking.place(cur.b),
        meetUrl: Booking.isVirtual(cur.type, cur.b) ? meetUrlFor_(cur.b.eventId) : '',
        // Scouts cancel only types booked online (an old-way booking given an invitation stays the committee's to change)
        canCancel: !Booking.isShadow(cur.b.eventId) && Booking.parseOnline(s.onlineBooking).codes.indexOf(cur.type) >= 0 &&
          Booking.canCancel(cur.b.start, Date.now(), s.cancelCutoffHours) };
      out.booking.canChange = out.booking.canCancel && Booking.parseOnline(s.onlineBooking).codes.indexOf(cur.type) >= 0;
    } else {
      var type = onlineType_(rec.section);
      if (type) out.canBook = Booking.label(type);
      var byC = Booking.committeeType(rec.section, s);
      if (byC) out.byCommittee = Booking.label(byC);
    }
    // Follow-Ups / Consults the committee made for this Scout: shown like any booked session, never changed by the Scout.
    var rows = readSchedule_().rows, c = committee_();
    out.followups = Booking.upcomingBookings(rows, rec.recordId, Booking.FOLLOWUP, Date.now()).map(function (b) {
      var virt = Booking.isVirtual(Booking.FOLLOWUP, b);
      return { type: Booking.label(Booking.FOLLOWUP), when: whenText_(b.start), member: Booking.resolveWho(b.who, c).names.join(', '),
        where: virt ? '' : Booking.place(b), meetUrl: virt && !Booking.isShadow(b.eventId) ? meetUrlFor_(b.eventId) : '' };
    });
  } catch (e) { console.warn('bookingInfo_: ' + e); }
  return out;
}

// ---------- Scout actions ----------

function actionSlots_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  var type = onlineType_(o.rec.section);
  if (req.change) {                                              // "Change time": the type of the current booking
    var cur = upcomingBooking_(readSchedule_().rows, o.rec.recordId);
    type = cur && Booking.parseOnline(getSettings_().onlineBooking).codes.indexOf(cur.type) >= 0 ? cur.type : null;
  }
  if (!type) throw userError_('Booking opens when the committee is ready for your next step.');
  var s = getSettings_();
  var r = Booking.rules(type);
  var c = committee_();
  var slots = Booking.openSlots(readSchedule_().rows, type, Date.now(), s[r.lead]).slice(0, 40).map(function (x) {
    return { key: x.key, when: whenText_(x.start), start: x.start, end: x.start + x.minutes * 60000,
      member: r.showWho ? Booking.resolveWho(x.who, c).names.join(', ') : '',
      where: Booking.isVirtual(type, x) ? Booking.ONLINE_PLACE : Booking.place(x) };
  });
  return { type: Booking.label(type), showWho: r.showWho, adult: r.adult, slots: slots,
    adultNotice: !r.adult ? '' : r.virtual ? Booking.ADULT : Booking.ADULT_IN_PERSON };
}

function actionBook_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  var type = onlineType_(o.rec.section);
  if (!type) throw userError_('Booking opens when the committee is ready for your next step.');
  var r = Booking.rules(type);
  if (r.adult && req.adultConfirmed !== true) throw userError_('Please confirm that a parent or another adult 21+ will be with you.');
  var res = bookSlot_(o.rec, type, String(req.slotKey || ''), 'Scout', getSettings_()[r.lead]);
  return { message: 'Booked: ' + res.when + (res.member ? ' with ' + res.member : '') + (res.where ? ' at ' + res.where : '') +
    '. We emailed a confirmation and a calendar invitation.', when: res.when, meetUrl: res.meetUrl };
}

/**
 * "Change time" in one step: the new time is booked before the old one is given up for good, so the Scout never
 * ends up with nothing. Same rules as cancelling (not shadow, not inside the cutoff) and booking (lead time).
 */
function actionChangeBooking_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  var s = getSettings_();
  var rows = readSchedule_().rows;
  var cur = upcomingBooking_(rows, o.rec.recordId);
  if (!cur) throw userError_('No booking to change. Reload the page.');
  if (Booking.isShadow(cur.b.eventId)) throw userError_('To change this booking, please email the committee.');
  if (Booking.parseOnline(s.onlineBooking).codes.indexOf(cur.type) < 0) throw userError_('To change this booking, please email the committee.');
  if (!Booking.canCancel(cur.b.start, Date.now(), s.cancelCutoffHours)) throw userError_('It is less than ' + (s.cancelCutoffHours || 24) + ' hours away. Please email the committee to change it.');
  var key = String(req.slotKey || '');
  if (key === cur.b.key) throw userError_('That is your current time.');
  var r = Booking.rules(cur.type);
  if (r.adult && req.adultConfirmed !== true) throw userError_('Please confirm that a parent or another adult 21+ will be with you.');
  var open = Booking.openSlots(rows, cur.type, Date.now(), s[r.lead]).some(function (x) { return x.key === key; });
  if (!open) throw userError_('That time is no longer available. Please pick another.');
  var lbl = Booking.label(cur.type), oldWhen = whenText_(cur.b.start);
  // Release the old slot (no cancel email, no row move), then book the new one; if that fails, take the old one back.
  withLock_(function () {
    var s2 = readSchedule_();
    var old = s2.rows.filter(function (x) { return String(x._key) === cur.b.key; })[0];
    if (old && String(old.record_id) === o.rec.recordId) writeSchedule_(s2, old._row, { scout_name: '', unit: '', record_id: '', event_id: '' });
  });
  var res;
  try { res = bookSlot_(o.rec, cur.type, key, 'Scout', s[r.lead]); }
  catch (e) {
    try { bookSlot_(o.rec, cur.type, cur.b.key, 'Scout', 0); } catch (e2) { notifyAdmin_('Change time failed twice', o.rec.recordId + ': ' + e2.message); }
    throw userError_('Could not move to that time (' + (e.userMessage || e.message) + '). You still have ' + oldWhen + '.');
  }
  deleteBookingEvent_(cur.b.eventId);                            // the old invitation is withdrawn
  addRecordNote_(o.rec.recordId, Intake.shortDate(new Date()) + ' [Scout] ' + lbl + ' moved from ' + oldWhen + ' to ' + res.when);
  return { message: 'Changed: your ' + lbl + ' is now ' + res.when + (res.where ? ' at ' + res.where : '') +
    '. We emailed a new confirmation and calendar invitation.' };
}

function actionCancelBooking_(req) {
  var o = ownedRecord_(req.session, req.recordId);
  var curS = upcomingBooking_(readSchedule_().rows, o.rec.recordId);
  if (curS && Booking.isShadow(curS.b.eventId)) throw userError_('To change this booking, please email the committee.');
  if (curS && Booking.parseOnline(getSettings_().onlineBooking).codes.indexOf(curS.type) < 0) throw userError_('To change this booking, please email the committee.');
  var res = cancelBooking_(o.rec, 'Scout', true);
  return { message: 'Cancelled your ' + res.label + ' on ' + res.when + '. You can pick a new time now.' };
}

// ---------- committee menu (tracking tab) ----------

function selectedRecord_() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== getSettings_().trackingTab) throw new Error('Select a Scout\'s row on the "' + getSettings_().trackingTab + '" tab first.');
  var row = sh.getActiveRange().getRow();
  var md = sh.getRange(1, 1, Math.min(15, sh.getLastRow()), sh.getLastColumn()).getValues();
  var m = SheetModel.findMachineRow(md);
  if (!m) throw new Error('Tracking tab has no machine header row.');
  var id = String(sh.getRange(row, m.keyCol + 1).getValue());
  if (!SheetModel.isRecordId(id)) throw new Error('That row is not a Scout record. Click a cell in the Scout\'s row.');
  return Records.get(id);
}

function actor_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (x) {}
  return e || 'committee';
}

/** "Book your <next step>" email for the section the Scout is in (Pre-Review Call or Proposal Review). */
function sendBookingInvite_(rec, type, by) {
  var s = getSettings_();
  var m = Booking.bookingLinkEmail(type || Booking.PRE_REVIEW, rec.fields.scout_name, pageUrl_());
  return mailFromTemplate_('Book: ' + Booking.label(type || Booking.PRE_REVIEW), { scout: String(rec.fields.scout_name), pageLink: pageUrl_() }, {
    committee: true, by: by || '', recordId: rec.recordId, scout: String(rec.fields.scout_name),
    to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: m.subject, body: m.body });
}

function notOnlineMsg_(section) {
  var t = Booking.bookableType(section);
  if (t) return Booking.label(t) + ' is not booked online yet (Settings → onlineBooking): schedule it the usual way and enter the date on the tracking tab.';
  var s = getSettings_();
  var names = Booking.BOOKABLE_SECTIONS.map(function (k) { return SettingsModel.sectionLabel(s, k); });   // names from Settings
  return 'Only for Scouts in ' + names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] + '.';
}

function menuIntakeOk() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var rec = selectedRecord_();
    var toBook = SettingsModel.sectionLabel(getSettings_(), 'intake_to_book');
    if (rec.section === 'intake_to_book') { ui.alert(rec.fields.scout_name + ' is already in ' + toBook + '. Use "Resend booking link" instead.'); return; }
    var online = !!Booking.onlineType('intake_to_book', getSettings_());
    if (ui.alert('Intake OK for ' + rec.fields.scout_name + '?',
      'Moves the row to "' + toBook + '"' + (online ? ' and emails the Scout and parent a link to book the call.' : '. Pre-Review Calls are not booked online (Settings → onlineBooking): no email is sent.'),
      ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    Records.move(rec.recordId, 'intake_to_book');
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] Intake OK (by ' + actor_() + ')' + (online ? '; booking link sent' : ''));
    if (online) sendBookingInvite_(rec, Booking.PRE_REVIEW, actor_());
    ui.alert('Done. ' + rec.fields.scout_name + (online ? ' can now book a Pre-Review Call.' : ' is in ' + toBook + '; schedule the call the usual way.'));
  } catch (e) { ui.alert(e.message); }
}

function menuResendBookingLink() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var rec = selectedRecord_();
    var type = onlineType_(rec.section);
    if (!type) { ui.alert(notOnlineMsg_(rec.section)); return; }
    sendBookingInvite_(rec, type, actor_());
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [tool] ' + Booking.label(type) + ' booking link resent (by ' + actor_() + ')');
    ui.alert('Sent.');
  } catch (e) { ui.alert(e.message); }
}

function menuBookOnBehalf() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var rec = selectedRecord_();
    var type = onlineType_(rec.section);
    if (!type) { ui.alert(notOnlineMsg_(rec.section)); return; }
    var lbl = Booking.label(type);
    var open = Booking.openSlots(readSchedule_().rows, type, Date.now(), 0, { noLead: true }).slice(0, 25);
    if (!open.length) { ui.alert('No open ' + lbl + ' slots. Add rows to the schedule sheet first.'); return; }
    var list = open.map(function (x, i) {
      return (i + 1) + '. ' + whenText_(x.start) + (x.who.length ? '  ' + x.who.join('/') : '') + (x.location ? '  ' + x.location : '');
    }).join('\n');
    var r = ui.prompt('Book a ' + lbl + ' for ' + rec.fields.scout_name, list + '\n\nType the number:', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var n = Number(r.getResponseText());
    if (!(n >= 1 && n <= open.length)) { ui.alert('Not a number from the list.'); return; }
    var res = bookSlot_(rec, type, open[n - 1].key, actor_(), 0);
    ui.alert('Booked ' + res.when + '. Invite + confirmation sent.');
  } catch (e) { ui.alert(e.userMessage || e.message); }
}

function menuCancelBooking() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var rec = selectedRecord_();
    if (ui.alert('Cancel the upcoming booking for ' + rec.fields.scout_name + '?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
    var res = cancelBooking_(rec, actor_(), false);
    ui.alert('Cancelled the ' + res.label + ' on ' + res.when + '. The Scout was emailed.');
  } catch (e) { ui.alert(e.userMessage || e.message); }
}
