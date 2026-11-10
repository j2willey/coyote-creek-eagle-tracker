/**
 * Committee pages: dashboard (/committee) and Review outcome (/committee/review). Rules in lib/proposalOutcome.js.
 *
 * Review outcome (Jim W., 2026-10-23): a member picks a Scout from In-Person Review: Booked / Proposal Revisions
 * Requested and records Approved (uploads the signed PDF), Revisions requested or Not approved. The tool renames
 * and files the signed copy (<Name>-<Unit>_ESSPP-ApprovedAndSignedBy-AB&CD.pdf), moves every ESSPP-V<n> to Archive/,
 * fills the dates, moves the row, writes the note to the Life to Eagle Log, and drafts the email in the Outbox
 * (approval: with the PDF; members send it from their own email).
 *
 * Router actions (committee members only):
 *   committeeHome    {session}                                             -> {me, counts, waiting, tabs (lib/board.js), testMode}
 *   reviewChoices    {session}                                             -> {me, members, today, scouts, outcomes}
 *   reviewStart      {session, recordId, outcome, initials, date, note, confirm}
 *                                                                          -> {needsConfirm, warnings} | {uploadToken, needsFile}
 *   uploadReviewFile {uploadToken, name, data}                             -> {stored}
 *   reviewFinish     {uploadToken}                                         -> {message, outboxId}
 *   signStart        {session, recordId, initials, more, next, sendNow, finish, note}
 *                                                                          -> {uploadToken, needsFile}  (then uploadReviewFile, reviewFinish)
 *   scoutReviewFiles {session, recordId}                                   -> {folderUrl, files: [{id, name, mime, bytes, date}]}
 *   fetchScoutFile   {session, recordId, fileId}                           -> {name, mime, data (base64)}
 *
 * Signatures in progress (Jim W., 2026-11-08): reviewStart with outcome approved + more (next: initials, sendNow)
 * files the copy signed so far, moves the row to Proposal Approved, writes the Signing column and sends the copy to the
 * next signer(s) (now, or as an Outbox draft). The Scout is not emailed until the last signature (signStart without
 * more), or until a member chooses "Finish with the signatures we have" (finish: no upload).
 */
var REVIEW_TOKEN_SECONDS = 2 * 3600;

function todayYmd_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function ymdToDate_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Machine name of the tracking tab's Approved Date column (Settings → approvedDateColumn, else found by name). */
function approvedDateColumn_() {
  var cols = Records.columns();
  var set = String(getSettings_().approvedDateColumn || '').trim();
  if (set && cols.indexOf(set) >= 0) return set;
  return cols.filter(function (c) { return /(^|\.)approved_date$/.test(c); })[0] || '';
}

/** The tracking columns the review page reads, as 'YYYY-MM-DD' strings. */
function reviewRecords_() {
  var s = getSettings_();
  var dCol = s.proposalReviewDateColumn, wCol = s.proposalReviewWhoColumn, aCol = approvedDateColumn_();
  return Records.all(['scout_name', 'unit', dCol, wCol, aCol, Pending.COLUMN, ProposalOutcome.SIGNING_COLUMN].filter(String)).map(function (r) {
    return { recordId: r.recordId, section: r.section, scout_name: r.scout_name, unit: r.unit, pending: Pending.ms(r[Pending.COLUMN]),
      signing: String(r[ProposalOutcome.SIGNING_COLUMN] || ''),
      who: String(r[wCol] || ''), reviewDate: Intake.dateKey(r[dCol]) || '', approvedDate: aCol ? (Intake.dateKey(r[aCol]) || '') : '' };
  });
}

