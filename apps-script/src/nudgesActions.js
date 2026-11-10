/**
 * Hourly nudges and the digest's "Awaiting action" list (rules in lib/nudges.js). Runs from digestHourly.
 *   4.1.h "Unit Board Members missing"  -> Outbox      6.2.c "Please book" -> Outbox
 *   6.2.b "Session briefing"            -> sent to the members on the slot, the day before
 *   6.9.e health check                  -> adminEmail, once a day (from syncInvitesHourly too, so a dead trigger is noticed)
 * Each email once: Script Properties "bm:" / "pb:" / "br:" keys.
 */
var STAGE_SINCE_COL = '_stage_since';

function nudgeDone_() {
  var all = PropertiesService.getScriptProperties().getProperties(), done = {};
  Object.keys(all).forEach(function (k) { if (/^(bm|pb|br):/.test(k)) done[k] = true; });
  return done;
}

function committeeUrl_() { return String(getSettings_().webOrigin).replace(/\/+$/, '') + '/committee'; }

/** Records with days in their stage; writes _stage_since where the stage changed (or it was empty). */
function stageDays_() {
  var has = Records.columns().indexOf(STAGE_SINCE_COL) >= 0;
  var recs = Records.all(['scout_name', 'unit', 'preferred_name', has ? STAGE_SINCE_COL : 'scout_name']).filter(function (r) { return String(r.scout_name || '').trim(); });
  if (!has) return recs.map(function (r) { r.days = null; return r; });
  var st = Nudges.stageSince(recs.map(function (r) { return { recordId: r.recordId, section: r.section, since: r[STAGE_SINCE_COL] }; }), todayYmd_());
  st.updates.forEach(function (u) { try { var f = {}; f[STAGE_SINCE_COL] = u.value; Records.update(u.recordId, f); } catch (e) { console.warn('stage since: ' + e); } });
  return recs.map(function (r) { r.days = st.days[r.recordId]; return r; });
}

function runNudges_() {
  var s = getSettings_();
  var props = PropertiesService.getScriptProperties();
  var done = nudgeDone_();
  var now = Date.now();
  var recs = stageDays_();
  var byId = {};
  recs.forEach(function (r) { byId[r.recordId] = r; });
  var sent = 0;
  // 6.2.c please book
  var bookDays = Nudges.parseBookDays(s.pleaseBookDays);              // Settings → pleaseBookDays (per session type)
  if (bookDays.errors.length) console.warn(bookDays.errors.join(' '));
  Nudges.pleaseBook(recs.filter(function (r) { return r.days != null; }), Booking.parseOnline(s.onlineBooking).codes, done, bookDays.days).forEach(function (x) {
    try {
      draftPleaseBook_(Records.get(x.recordId), x.type, x.days);
      props.setProperty(x.key, String(now)); sent++;
    } catch (e) { console.error('please book ' + x.key + ': ' + e); }
  });
  var sched;
  try { sched = readSchedule_(); } catch (e) { return sent; }
  var units = units_();
  var slots = sched.rows.filter(function (r) { return String(r.record_id || '').trim(); }).map(function (r) {
    var id = String(r.record_id).trim(), rec = byId[id] || {};
    var u = Units.find(units, rec.unit || '');
    return { key: String(r._key || ''), recordId: id, start: Booking.slotStart(r.date, r.time) || 0, section: rec.section || '',
      type: Booking.typeCode(r.slot_type), board: String(r.board_members || ''), reps: String(r.reps || ''), underReview: !!(u && u.underReview), row: r };
  });
  // 4.1.h Unit Board Members missing
  Nudges.boardMissing(slots.filter(function (x) { return x.type === 'EBoR'; }), now, 7, done).forEach(function (x) {
    try {
      var ok = draftBoardMissing_(Records.get(x.recordId), x.row, x.start);   // false: no unit contacts (the admin is told)
      props.setProperty(x.nudgeKey, String(now)); if (ok) sent++;
    } catch (e) { console.error('board missing ' + x.nudgeKey + ': ' + e); }
  });
  // 6.2.b briefing for the members on the slot
  Nudges.briefings(slots, now, done).forEach(function (x) {
    try {
      var ok = sendBriefing_(Records.get(x.recordId), x.row, x.start, x.type);
      props.setProperty(x.nudgeKey, String(now)); if (ok) sent++;
    } catch (e) { console.error('briefing ' + x.nudgeKey + ': ' + e); }
  });
  return sent;
}

