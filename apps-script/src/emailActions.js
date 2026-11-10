/**
 * "Email…" on a Scout (dashboard row, detail window; rules in lib/emailMenu.js): (re)draft any email that fits the
 * Scout's stage into the Outbox, using the same code the stage change / booking / hourly run uses (FORCE_OUTBOX_ makes
 * every email a draft by the member). Nothing is sent from here.
 *   emailChoices {session, recordId}              -> {scout, choices:[{key, id, label, ready, why, recent}]}
 *   emailDraft   {session, recordId, key, confirm, note} -> {needsConfirm, warning} | {message, outboxId}
 *   emailBulkList  {session, section, key}         -> {emails:[{key,label}], scouts:[{recordId, name, unit, ready, why, recent}]}
 *   emailBulkDraft {session, key, recordIds}       -> {results:[{recordId, name, ok, message}]}   (Admin page; one draft per Scout)
 */
function nextSlot_(recordId, type) {
  var now = Date.now(), best = null;
  readSchedule_().rows.forEach(function (r) {
    if (String(r.record_id || '').trim() !== recordId) return;
    var t = Booking.typeCode(r.slot_type);
    if (Booking.BOOKABLE.indexOf(t) < 0 || (type && t !== type)) return;
    var st = Booking.slotStart(r.date, r.time) || 0;
    if (!(st >= now - 3600 * 1000)) return;
    if (!best || st < best.start) best = { row: r, start: st, type: t };
  });
  return best;
}

function emailHistory_(recordId) {
  return outboxRows_().filter(function (r) { return String(r['Record ID']) === recordId; }).map(function (r) {
    var at = r['Done'] instanceof Date ? r['Done'].getTime() : r['Created'] instanceof Date ? r['Created'].getTime() : Date.parse(r['Created']) || 0;
    return { template: String(r['Template'] || ''), status: String(r['Status'] || ''), at: at };
  });
}

function emailCtx_(rec, opts) {
  opts = opts || {};
  var slots = { Intake: false, ESSPPR: false, EBoR: false }, hasBooked = false;
  try {
    Object.keys(slots).forEach(function (t) { slots[t] = !!nextSlot_(rec.recordId, t); });
    hasBooked = slots.Intake || slots.ESSPPR || slots.EBoR;
  } catch (e) {}
  var u = null;
  try { u = Units.find(opts.units || units_(), rec.fields.unit); } catch (e) {}
  var req = ScoutFiles.requestFor(rec.fields._request, rec.section);
  return { slots: slots, hasBooked: hasBooked, underReview: !!(u && u.underReview), nowMs: Date.now(), request: req ? req.text : '',
    idOf: function (k) { var x = TemplateCatalog.get(k); return x ? x.id : ''; },
    history: opts.history ? opts.history.filter(function (h) { return h.recordId === rec.recordId; }) : emailHistory_(rec.recordId) };
}

function actionEmailChoices_(req) {
  committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  return { scout: String(rec.fields.scout_name || ''), stage: SettingsModel.sectionLabel(getSettings_(), rec.section),
    choices: EmailMenu.choices(rec.section, emailCtx_(rec)) };
}

function actionEmailDraft_(req) {
  var c = committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  return draftOne_(rec, String(req.key || ''), c.email, req.note, !!req.confirm, emailCtx_(rec));
}

/** One draft (the "Email…" action and the bulk version). note: for note emails (blank = the Scout's last request). */
function draftOne_(rec, key, by, note, confirm, ctx) {
  var pick = EmailMenu.choices(rec.section, ctx).filter(function (x) { return x.key === key; })[0];
  if (!pick) throw userError_('That email does not fit ' + rec.fields.scout_name + '\'s stage. Reload the page.');
  if (!pick.ready) throw userError_(pick.why);
  var text = String(note == null ? '' : note).trim() || pick.noteDefault;
  if (pick.note && !text) throw userError_('Type what the Scout should do (the note goes into the email).');
  if (pick.recent && !confirm) return { needsConfirm: true, warning: pick.label + ': ' + pick.recent + '. Draft it again?' };
  var res;
  FORCE_OUTBOX_ = { by: by };
  try { res = buildEmail_(key, rec, by, text); }
  finally { FORCE_OUTBOX_ = null; }
  if (!res) throw userError_('Nothing was drafted.');
  if (res.reason === 'template off') throw userError_('The template tab for "' + pick.label + '" says Mode: Off.');
  if (!res.queued) throw userError_('Not drafted: ' + (res.reason || 'unknown reason'));
  return { message: pick.label + ' for ' + rec.fields.scout_name + ' is waiting in the Outbox.', outboxId: res.id };
}

