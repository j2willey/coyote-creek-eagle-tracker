/**
 * Committee Admin page (/committee/admin; every committee member for now). Rules in lib/adminRules.js.
 *
 * Router actions (committee members):
 *   adminData    {session}                              -> {intake, archive, unitRequests}
 *   adminIntake  {session, queueId, act, recordId?}     -> {message}   act: attach | promote | resend | spam | emailUpload | dismiss
 *   adminArchive {session, year, confirm}               -> {needsConfirm, names, ...} | {message, url}   (eagleArchiveActions.js)
 *   adminClosedArchive {session, confirm}               -> {needsConfirm, rows, folder} | {message}   (closingActions.js)
 *   adminRequestDone {session, id}                       -> {message}   unit host-a-board request handled
 */
function adminRecords_() {
  var eCol = getSettings_().eborDateColumn || 'ebor_date';
  return Records.all(['scout_name', 'unit', 'birth_date', 'scout_email', 'bsa_id', eCol]).map(function (r) {
    r.ebor = Intake.dateKey(r[eCol]) || ''; return r;
  });
}

function actionAdminData_(req) {
  committeeMe_(req.session);
  var s = getSettings_();
  var recs = adminRecords_();
  var byId = {};
  recs.forEach(function (r) { byId[r.recordId] = r; });
  var queue = [];
  try { markReplacedUploads_(); } catch (e) { console.warn('markReplacedUploads_: ' + e); }
  try { queue = Tabs.read(QUEUE_TAB); } catch (e) {}
  var intake = AdminRules.intakeExceptions(queue, Date.now()).map(function (x) {
    if (x.actions.indexOf('attach') >= 0) {
      var q = queue.filter(function (r) { return String(r['Queue ID']) === x.queueId; })[0];
      var dup = Intake.duplicateCheck(queueToClean_(q), recs, []);
      x.matches = dup.exact.concat(dup.close).filter(function (id, i, a) { return byId[id] && a.indexOf(id) === i; }).map(function (id) {
        var r = byId[id];
        return { recordId: id, label: r.scout_name + ' (' + r.unit + ') · ' + SettingsModel.sectionLabel(s, r.section) };
      });
    }
    return x;
  });
  var review = AdminRules.toReview(queue, Date.now()).filter(function (x) { return byId[x.recordId]; }).map(function (x) {
    var r = byId[x.recordId];
    x.label = r.scout_name + ' (' + r.unit + ')';
    return x;
  });
  return { intake: intake, review: review, archive: AdminRules.archiveYears(recs), thisYear: new Date().getFullYear(),
    closedArchive: closedArchiveReport_(),
    unitRequests: openUnitRequests_(),
    scouts: recs.filter(function (r) { return String(r.scout_name || '').trim() && r.section !== 'eagle_earned'; })
      .map(function (r) { return { recordId: r.recordId, label: r.scout_name + ' (' + r.unit + ') · ' + SettingsModel.sectionLabel(s, r.section) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label); }),
    sections: (s.sections || []).filter(function (x) { return EmailMenu.ENTRIES.some(function (e) { return EmailMenu.fits(e, x.key); }); })
      .map(function (x) { return { key: x.key, label: x.label || x.key }; }),
    testMode: s.testMode !== false };
}

/** Dashboard strip: items on the Admin page that need a person (held web submissions, open unit requests). */
function adminCounts_() {
  var out = { intake: 0, held: 0, unitRequests: 0 };
  try {
    var ex = AdminRules.intakeExceptions(Tabs.read(QUEUE_TAB), Date.now()).filter(function (x) { return x.why.indexOf('Waiting for the family') !== 0; });
    out.held = ex.filter(function (x) { return x.status === 'Possible duplicate'; }).length;   // own dashboard item (Jim W. 2026-10-28)
    out.intake = ex.length - out.held;
  } catch (e) {}
  try { out.unitRequests = openUnitRequests_().length; } catch (e) {}
  return out;
}

function adminLog_(entry, by) {
  try { Tabs.append(ACTIVITY_TAB, { 'When': new Date(), 'Scout': 'Admin', 'Unit': '', 'Record ID': '', 'Entry': entry, 'By': by || '' }); }
  catch (e) { console.warn('adminLog_: ' + e); }
}

