/**
 * Committee Admin page (/committee/admin; every committee member for now). Rules in lib/adminRules.js.
 *
 * Router actions (committee members):
 *   adminData    {session}                              -> {intake, archive, unitRequests}
 *   adminIntake  {session, queueId, act, recordId?}     -> {message}   act: attach | promote | resend | spam | emailUpload | dismiss
 *   adminArchive {session, year, confirm}               -> {needsConfirm, names, ...} | {message, url}   (eagleArchiveActions.js)
 *   adminClosedArchive {session, confirm}               -> {needsConfirm, rows, folder} | {message}   (closingActions.js)
 *   adminRequestDone {session, id}                       -> {message}   unit host-a-board request handled
 *   adminSettings {session}                              -> {groups, sections}   Admin role only (lib/settingsView.js)
 *   adminSettingsSave {session, group, values, was}      -> {message, view}   Admin role; editable groups only; logged on Activity
 *   adminPeople  {session}                              -> {members, me}   Admin role (lib/people.js)
 *   adminPeopleSave {session, row?, wasEmail?, member}  -> {message, members}   Admin role; add (no row) or update; logged on Activity
 *   adminSystem  {session, op, confirm?}                -> {title, text, needsConfirm?}   Admin role; op: selfCheck | setup | templates | digest |
 *                                                         scheduleCheck | purge (confirm) | councilFetch | triggers
 */
function adminRecords_() {
  var eCol = getSettings_().eborDateColumn || 'ebor_date';
  return Records.all(['scout_name', 'unit', 'birth_date', 'scout_email', 'bsa_id', eCol]).map(function (r) {
    r.ebor = Intake.dateKey(r[eCol]) || ''; return r;
  });
}

function actionAdminData_(req) {
  var me = committeeMe_(req.session);
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
    testMode: s.testMode !== false, isAdmin: Access.isAdmin(me.me, me.email, s), support: !!me.support };
}

/** Admin → Settings (Admin role): every setting, grouped, with help and defaults. Read-only (step 2 of the plan). */
function actionAdminSettings_(req) {
  adminMe_(req.session);
  return SettingsView.view(readSettingsTab_(false), SettingsModel.DEFAULT_VALUES);
}

/**
 * Admin → System (Admin role; plan step 4): the sheet menu's maintenance items, run from the page. The web app runs
 * as the deploying (Council) account, like the menu; the same account check applies. Each run (but Self-check) is
 * logged on Activity.
 */
function actionAdminSystem_(req) {
  var c = adminMe_(req.session);
  var op = String(req.op || '');
  var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var acct = SheetKind.accountProblem(SpreadsheetApp.getActive().getName(), who, getSettings_().councilDomain);
  if (acct && op !== 'selfCheck') throw userError_(acct);
  var title, text;
  if (op === 'selfCheck') { title = 'Self-check'; text = selfCheckLines_().join('\n\n'); }
  else if (op === 'setup') { title = 'Setup / repair tabs'; text = setupRunText_(); }
  else if (op === 'templates') {
    title = 'Templates: create Doc / add missing tabs';
    var t = ensureTemplateDoc_();
    text = (t.created ? 'Created the template Doc' : 'Template Doc checked') + ': ' + t.added + ' tab(s) added, ' + t.filled +
      ' empty tab(s) filled with the current wording.\n\n' + t.url;
  } else if (op === 'digest') {
    title = 'Digest: send now';
    try { text = 'Digest: ' + runDigest_({ scheduled: false }).detail + '\n\nSee the Digest Log tab.'; }
    catch (e) { throw userError_('Digest failed: ' + e.message + ' (logged on the Digest Log tab)'); }
  } else if (op === 'scheduleCheck') {
    title = 'Schedule: check against the tracking sheet';
    var r = scheduleCheck_();
    text = r.rows.length + ' booked session(s).\n' +
      '• Scout not found / unclear: ' + r.count.notFound + '\n• Linked (Record ID written): ' + r.count.linked + '\n' +
      '• Tracking date filled in: ' + r.count.filled + '\n• Tracking date DIFFERENT: ' + r.count.differs + '\n• Already the same: ' + r.count.same +
      '\n\nDetails on the "Schedule Check" tab.';
  } else if (op === 'purge') {
    title = 'Intake Queue: purge old unconfirmed';
    var plan = purgeIntakePlan_();
    if (!plan.ids.length) return { title: title, text: 'Nothing unconfirmed (or unfinished, not emailed about) older than ' + plan.days + ' days.' };
    if (!req.confirm) return { title: title, needsConfirm: true, text: plan.ids.length + ' submission(s) older than ' + plan.days +
      ' days would be deleted (rows and files): ' + plan.ids.join(', ') + '. Unfinished uploads you emailed about are kept.' };
    purgeIntakeRun_(plan.ids);
    text = 'Purged ' + plan.ids.length + ': ' + plan.ids.join(', ') + '.';
  } else if (op === 'councilFetch') {
    title = 'Council applications: fetch linked files';
    if (!digestTriggerInstalled_()) throw userError_('The hourly trigger is not installed for this account: the Formsite emails are in the inbox of the account that owns it.');
    var f = councilFetchLinks_();
    text = f.rows + ' row(s) with files not filed. ' + f.filed + ' file(s) fetched from Formsite links.' +
      (f.problems.length ? '\n\nStill not filed:\n' + f.problems.slice(0, 15).join('\n') : '');
  } else if (op === 'triggers') {
    title = 'Install sheet triggers';
    installTriggers_();
    text = INSTALL_TRIGGERS_TEXT_;
  } else throw userError_('Unknown System action.');
  if (op !== 'selfCheck') adminLog_('System: ' + title, c.email);
  return { title: title, text: text };
}