/** The email itself, through the code the normal event uses. Returns mailFromTemplate_'s result. */
function buildEmail_(key, rec, by, note) {
  var s = getSettings_();
  var scout = String(rec.fields.scout_name || '');
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail);
  var slot;
  switch (key) {
    case 'Proposal incomplete':
    case 'Revisions before review':
    case 'Revisions requested':
    case 'EBoR paused': {
      var rq = ScoutFiles.requestFor(rec.fields._request, rec.section);
      var nv = { scout: scout, note: String(note || ''), date: StageActions.nice(rq && rq.date ? rq.date : todayYmd_()), pageLink: pageUrl_() };
      var np = reviewBuiltIn_(TemplateCatalog.get(key), nv);
      return mailFromTemplate_(key, nv, { committee: true, outbox: true, by: by, recordId: rec.recordId, scout: scout,
        to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: np.subject, body: np.body });
    }
    case 'Booked: Eagle Board of Review': {   // one email to the Scout and the unit (eborMail_)
      slot = nextSlot_(rec.recordId, 'EBoR');
      return eborMail_(rec, 'booked', whenText_(slot.start), Booking.isVirtual('EBoR', slot.row) ? '' : Booking.place(slot.row), '', by, true,
        { outbox: true, eventAt: slot.start });
    }
    case 'Booked: Pre-Review Call':
    case 'Booked: Proposal Review': {
      var bt = key === 'Booked: Pre-Review Call' ? 'Intake' : 'ESSPPR';
      slot = nextSlot_(rec.recordId, bt);
      var rr = Booking.rules(bt), lbl = Booking.label(bt), when = whenText_(slot.start);
      var shown = rr.showWho ? Booking.resolveWho(Booking.splitWho(slot.row.reps), committee_()).names.join(', ') : '';
      var meet = '';
      var evId = String(slot.row.event_id || '');
      if (evId && !Booking.isShadow(evId)) { try { meet = Calendar.Events.get(calId_(), evId).hangoutLink || ''; } catch (e) {} }
      var where = Booking.isVirtual(bt, slot.row) ? '' : Booking.place(slot.row);
      var bm = Booking.bookedEmail(lbl, scout, when, shown, meet, pageUrl_(), where);
      return mailFromTemplate_(key, { scout: scout, type: lbl, when: when, where: where, with: shown, meetLink: meet, pageLink: pageUrl_() }, {
        committee: true, outbox: true, by: by, recordId: rec.recordId, scout: scout, to: fam.to, cc: fam.cc, keepCc: fam.keepCc,
        subject: bm.subject, body: bm.body, eventAt: slot.start });
    }
    case 'Status + page link':
      return statusOrBookingEmail_(rec, by, true).res;
    case 'Book: Pre-Review Call':
    case 'Book: Proposal Review': {
      var type = key === 'Book: Pre-Review Call' ? 'Intake' : 'ESSPPR';
      if (Booking.onlineType(rec.section, s)) return sendBookingInvite_(rec, type, by);
      var bv = { scout: scout, pageLink: pageUrl_(), scheduleLink: String((type === 'ESSPPR' && s.reviewSignupUrl) || s.eborSignupUrl || '') };
      var bp = reviewBuiltIn_(TemplateCatalog.get(key), bv);
      return mailFromTemplate_(key, bv, { committee: true, outbox: true, by: by, recordId: rec.recordId, scout: scout,
        to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: bp.subject, body: bp.body });
    }
    case 'Please book': {
      var m = /^(\S+)\s+(\d{4}-\d\d-\d\d)$/.exec(String(rec.fields[STAGE_SINCE_COL] || '').trim());
      var days = m && m[1] === rec.section ? Nudges.daysBetween(m[2], todayYmd_()) : '';
      return draftPleaseBook_(rec, Nudges.TO_BOOK[rec.section], days);
    }
    case 'Application submitted: acknowledgement': {
      var av = { scout: scout, firstName: EagleDone.firstName(scout, rec.fields.preferred_name), pageLink: pageUrl_() };
      var ap = reviewBuiltIn_(TemplateCatalog.get(key), av);
      return mailFromTemplate_(key, av, { committee: true, outbox: true, by: by, recordId: rec.recordId, scout: scout,
        to: fam.to, cc: fam.cc, keepCc: fam.keepCc, subject: ap.subject, body: ap.body });
    }
    case 'Book: Eagle Board of Review': {
      var cols = stageColumns_();
      var u = Units.find(units_(), rec.fields.unit);
      var f2 = familyMsg_(rec.fields, [s.committeeGroupEmail].concat(u ? u.contacts : []));
      var vv = { scout: scout, unit: String(rec.fields.unit || ''), pageLink: pageUrl_(), note: '', date: StageActions.nice(todayYmd_()),
        verifiedDate: StageActions.nice(cols.verified ? Intake.dateKey(rec.fields[cols.verified]) || '' : ''),
        scheduleLink: String(s.eborSignupUrl || ''), committeeEmail: String(s.committeeGroupEmail || '') };
      var vp = reviewBuiltIn_(TemplateCatalog.get(key), vv);
      return mailFromTemplate_(key, vv, { committee: true, outbox: true, by: by, recordId: rec.recordId, scout: scout,
        to: f2.to, cc: f2.cc, keepCc: f2.keepCc, subject: vp.subject, body: vp.body,
        onSent: cols.emailedEbor ? { column: cols.emailedEbor, label: StageActions.COLUMNS.emailedEbor.label } : null });
    }
    case 'Unit Board Members missing':
      slot = nextSlot_(rec.recordId, 'EBoR');
      var r2 = draftBoardMissing_(rec, slot.row, slot.start);
      if (r2 === false) throw userError_('No unit contacts for ' + rec.fields.unit + ' (Key 3 / Unit Contacts tabs).');
      return r2;
    case 'EBoR reminder':
      slot = nextSlot_(rec.recordId, 'EBoR');
      return draftEborReminder_(rec.recordId, slot.row, slot.start);
    case 'Session briefing':
      slot = nextSlot_(rec.recordId, null);
      var r3 = sendBriefing_(rec, slot.row, slot.start, slot.type);
      if (r3 === false) throw userError_('No committee members on that session yet.');
      return r3;
  }
  throw userError_('Unknown email: ' + key);
}