// ---- the emails themselves (also used by the "Email…" action, emailActions.js) ----

/** 6.2.c Please book → Outbox. type: 'Intake' | 'ESSPPR' | 'EBoR'; days: days in the stage ('' if unknown). */
function draftPleaseBook_(rec, type, days) {
  var s = getSettings_();
  var scout = String(rec.fields.scout_name || '');
  var vars = { scout: scout, firstName: EagleDone.firstName(scout, rec.fields.preferred_name), session: Booking.label(type), days: days === '' || days == null ? 'several' : String(days), pageLink: pageUrl_() };
  var p = reviewBuiltIn_(TemplateCatalog.get('Please book'), vars);
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail);
  return mailFromTemplate_('Please book', vars, { to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: p.subject, body: p.body, committee: true, outbox: true, by: 'Eagle Tracker', recordId: rec.recordId, scout: scout });
}

/** 4.1.h Unit Board Members missing → Outbox. False when the unit has no contacts. */
function draftBoardMissing_(rec, row, start) {
  var s = getSettings_();
  var u = Units.find(units_(), rec.fields.unit);
  if (!u || !u.contacts.length) return false;
  var scout = String(rec.fields.scout_name || '');
  var vars = { scout: scout, unitName: EagleDone.unitName(rec.fields.unit), when: whenText_(start), where: Booking.place(row) || 'to be confirmed', pageLink: pageUrl_() };
  var p = reviewBuiltIn_(TemplateCatalog.get('Unit Board Members missing'), vars);
  return mailFromTemplate_('Unit Board Members missing', vars, { to: u.contacts, cc: s.committeeGroupEmail, subject: p.subject, body: p.body,
    committee: true, outbox: true, by: 'Eagle Tracker', recordId: rec.recordId, scout: scout, eventAt: start });
}

/** 6.2.b briefing to the committee members on the slot (sent; drafted when called from "Email…"). False when nobody to tell. */
function sendBriefing_(rec, row, start, type) {
  if (!rec) return false;
  var reps = Booking.resolveWho(Booking.splitWho(row.reps), committee_());
  if (!reps.emails.length) return false;
  var scout = String(rec.fields.scout_name || '');
  var f = rec.fields;
  var vars = { scout: scout, unitName: EagleDone.unitName(f.unit), session: Booking.label(type), when: whenText_(start),
    where: Booking.place(row) || 'to be confirmed', members: reps.names.join(', '),
    folderLink: f._folder_id ? 'https://drive.google.com/drive/folders/' + f._folder_id : '',
    logLink: f._log_id ? 'https://docs.google.com/document/d/' + f._log_id + '/edit' : '', notes: String(row.notes || ''),
    eagleNumber: type === 'EBoR' ? (eagleAnnounce_()[rec.recordId] || '') : '' };
  var p = reviewBuiltIn_(TemplateCatalog.get('Session briefing'), vars);
  return mailFromTemplate_('Session briefing', vars, { to: reps.emails, cc: '', subject: p.subject, body: p.body, recordId: rec.recordId, scout: scout, eventAt: start });
}