/** Admin → People: the Committee tab's members (Admin role). */
function actionAdminPeople_(req) {
  var c = adminMe_(req.session);
  return { members: People.list(Tabs.read('Committee')), me: c.email, support: !!c.support };
}

/**
 * Admin → People: add a member (no row) or update one (row + the email the page showed). Initials are fixed once a
 * member exists; nobody is deleted (untick Active). Only Name / Initials / Email / Active / Role are written.
 */
function actionAdminPeopleSave_(req) {
  var c = adminMe_(req.session);
  var row = Number(req.row) || 0;
  var line = withLock_(function () {
    var members = People.list(Tabs.read('Committee'));
    var r = People.validate(req.member || {}, members, { row: row, wasEmail: req.wasEmail, meEmail: c.email, meRole: c.me.role });
    if (r.errors.length) throw userError_(r.errors.join(' '));
    var cur = row ? members.filter(function (x) { return x.row === row; })[0] : null;
    if (cur) Tabs.update('Committee', row, r.fields);
    else {
      var at = Tabs.append('Committee', r.fields);
      try {   // the Active column holds checkboxes: give the new row one
        var sh = Tabs.sheet('Committee');
        var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
        var col = head.indexOf('Active') + 1;
        if (col > 0) sh.getRange(at, col).insertCheckboxes().setValue(r.fields['Active']);
      } catch (e) { console.warn('Committee checkbox: ' + e); }
    }
    return People.logLine(cur, r.fields);
  });
  uncache_('c:committee');
  if (line) adminLog_(line, c.email);
  return { message: line ? line.replace(/^Committee: /, 'Saved: ') : 'Nothing changed.', members: People.list(Tabs.read('Committee')), support: !!c.support };
}

/**
 * Admin → Settings: save one group's edits (Admin role; District details and Scheduling for now). Checked against
 * what the page showed (`was`), validated, written to the Settings tab, each change logged on Activity.
 */
function actionAdminSettingsSave_(req) {
  var c = adminMe_(req.session);
  var group = String(req.group || '');
  var done = withLock_(function () {
    var cur = readSettingsTab_(false);
    var r = SettingsView.validate(group, req.values || {}, req.was || {}, cur, SettingsModel.DEFAULT_VALUES);
    if (r.errors.length) throw userError_(r.errors.map(function (e) { return e.message; }).join(' '));
    r.changes.forEach(function (x) {
      // Text goes in as text (a leading ' keeps "7:00 PM" or a ZIP from turning into a time or a number).
      setSetting_(x.key, typeof x.to === 'string' && x.to ? "'" + x.to : x.to);
    });
    return r.changes;
  });
  clearSettingsCache_();
  done.forEach(function (x) { adminLog_('Settings: ' + x.key + ': "' + x.from + '" → "' + x.to + '"', c.email); });
  return { message: done.length ? 'Saved ' + done.length + ' change' + (done.length > 1 ? 's' : '') + ': ' + done.map(function (x) { return x.key; }).join(', ') + '.'
    : 'Nothing changed.', view: SettingsView.view(readSettingsTab_(false), SettingsModel.DEFAULT_VALUES) };
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