function actionAdminIntake_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var q = findQueue_(String(req.queueId || ''));
  if (!q) throw userError_('That submission is no longer in the Intake Queue. Reload the page.');
  var ex = AdminRules.intakeExceptions([q], Date.now())[0];
  var act = String(req.act || '');
  if (!ex || ex.actions.indexOf(act) < 0) throw userError_('That can\'t be done to this submission any more (' + q['Status'] + '). Reload the page.');
  var name = String(q['Eagle Candidate'] || q['Queue ID']);
  var msg;
  try {
    if (act === 'promote') {
      var id = promoteQueueChecked_(q);
      msg = name + ' added to the tracking tab (Proposal Received) as ' + id + '; the receipt was emailed.';
    } else if (act === 'attach') {
      var rec = Records.get(String(req.recordId || ''));
      if (!rec) throw userError_('Pick the Scout to attach the files to.');
      var accept = Array.isArray(req.accept) ? req.accept : null;       // compared field by field first (2026-11-04)
      attachQueueToRecord_(q, queueToClean_(q), rec.recordId, { reviewed: !!accept });
      msg = 'Files added to ' + rec.fields.scout_name + '\'s record; the family was emailed.';
      if (accept) msg += ' ' + applyIntakeFields_(req, c, findQueue_(q['Queue ID']), rec.recordId, accept);
    } else if (act === 'resend') {
      sendIntakeConfirmation_(q, { 'Note': 'Confirmation re-sent by ' + who + ' ' + Intake.shortDate(new Date()) });
      msg = 'New confirmation link sent to ' + ex.emails.join(', ') + '.';
    } else if (act === 'spam') {
      markQueueSpam_(q);
      msg = q['Queue ID'] + ' removed (files to trash).';
    } else if (act === 'emailUpload') {
      if (!String(q['Scout Email'] || '').trim()) throw userError_('This submission has no Scout email.');
      draftUploadFollowUp_(q, who);
      msg = 'Email to ' + name + ' drafted in the Outbox (review and send it there). This card stays until the Scout sends the Proposal again or you dismiss it.';
    } else if (act === 'dismiss') {
      markQueueSpam_(q, 'Dismissed ' + Intake.shortDate(new Date()) + ' (' + who + ')');
      msg = q['Queue ID'] + ' dismissed (any partial files to the trash).';
    }
  } catch (e) { throw e.userMessage ? e : userError_(e.message); }
  adminLog_('Intake ' + q['Queue ID'] + ' (' + name + '): ' + act + (req.recordId ? ' → ' + req.recordId : ''), c.email);
  return { message: msg };
}

/** Admin: the tracking row next to a web submission, field by field. req: {session, queueId, recordId?} */
function actionAdminIntakeCompare_(req) {
  committeeMe_(req.session);
  var q = findQueue_(String(req.queueId || ''));
  if (!q) throw userError_('That submission is no longer in the Intake Queue. Reload the page.');
  var rec = Records.get(String(req.recordId || q['Record ID'] || ''));
  if (!rec) throw userError_('Pick the Scout first.');
  var editable = {};
  detailFields_(rec).forEach(function (t) { t.fields.forEach(function (f) { if (f.editable) editable[f.name] = true; }); });
  var rows = AdminRules.compareRows(rec.fields, queueToClean_(q), Intake.FIELDS, function (v) { return ScoutFiles.show(v, Intake.dateKey); })
    .map(function (r) { r.editable = !!editable[r.key]; return r; });
  return { recordId: rec.recordId, scout: String(rec.fields.scout_name || '') + ' (' + String(rec.fields.unit || '') + ')', rows: rows };
}

/** Admin: take the checked fields of an already-attached submission. req: {session, queueId, accept: [keys]} */
function actionAdminIntakeApply_(req) {
  var c = committeeMe_(req.session);
  var q = findQueue_(String(req.queueId || ''));
  if (!q || String(q['Status']) !== Intake.STATUS.ATTACHED || !String(q['Record ID'] || '')) throw userError_('That submission is not attached to a Scout. Reload the page.');
  var msg = applyIntakeFields_(req, c, q, String(q['Record ID']), Array.isArray(req.accept) ? req.accept : []);
  adminLog_('Intake ' + q['Queue ID'] + ' compared: ' + msg, c.email);
  return { message: msg };
}

/**
 * Write the accepted form values onto the record through the Scout detail Save (validation, folder rename on a
 * name/unit change, log line), then mark the queue row Reviewed. -> message
 */
function applyIntakeFields_(req, c, q, recordId, accept) {
  var cand = queueToClean_(q);
  var edits = {};
  (accept || []).forEach(function (k) {
    if (Intake.FIELDS.some(function (f) { return f.key === k; }) && String(cand[k] || '').trim()) edits[k] = cand[k];
  });
  var msg = Object.keys(edits).length ? actionScoutSave_({ session: req.session, recordId: recordId, edits: edits }).message
    : 'Kept the sheet as it was.';
  var labels = Intake.FIELDS.filter(function (f) { return edits[f.key] !== undefined; }).map(function (f) { return f.label; });
  withLock_(function () {
    var row = findQueue_(q['Queue ID']);
    if (row) Tabs.update(QUEUE_TAB, row._row, { 'Note': String(row['Note'] || '') + ' Reviewed ' + Intake.shortDate(new Date()) + ' by ' +
      (c.me.initials || c.email) + ': ' + (labels.length ? 'took ' + labels.join(', ') + ' from the form' : 'kept the sheet') + '.' });
  });
  return msg;
}