/** Every Scout row for the dashboard tabs (one read of the tracking tab), dates as 'YYYY-MM-DD'. */
function boardRecords_() {
  var s = getSettings_();
  var aCol = approvedDateColumn_(), eCol = s.eborDateColumn || 'ebor_date';
  var sc = stageColumns_();
  var units = [];
  try { units = units_(); } catch (e) { console.warn('board units: ' + e); }
  // Unit Board Members on each Scout's upcoming EBoR slot: true / false; null when there is no slot to look at.
  // boardN: everyone on that board (district/council members on the slot + Unit Board Members).
  // The Scout's NEXT EBoR slot counts (an older or duplicate row must not hide it).
  // sessions: each Scout's next booked Pre-Review Call / Proposal Review / EBoR (Board.nextSessions), for the dashboard's
  // Session column and the Board tag, both links to the session on the schedule page (2026-11-03).
  var boardOn = {}, boardN = {}, sessions = {};
  try {
    sessions = Board.nextSessions(readSchedule_().rows, Date.now());
    var members = committee_();
    Object.keys(sessions).forEach(function (id) {
      var m = sessions[id];
      Object.keys(m).forEach(function (code) { m[code].names = Booking.resolveWho(m[code].reps, members).names; });
      if (!m.EBoR) return;
      var x = m.EBoR.row;
      boardOn[id] = !!String(x.board_members || '').trim();
      boardN[id] = Units.boardSize(x.reps, x.board_members, Booking.splitWho);
    });
  } catch (e) { console.warn('board schedule: ' + e); }
  var announce = eagleAnnounce_();
  var closeWhy = closeSuggestions_();                        // amber "Close?" tag (lib/closing.js)
  var formsite = {};                                         // red "Formsite" tag: Council Applications rows to check
  try { formsite = CouncilApp.flags(Tabs.read(CouncilApp.TAB), function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d'); }); }
  catch (e) { /* no Council Applications tab yet */ }
  return Records.all(['scout_name', 'preferred_name', 'unit', 'birth_date', aCol, eCol, 'notes', Pending.COLUMN, '_folder_id', sc.signedSent, sc.svmbcReceived, ProposalOutcome.SIGNING_COLUMN, Closing.COLUMN].filter(String)).map(function (r) {
    return { recordId: r.recordId, section: r.section, closed: Closing.parseClosed(r[Closing.COLUMN]), closeWhy: closeWhy[r.recordId] || '', scout_name: r.scout_name, preferred_name: r.preferred_name, unit: r.unit,
      birth: Intake.dateKey(r.birth_date) || '', approved: aCol ? (Intake.dateKey(r[aCol]) || '') : '', ebor: Intake.dateKey(r[eCol]) || '',
      notes: r.notes, pending: Pending.ms(r[Pending.COLUMN]), folderId: r._folder_id,
      signedSent: sc.signedSent ? (Intake.dateKey(r[sc.signedSent]) || '') : '', svmbcReceived: sc.svmbcReceived ? r[sc.svmbcReceived] : '',
      underReview: !!((Units.find(units, r.unit) || {}).underReview), unitBoard: boardOn[r.recordId] === undefined ? null : boardOn[r.recordId],
      signing: ProposalOutcome.parseSigning(r[ProposalOutcome.SIGNING_COLUMN]),
      boardSize: boardN[r.recordId] === undefined ? null : boardN[r.recordId], sessions: sessions[r.recordId] || null, formsite: formsite[r.recordId] || null,
      eagleNumber: r.section === 'ebor_booked' ? (announce[r.recordId] || '') : '' };
  });
}

function actionCommitteeHome_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var slots = [];
  try { slots = CommitteeSchedule.entries(readSchedule_().rows, s); } catch (e) { console.warn('committeeHome schedule: ' + e); }
  return {
    me: { name: String(c.me.name || ''), initials: String(c.me.initials || ''), email: c.email },
    counts: ProposalOutcome.homeCounts(reviewRecords_(), slots, pendingCount_(), Date.now(), todayYmd_()),
    waiting: pendingWaiting_().slice(0, 8).map(function (w) {
      return { title: w.title, days: w.days, stage: SettingsModel.sectionLabel(s, w.section) };
    }),
    tabs: (function () { var t = Board.build(boardRecords_(), s.sections, todayYmd_(), s.councilAckDays); return t; })(),
    actions: StageActions.bySection((s.sections || []).map(function (x) { return x.key; })),
    closing: { reasons: Closing.REASONS, stages: (s.sections || []).filter(function (x) { return x.key !== Closing.SECTION && x.label; })
      .map(function (x) { return { key: x.key, label: x.label }; }) },
    admin: adminCounts_(),
    testMode: s.testMode !== false
  };
}

function actionReviewChoices_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var today = todayYmd_();
  return {
    me: { name: String(c.me.name || ''), initials: String(c.me.initials || ''), email: c.email },
    members: c.committee.filter(function (m) { return String(m.initials || '').trim(); })
      .map(function (m) { return { name: String(m.name || ''), initials: String(m.initials).trim() }; }),
    today: today,
    scouts: ProposalOutcome.choices(reviewRecords_(), function (k) { return SettingsModel.sectionLabel(s, k); }, today),
    outcomes: Object.keys(ProposalOutcome.OUTCOMES).map(function (k) {
      var o = ProposalOutcome.OUTCOMES[k];
      return { key: k, label: o.label, file: o.file };
    }),
    approvedDateColumn: approvedDateColumn_(),
    testMode: s.testMode !== false
  };
}