// ---------- bulk (Admin page): one draft per Scout in a stage ----------

function actionEmailBulkList_(req) {
  committeeMe_(req.session);
  var s = getSettings_();
  var section = String(req.section || '');
  var emails = EmailMenu.ENTRIES.filter(function (e) { return EmailMenu.fits(e, section); })
    .map(function (e) { var x = TemplateCatalog.get(e.key); return { key: e.key, label: (x ? x.id + ' ' : '') + e.key }; });
  var key = String(req.key || '');
  if (!key) return { emails: emails, scouts: [] };
  var units = units_();
  var history = outboxRows_().map(function (r) {
    var at = r['Done'] instanceof Date ? r['Done'].getTime() : r['Created'] instanceof Date ? r['Created'].getTime() : 0;
    return { recordId: String(r['Record ID'] || ''), template: String(r['Template'] || ''), status: String(r['Status'] || ''), at: at };
  });
  var scouts = Records.all(['scout_name', 'unit']).filter(function (r) { return r.section === section && String(r.scout_name || '').trim(); })
    .map(function (r) {
      var rec = Records.get(r.recordId);
      var pick = EmailMenu.choices(section, emailCtx_(rec, { units: units, history: history })).filter(function (x) { return x.key === key; })[0] || {};
      var why = pick.why || (pick.note && !pick.noteDefault ? 'No note on file for this stage (use Email… on the Scout).' : '');
      return { recordId: r.recordId, name: String(r.scout_name).trim(), unit: String(r.unit || ''), ready: !why, why: why, recent: pick.recent || '' };
    });
  return { emails: emails, scouts: scouts, stage: SettingsModel.sectionLabel(s, section) };
}

function actionEmailBulkDraft_(req) {
  var c = committeeMe_(req.session);
  var key = String(req.key || '');
  var ids = (req.recordIds || []).map(String).slice(0, 40);
  if (!ids.length) throw userError_('Tick at least one Scout.');
  var started = Date.now();
  var results = ids.map(function (id) {
    var rec = Records.get(id);
    if (!rec) return { recordId: id, name: id, ok: false, message: 'No longer on the tracking tab.' };
    if (Date.now() - started > 240000) return { recordId: id, name: rec.fields.scout_name, ok: false, message: 'Not drafted (time limit): run again for the rest.' };
    try {
      var r = draftOne_(rec, key, c.email, '', true, emailCtx_(rec));
      return { recordId: id, name: String(rec.fields.scout_name), ok: true, message: 'drafted' };
    } catch (e) { return { recordId: id, name: String(rec.fields.scout_name), ok: false, message: e.userMessage || e.message }; }
  });
  adminLog_('Bulk draft "' + key + '": ' + results.filter(function (x) { return x.ok; }).length + ' of ' + results.length + ' Scouts', c.email);
  return { results: results };
}