/** Everything the digest lists under "Awaiting action", and the next 7 days. Each part is optional (never throws). */
function digestAwaiting_() {
  var s = getSettings_();
  var now = Date.now();
  var a = {}, upcoming = [];
  function part(name, fn) { try { a[name] = fn(); } catch (e) { console.warn('digest ' + name + ': ' + e); } }
  var dayMs = 24 * 3600 * 1000;
  var recs = [];
  try { recs = stageDays_(); } catch (e) { console.warn('digest stage days: ' + e); }
  var byId = {};
  recs.forEach(function (r) { byId[r.recordId] = r; });
  var title = function (r) { return EagleDone.display(r.scout_name, r.preferred_name) + (r.unit ? ' (' + r.unit + ')' : ''); };
  part('files', function () { return pendingWaiting_(); });
  part('outbox', function () {
    return Tabs.read(OUTBOX_TAB).filter(function (o) { return o['Status'] === Outbox.STATUS.PENDING; }).map(function (o) {
      var c = o['Created'] instanceof Date ? o['Created'].getTime() : Date.parse(o['Created']) || now;
      return { title: String(o['Subject'] || o['Template'] || ''), days: Math.floor((now - c) / dayMs) };
    });
  });
  var sched = null;
  try { sched = readSchedule_(); } catch (e) { console.warn('digest schedule: ' + e); }
  if (sched) {
    part('reviews', function () {
      return Nudges.reviewsDue(sched.rows, function (id) { return byId[id] ? byId[id].section : ''; }, now).map(function (x) {
        return { title: Booking.label(x.type) + ': ' + title(byId[x.recordId]), when: Utilities.formatDate(new Date(x.start), digestTz_(), 'EEE M/d') };
      });
    });
    part('boards', function () {
      return sched.rows.filter(function (r) {
        var id = String(r.record_id || '').trim(), st = Booking.slotStart(r.date, r.time) || 0;
        return id && byId[id] && byId[id].section === 'ebor_booked' && Booking.typeCode(r.slot_type) === 'EBoR' && st > now && st < now + 14 * dayMs &&
          Units.boardSize(r.reps, r.board_members, Booking.splitWho) < Units.BOARD_MIN;
      }).map(function (r) {
        return { title: title(byId[String(r.record_id).trim()]), size: Units.boardSize(r.reps, r.board_members, Booking.splitWho),
          when: Utilities.formatDate(new Date(Booking.slotStart(r.date, r.time)), digestTz_(), 'EEE M/d') };
      });
    });
    // Reserved slots + staffed-before-bookable (reserved-slots-design.md)
    var att = null;
    try { att = CommitteeSchedule.attention(sched.rows, now, s); } catch (e) { console.warn('digest attention: ' + e); }
    var fmt = function (ms) { return Utilities.formatDate(new Date(ms), digestTz_(), 'EEE M/d h:mm a'); };
    if (att) {
      a.unstaffed = att.unstaffed.map(function (x) {
        return { when: fmt(x.start), what: x.booked ? x.label + ': ' + x.scoutName + (x.unit ? ' (' + x.unit + ')' : '')
          : x.reserved ? x.label + ': Reserved' + (x.unit ? ' (' + x.unit + ')' : '') : x.label + ': open', booked: x.booked };
      });
      a.reserved = att.reserved.map(function (x) { return { when: fmt(x.start), what: x.label + (x.unit ? ' for ' + x.unit : '') + (x.location ? ', ' + x.location : '') }; });
    }
    part('openSlots', function () {
      return Booking.parseOnline('all').codes.map(function (code) {
        var open = Booking.openSlots(sched.rows, code, now, 0, { noLead: true }).filter(function (x) { return x.start < now + 30 * dayMs; });
        return { label: Booking.label(code), count: open.length, next: open.length ? Utilities.formatDate(new Date(open[0].start), digestTz_(), 'EEE M/d') : '' };
      });
    });
    sched.rows.forEach(function (r) {
      var id = String(r.record_id || '').trim(), st = Booking.slotStart(r.date, r.time) || 0;
      if (!(st >= now && st < now + 7 * dayMs)) return;
      if (!id && Booking.isReserved(r) && !String(r.scout_name || '').trim()) {          // reserved, no Scout yet
        upcoming.push({ start: st, when: Utilities.formatDate(new Date(st), digestTz_(), 'EEE M/d h:mm a'),
          what: Booking.label(Booking.typeCode(r.slot_type)) + ': Reserved' + (String(r.unit || '').trim() ? ' (' + String(r.unit).trim() + ')' : '') +
            (String(r.reps || '').trim() ? ', ' + String(r.reps).trim() : ', no members yet') });
        return;
      }
      if (!id) return;
      upcoming.push({ start: st, when: Utilities.formatDate(new Date(st), digestTz_(), 'EEE M/d h:mm a'),
        what: Booking.label(Booking.typeCode(r.slot_type)) + ': ' + (byId[id] ? title(byId[id]) : String(r.scout_name || id)) +
          (String(r.reps || '').trim() ? ', ' + String(r.reps).trim() : ', no members yet') });
    });
    upcoming.sort(function (x, y) { return x.start - y.start; });
  }
  part('intake', function () {
    return AdminRules.intakeExceptions(Tabs.read(QUEUE_TAB), now).filter(function (x) { return x.why.indexOf('Waiting for the family') !== 0; })
      .map(function (x) { return { title: (x.scout || x.queueId) + (x.unit ? ' (' + x.unit + ')' : ''), why: x.why }; });
  });
  part('councilApps', function () { return councilAppsToCheck_(); });
  part('signing', function () {                              // Proposal signatures in progress, waiting too long
    return ProposalOutcome.signingOverdue(reviewRecords_().filter(function (r) { return r.section === 'proposal_approved'; }).map(function (r) {
      return { title: byId[r.recordId] ? title(byId[r.recordId]) : String(r.scout_name || ''), signing: r.signing };
    }), todayYmd_(), s.signingNudgeDays);
  });
  part('unitRequests', function () {
    return openUnitRequests_().map(function (x) { return { title: x.unit + ': board for ' + x.scout + ' on ' + x.date + ' ' + x.time + (x.place ? ', ' + x.place : '') }; });
  });
  part('council', function () {
    return Board.councilWaiting(Board.build(boardRecords_(), s.sections, todayYmd_(), s.councilAckDays)).filter(function (x) { return x.overdue; });
  });
  part('closeReview', function () {                         // Proposal Not Approved / EBoR Paused that look terminal (lib/closing.js)
    var why = closeSuggestions_();
    return Object.keys(why).filter(function (id) { return byId[id]; }).map(function (id) { return { title: title(byId[id]), why: why[id] }; });
  });
  a.toBook = recs.filter(function (r) { return Nudges.TO_BOOK[r.section] && r.days != null; })
    .map(function (r) { return { title: title(r), stage: SettingsModel.sectionLabel(s, r.section), days: r.days, type: Nudges.TO_BOOK[r.section] }; });
  return { groups: Nudges.awaiting(a), upcoming: upcoming };
}