/** Everything about the request that can be checked before a file is sent. */
function reviewCheck_(req, c) {
  var outcome = String(req.outcome || '');
  if (!ProposalOutcome.OUTCOMES[outcome]) throw userError_('Pick the outcome.');
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  if (ProposalOutcome.ELIGIBLE.indexOf(rec.section) < 0) {
    throw userError_(rec.fields.scout_name + ' is now in ' + SettingsModel.sectionLabel(getSettings_(), rec.section) + '. Reload the page.');
  }
  var known = c.committee.map(function (m) { return String(m.initials || '').trim(); }).filter(String);
  var ini = ProposalOutcome.normalizeInitials(req.initials, known);
  var s = getSettings_();
  var aCol = approvedDateColumn_();
  if (outcome === 'approved' && !aCol) throw userError_('The tracking tab has no Approved Date column (Settings → approvedDateColumn). Ask the admin.');
  var plan = ProposalOutcome.datePlan({ outcome: outcome, date: req.date, today: todayYmd_(),
    reviewDate: Intake.dateKey(rec.fields[s.proposalReviewDateColumn]) || '', approvedDate: aCol ? (Intake.dateKey(rec.fields[aCol]) || '') : '' });
  var next = null;
  if (outcome === 'approved' && req.more) next = ProposalOutcome.nextSigners(req.next, activeMembers_(c), ini.list);
  var errors = ini.errors.concat(plan.errors).concat(next ? next.errors : []);
  if (errors.length) throw userError_(errors.join(' '));
  var warnings = plan.warnings.slice();
  if (ini.unknown.length) warnings.push('Not on the Committee tab: ' + ini.unknown.join(', ') + '. Check the initials.');
  if (outcome !== 'approved' && !String(req.note || '').trim()) warnings.push('No note: the email to the family will not say what to change. Add a note, or edit the email in the Outbox.');
  return { rec: rec, outcome: outcome, initials: ini, plan: plan, warnings: warnings, approvedCol: aCol, next: next };
}

function activeMembers_(c) { return c.committee.filter(function (m) { return m.active !== false; }); }

function actionReviewStart_(req) {
  var c = committeeMe_(req.session);
  var ck = reviewCheck_(req, c);
  if (ck.warnings.length && !req.confirm) return { needsConfirm: true, warnings: ck.warnings };
  var token = Identity.makeToken(Utilities.getUuid);
  var batchId = Intake.makeQueueId(null, [], new Date()).replace(/^Q-/, 'A-');
  CacheService.getScriptCache().put('rv:' + token, JSON.stringify({
    recordId: ck.rec.recordId, email: c.email, by: c.me.initials || c.email, outcome: ck.outcome, initials: ck.initials.text,
    date: String(req.date), note: String(req.note || '').slice(0, 2000), batchId: batchId,
    more: !!ck.next, next: ck.next ? ck.next.list : [], sendNow: req.sendNow !== false
  }), REVIEW_TOKEN_SECONDS);
  return { uploadToken: token, needsFile: ProposalOutcome.OUTCOMES[ck.outcome].file };
}

function reviewContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Review session not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('rv:' + token);
  if (!raw) throw userError_('Review session expired. Please start again.');
  return JSON.parse(raw);
}

function actionUploadReviewFile_(req) {
  var ctx = reviewContext_(req.uploadToken);
  if (ctx.outcome !== 'approved' && !(ctx.outcome === 'sign' && !ctx.finish)) throw userError_('No file is needed for this outcome.');
  if (!ProposalOutcome.isPdfName(req.name)) throw userError_('Upload the signed Proposal as a PDF.');
  if (uploadsFor_(ctx.batchId).length) throw userError_('One signed Proposal at a time.');
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, ctx.recordId, { name: req.name, tag: 'ESSPP', data: req.data });
  return { stored: String(req.name || '') };
}

function actionReviewFinish_(req) {
  var ctx = reviewContext_(req.uploadToken);
  var c = committeeMe_(req.session);
  if (ctx.outcome === 'sign') return signFinish_(req, ctx, c);
  var s = getSettings_();
  var out = ProposalOutcome.OUTCOMES[ctx.outcome];
  // Re-check under the current sheet (someone else may have moved the row meanwhile).
  var ck = reviewCheck_({ recordId: ctx.recordId, outcome: ctx.outcome, initials: ctx.initials, date: ctx.date, note: ctx.note }, c);
  var rec = ck.rec;
  var uploads = out.file ? uploadsFor_(ctx.batchId) : [];
  if (out.file && uploads.length !== 1) throw userError_('Upload the signed Proposal (PDF) first.');
  if (ctx.more) ensureSigningColumn_();

  // 1. File the signed copy; every Proposal version (and an earlier signed copy) goes to Archive.
  var fileName = '', fileId = '';
  if (out.file) {
    var u = uploads[0];
    var folder = folderForRecord_(rec, true);
    fileName = ProposalOutcome.signedFileName(rec.fields.scout_name, rec.fields.unit, ctx.initials, Intake.namePart, Intake.unitPart);
    var f = DriveApp.getFileById(String(u['Drive file ID']));
    f.setName(fileName);
    f.moveTo(folder);
    fileId = f.getId();
    var top = listFolder_(folder);
    var toArchive = ProposalOutcome.archivePlan(top.map(function (x) { return { id: x.id, name: x.name }; }), fileId);
    if (toArchive.length) {
      var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
      top.forEach(function (x) { if (toArchive.indexOf(x.id) >= 0) x.file.moveTo(archive); });
    }
    withLock_(function () { Tabs.update(UPLOADS_TAB, u._row, { 'Record ID': rec.recordId, 'Version': 'signed', 'Stored name': fileName }); });
  }

  // 2. Tracking columns: Approved Date, the Proposal Review date (when missing or later), Who (when empty).
  var cols = Records.columns();
  var upd = {};
  if (ctx.outcome === 'approved' && ck.plan.set.approvedDate) upd[ck.approvedCol] = ymdToDate_(ck.plan.set.approvedDate);
  if (ck.plan.set.reviewDate && cols.indexOf(s.proposalReviewDateColumn) >= 0) upd[s.proposalReviewDateColumn] = ymdToDate_(ck.plan.set.reviewDate);
  if (cols.indexOf(s.proposalReviewWhoColumn) >= 0 && !String(rec.fields[s.proposalReviewWhoColumn] || '').trim()) {
    upd[s.proposalReviewWhoColumn] = ck.initials.list.join('/');
  }
  if (ctx.more) upd[ProposalOutcome.SIGNING_COLUMN] = ProposalOutcome.signingText({ waiting: ctx.next, since: todayYmd_(), signed: ck.initials.list });
  if (Object.keys(upd).length) Records.update(rec.recordId, upd);

  // 3. Move the row, log it (Notes cell + Life to Eagle Log + digest).
  if (rec.section !== out.section) Records.move(rec.recordId, out.section);
  var checked = clearPending_(rec.recordId);                  // a decision: new files no longer waiting (state-model-v3)
  if (ctx.outcome !== 'approved') saveRequest_(rec.recordId, out.section, ctx.note);   // shown on the Scout's page
  addRecordNote_(rec.recordId, ProposalOutcome.logLine(Intake.shortDate(new Date()), c.me.initials || c.email, ctx.outcome,
    ck.initials.text, fileName, ctx.note) + (ctx.more ? '; waiting on ' + ctx.next.join(', ') + ' to sign' : '') + (checked ? '; new files checked' : ''));
  CacheService.getScriptCache().remove('rv:' + req.uploadToken);

  // 3b. More signatures to come: the copy goes to the next signer(s); the Scout hears at the last signature.
  if (ctx.more) {
    var sr = sendSignRequest_(rec, { id: fileId, name: fileName }, ck.initials.list, ctx.next, ctx.sendNow, c, ctx.date, ctx.note);
    var m0 = String(rec.fields.scout_name || '') + ': proposal approved; moved to ' + SettingsModel.sectionLabel(s, out.section) + '. Filed as ' + fileName + '. ' + sr.message +
      ' The Scout\'s page says "' + ProposalOutcome.SIGNING_STATUS + '"; the approval email is drafted at the last signature.';
    return { message: m0, outboxId: sr.outboxId || '' };
  }

  // 4. The email to the family, as a draft in the Outbox.
  var pageLink = String(s.webOrigin).replace(/\/+$/, '') + '/signin';
  var scout = String(rec.fields.scout_name || '');
  var vars = { scout: scout, date: ProposalOutcome.nice(ctx.date), signedBy: ck.initials.text, file: fileName, note: ctx.note, pageLink: pageLink };
  var plain = reviewBuiltIn_(TemplateCatalog.get(out.template), vars);   // fallback wording = the catalog's starting text
  var res = mailFromTemplate_(out.template, vars, {
    committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout,
    to: familyMsg_(rec.fields, s.committeeGroupEmail).to, cc: familyMsg_(rec.fields, s.committeeGroupEmail).cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: plain.subject, body: plain.body, attachments: fileId ? [{ id: fileId, name: fileName }] : [] });

  var msg = scout + ': ' + out.past.toLowerCase() + '; moved to ' + SettingsModel.sectionLabel(s, out.section) + '.' +
    (fileName ? ' Filed as ' + fileName + '.' : '');
  try {
    var up = upcomingBooking_(readSchedule_().rows, rec.recordId);
    if (up) msg += ' NOTE: a ' + Booking.label(up.type) + ' is still booked for ' + whenText_(up.b.start) + '; cancel it on the schedule page if it won\'t happen.';
  } catch (e) {}
  if (res && res.queued) msg += ' The email is ready in the Outbox.';
  else msg += ' No email was drafted (' + ((res && res.reason) || 'template Off') + ').';
  return { message: msg, outboxId: res && res.queued ? res.id : '' };
}

/** Built-in wording from the catalog (used when the template Doc or tab is missing): placeholders filled, plain text. */
function reviewBuiltIn_(x, vars) {
  var fill = function (t) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : ''; }); };
  // Like the template Doc: a line whose placeholders are all empty is left out ("Running late? {dayOfContact}").
  var lines = x.body.filter(function (l) {
    var ph = String(l).match(/\{(\w+)\}/g);
    return !ph || ph.some(function (p) { return String(vars[p.slice(1, -1)] || '').trim(); });
  }).map(fill).filter(function (l, i, a) { return !(l === '' && a[i - 1] === ''); });
  return { subject: fill(x.subject), body: lines.join('\n') };
}

/** The Signing column (Signatures pending), added next to Approved Date the first time it is needed. */
function ensureSigningColumn_() {
  if (Records.columns().indexOf(ProposalOutcome.SIGNING_COLUMN) >= 0) return;
  var ok = false;
  try { ok = ensureTrackingColumn_(ProposalOutcome.SIGNING_COLUMN, ProposalOutcome.SIGNING_LABEL, [approvedDateColumn_(), 'approved_date', 'notes'].filter(String)); }
  catch (e) { console.warn('ensureSigningColumn_: ' + e); }
  Records.invalidate();
  if (!ok || Records.columns().indexOf(ProposalOutcome.SIGNING_COLUMN) < 0) {
    throw userError_('Could not add the "' + ProposalOutcome.SIGNING_LABEL + '" column to the tracking tab. Ask the admin to run Setup / repair tabs.');
  }
}