/** 6.9.e: once a day, tell the admin when the digest has gone quiet or a trigger is missing. */
function healthCheck_() {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), digestTz_(), 'yyyy-MM-dd');
  if (props.getProperty('HEALTH_DAY') === day) return;
  props.setProperty('HEALTH_DAY', day);
  var probs = [];
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  ['digestHourly', 'syncInvitesHourly'].forEach(function (f) { if (have.indexOf(f) < 0) probs.push('The hourly trigger ' + f + ' is not installed.'); });
  if (have.indexOf('onTrackingEdit') < 0) probs.push('No edit trigger is installed (sheet Actions will not run).');
  var sched = Digest.parseHours(getSettings_().digestHours);
  if (!sched.error && sched.hours.length) {
    try {
      var log = Tabs.read(DIGEST_LOG_TAB);
      var last = log.length ? log[log.length - 1]['Ran at'] : null;
      var t = last instanceof Date ? last.getTime() : Date.parse(last) || 0;
      if (Date.now() - t > 2 * 24 * 3600 * 1000) probs.push('The Digest Log has no row since ' + (t ? new Date(t) : 'ever') + ': the digest is not running.');
    } catch (e) { probs.push('The Digest Log could not be read: ' + e.message); }
  }
  if (probs.length) notifyAdmin_('Eagle Tracker health check', probs.join('\n') + '\n\nFix: Admin → Install sheet triggers, then Self-check.');
}