/**
 * Send the copy signed so far to the next signer(s): now (from the tool, Reply-To the member) or as an Outbox draft.
 * file: {id, name}; signed / next: initials. -> {message, outboxId}
 */
function sendSignRequest_(rec, file, signed, next, sendNow, c, dateYmd, note) {
  var s = getSettings_();
  var emails = ProposalOutcome.nextSigners(next, activeMembers_(c), []).emails;
  var scout = String(rec.fields.scout_name || '');
  var mail = ProposalOutcome.signerEmail({ scout: scout, unit: String(rec.fields.unit || ''), date: ProposalOutcome.nice(dateYmd),
    signed: signed.join('&'), by: String(c.me.name || c.email), note: note,
    link: String(s.webOrigin).replace(/\/+$/, '') + '/committee/review?r=' + encodeURIComponent(rec.recordId) });
  if (sendNow) {
    var p = sendMail_({ to: emails.join(','), subject: mail.subject, body: mail.body, replyTo: c.email,
      attachments: [DriveApp.getFileById(file.id).getBlob().setName(file.name)] });
    addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + (c.me.initials || c.email) + '] Signature request sent to ' + next.join(', '));
    return { message: p && p.send ? 'Sent to ' + next.join(', ') + ' to sign.' : 'The email to ' + next.join(', ') + ' was NOT sent (' + ((p && p.reason) || 'unknown') + ').' };
  }
  var id = queueOutbox_('Signature request', { to: emails.join(', '), cc: '', subject: mail.subject, body: mail.body, htmlBody: Outbox.textToHtml(mail.body) },
    { by: c.email, recordId: rec.recordId, scout: scout, attachments: [{ id: file.id, name: file.name }] });
  return { message: 'The email to ' + next.join(', ') + ' is ready in the Outbox.', outboxId: id };
}

/** A next signer: upload their signed copy (or finish with the signatures there are). See signFinish_. */
function actionSignStart_(req) {
  var c = committeeMe_(req.session);
  var ck = signCheck_(req, c);
  var token = Identity.makeToken(Utilities.getUuid);
  var batchId = Intake.makeQueueId(null, [], new Date()).replace(/^Q-/, 'A-');
  CacheService.getScriptCache().put('rv:' + token, JSON.stringify({
    recordId: ck.rec.recordId, email: c.email, by: c.me.initials || c.email, outcome: 'sign', initials: ck.initials.text,
    finish: !!req.finish, more: !!ck.next, next: ck.next ? ck.next.list : [], sendNow: req.sendNow !== false,
    note: String(req.note || '').slice(0, 2000), batchId: batchId
  }), REVIEW_TOKEN_SECONDS);
  return { uploadToken: token, needsFile: !req.finish };
}

function signCheck_(req, c) {
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var sg = rec.section === 'proposal_approved' ? ProposalOutcome.parseSigning(rec.fields[ProposalOutcome.SIGNING_COLUMN]) : null;
  if (!sg) throw userError_(rec.fields.scout_name + ' has no signatures in progress (maybe someone just finished). Reload the page.');
  var known = c.committee.map(function (m) { return String(m.initials || '').trim(); }).filter(String);
  var ini = req.finish ? { text: '', list: [], errors: [], unknown: [] } : ProposalOutcome.normalizeInitials(req.initials, known);
  var signed = ProposalOutcome.addSigners(sg.signed, ini.list);
  var next = !req.finish && req.more ? ProposalOutcome.nextSigners(req.next, activeMembers_(c), signed) : null;
  var errors = ini.errors.concat(next ? next.errors : []);
  if (errors.length) throw userError_(errors.join(' '));
  return { rec: rec, signing: sg, initials: ini, signed: signed, next: next };
}

/** The copy currently on file: the newest top-level "…ESSPP-ApprovedAndSignedBy-…" in the Scout's folder. */
function currentSignedFile_(folder) {
  var hits = listFolder_(folder).filter(function (x) { return ProposalOutcome.isSignedName(x.name); });
  hits.sort(function (a, b) { return b.file.getDateCreated() - a.file.getDateCreated(); });
  return hits[0] || null;
}

function signFinish_(req, ctx, c) {
  var s = getSettings_();
  var ck = signCheck_({ recordId: ctx.recordId, initials: ctx.initials, finish: ctx.finish, more: ctx.more, next: ctx.next }, c);
  var rec = ck.rec, scout = String(rec.fields.scout_name || '');
  var folder = folderForRecord_(rec, true);
  var fileName, fileId;
  if (!ctx.finish) {
    var uploads = uploadsFor_(ctx.batchId);
    if (uploads.length !== 1) throw userError_('Upload the signed Proposal (PDF) first.');
    var u = uploads[0];
    fileName = ProposalOutcome.signedFileName(scout, rec.fields.unit, ck.signed.join('&'), Intake.namePart, Intake.unitPart);
    var f = DriveApp.getFileById(String(u['Drive file ID']));
    f.setName(fileName);
    f.moveTo(folder);
    fileId = f.getId();
    var top = listFolder_(folder);
    var toArchive = ProposalOutcome.archivePlan(top.map(function (x) { return { id: x.id, name: x.name }; }), fileId);
    if (toArchive.length) {
      var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
      top.forEach(function (x) { if (toArchive.indexOf(x.id) >= 0) x.file.moveTo(archive); });
    }
    withLock_(function () { Tabs.update(UPLOADS_TAB, u._row, { 'Record ID': rec.recordId, 'Version': 'signed', 'Stored name': fileName }); });
  } else {
    var cur = currentSignedFile_(folder);
    if (!cur) throw userError_('No signed copy (…ESSPP-ApprovedAndSignedBy-…) in ' + scout + '\'s folder. Upload one instead.');
    fileName = cur.name; fileId = cur.id;
  }
  var who = c.me.initials || c.email;
  var signedText = ck.signed.join('&');
  var upd = {};
  upd[ProposalOutcome.SIGNING_COLUMN] = ck.next ? ProposalOutcome.signingText({ waiting: ck.next.list, since: todayYmd_(), signed: ck.signed }) : '';
  Records.update(rec.recordId, upd);
  addRecordNote_(rec.recordId, ProposalOutcome.signLogLine(Intake.shortDate(new Date()), who,
    ctx.finish ? 'Finished with the signatures there are' : 'Signature added', signedText, fileName, ck.next ? ck.next.list : []) +
    (ctx.note ? '. Note: ' + String(ctx.note).replace(/\s+/g, ' ') : ''));
  CacheService.getScriptCache().remove('rv:' + req.uploadToken);

  var aCol = approvedDateColumn_();
  var approvedYmd = aCol ? (Intake.dateKey(rec.fields[aCol]) || todayYmd_()) : todayYmd_();
  if (ck.next) {
    var sr = sendSignRequest_(rec, { id: fileId, name: fileName }, ck.signed, ck.next.list, ctx.sendNow, c, approvedYmd, ctx.note);
    return { message: scout + ': filed as ' + fileName + '. ' + sr.message, outboxId: sr.outboxId || '' };
  }

  // Last signature: the approval email to the Scout and parent, with the final copy (as at a single-signer approval).
  var out = ProposalOutcome.OUTCOMES.approved;
  var vars = { scout: scout, date: ProposalOutcome.nice(approvedYmd), signedBy: signedText, file: fileName, note: '',
    pageLink: String(s.webOrigin).replace(/\/+$/, '') + '/signin' };
  var plain = reviewBuiltIn_(TemplateCatalog.get(out.template), vars);
  var fam = familyMsg_(rec.fields, s.committeeGroupEmail);
  var res = mailFromTemplate_(out.template, vars, {
    committee: true, outbox: true, by: c.email, recordId: rec.recordId, scout: scout,
    to: fam.to, cc: fam.cc, keepCc: familyMsg_(rec.fields).keepCc,
    subject: plain.subject, body: plain.body, attachments: [{ id: fileId, name: fileName }] });
  var msg = scout + ': signatures complete (' + signedText + '). ' + (ctx.finish ? 'Using ' : 'Filed as ') + fileName + '.';
  if (res && res.queued) msg += ' The approval email is ready in the Outbox.';
  else msg += ' No email was drafted (' + ((res && res.reason) || 'template Off') + ').';
  return { message: msg, outboxId: res && res.queued ? res.id : '' };
}

/** What the Scout sees for their stage ("Proposal approved; committee signatures in progress" while signatures are out). */
function scoutStatusOf_(settings, rec) {
  return ProposalOutcome.scoutStatus(SettingsModel.scoutStatusFor(settings, rec.section), rec.section, rec.fields[ProposalOutcome.SIGNING_COLUMN]);
}

/**
 * Top-level files in a Scout's folder for the Review page (committee members only).
 * Leaves out Google Docs/Sheets (such as the Life to Eagle Log).
 */
function actionScoutReviewFiles_(req) {
  committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var folder = folderForRecord_(rec, false);
  if (!folder) return { folderUrl: '', files: [] };
  var tz = Session.getScriptTimeZone();
  var files = listFolder_(folder)
    .filter(function (x) { return String(x.file.getMimeType() || '').indexOf('application/vnd.google-apps') !== 0; })
    .map(function (x) {
      return {
        id: String(x.id),
        name: String(x.name || ''),
        mime: String(x.file.getMimeType() || ''),
        bytes: Number(x.file.getSize()) || 0,
        date: Utilities.formatDate(x.file.getLastUpdated(), tz, 'M/d/yyyy')
      };
    });
  return { folderUrl: 'https://drive.google.com/drive/folders/' + folder.getId(), files: files };
}

/**
 * Download one file from a Scout's folder (committee members only).
 * Folder-membership check: refuses any fileId that is not currently at the top level of that Scout's folder.
 */
function actionFetchScoutFile_(req) {
  committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var fileId = String(req.fileId || '').trim();
  if (!fileId) throw userError_('Pick a file from the Scout\'s folder.');
  var folder = folderForRecord_(rec, false);
  if (!folder) throw userError_('No folder found for ' + rec.fields.scout_name + '.');
  var hit = listFolder_(folder).filter(function (x) { return String(x.id) === fileId; })[0];
  if (!hit) throw userError_('That file is not in ' + rec.fields.scout_name + '\'s folder (it may have been moved to Archive). Reload the page.');
  var maxMB = Number(getSettings_().maxUploadMB) || 20;
  var size = Number(hit.file.getSize()) || 0;
  if (size > maxMB * 1024 * 1024) {
    throw userError_(hit.name + ' is ' + Math.round(size / 104857.6) / 10 + ' MB (over the ' + maxMB + ' MB limit). Open the Scout\'s folder in Drive to download it directly.');
  }
  var blob = hit.file.getBlob();
  return {
    name: String(hit.name || ''),
    mime: blob.getContentType() || String(hit.file.getMimeType() || 'application/octet-stream'),
    data: Utilities.base64Encode(blob.getBytes())
  };
}
