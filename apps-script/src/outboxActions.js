/**
 * Outbox (email-review-design.md, step 2). Rules in lib/outbox.js.
 *
 * mailFromTemplate_ puts an email here instead of sending it when a COMMITTEE MEMBER caused it and its
 * template tab says "Mode: Review". Members review it on the committee page (/committee → Outbox):
 *   Send (from cc-advancement, Reply-To the group, test mode applies) · Send from my email (Gmail / copy,
 *   then "I sent it") · Discard. Every outcome goes into the Scout's Life to Eagle Log and the digest.
 *
 * Router actions (committee members only):
 *   outboxList     {session}                               -> {items:[...]}  pending + the last 60 done (page tabs: Outbox / Sent / Discarded)
 *   outboxSend     {session, id, to, cc, subject, html}    -> {message}
 *   outboxSentByMe {session, id, to, cc, subject}          -> {message}
 *   outboxDiscard  {session, id}                           -> {message}
 *   outboxAttachment {session, id, index}                  -> {name, mime, data (base64)}
 *   outboxSchedule  {session, id, to, cc, subject, html, at} -> {message}   Send later (hourly trigger sends it)
 *   outboxUnschedule {session, id}                         -> {message}   back to the Outbox
 *   outboxRestore   {session, id}                          -> {message}   a Discarded email back to the Outbox (same row)
 *   outboxCopy      {session, id}                          -> {message, id}  a sent (or discarded) email as a new draft
 *   outboxAttach    {session, id, name, data (base64)}     -> {attachments, message}  add a file to a waiting email
 *   outboxDetach    {session, id, index}                   -> {attachments, message}  take one off (the Drive file stays)
 * Emails with attachments (signed Proposal, EBoR scans, photos) are sent with the files; Reply-To = the sending member.
 */
var OUTBOX_TAB = 'Outbox';

/** Queue a rendered email. msg: {to, cc, recordId, scout, by}. Returns the Outbox Id. */
function queueOutbox_(key, out, msg) {
  var id = Outbox.makeId(Date.now());
  var att = (msg.attachments || []).map(function (a) { return { id: String(a.id), name: String(a.name || '') }; });
  if (att.length) ensureOutboxColumn_('Attachments');
  if (msg.onSent && msg.onSent.column) ensureOutboxColumn_('On sent');
  if (msg.eventAt) ensureOutboxColumn_('Event at');
  var list = function (v) { return (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map(function (x) { return String(x).trim(); }).filter(Boolean).join(', '); };
  withLock_(function () {
    var fields = { 'Id': id, 'Created': new Date(), 'Created by': msg.by || '', 'Record ID': msg.recordId || '',
      'Scout': msg.scout || '', 'Template': key, 'Status': Outbox.STATUS.PENDING, 'To': list(out.to), 'Cc': list(out.cc),
      'Subject': out.subject, 'Html': out.htmlBody, 'Text': out.body };
    if (att.length) fields['Attachments'] = JSON.stringify(att);
    if (msg.onSent && msg.onSent.column) fields['On sent'] = JSON.stringify(msg.onSent);
    if (msg.eventAt) fields['Event at'] = new Date(msg.eventAt);   // the session it is about (Send later: 2 days / 1 day before)   // {column, label}: date filled when sent
    Tabs.append(OUTBOX_TAB, fields);
  });
  if (msg.recordId) {
    try { addRecordNote_(msg.recordId, Outbox.logLine(Intake.shortDate(new Date()), memberTag_(msg.by), key, 'waiting in the Outbox')); } catch (e) {}
  }
  return id;
}

/** The email went out: fill the tracking column it stands for (e.g. Emailed to set up EBoR) with today's date. */
function applyOnSent_(row) {
  try {
    var o = JSON.parse(String(row['On sent'] || '') || 'null');
    var id = String(row['Record ID'] || '');
    if (!o || !o.column || !id || Records.columns().indexOf(o.column) < 0) return;
    var set = {};
    set[o.column] = new Date();
    Records.update(id, set);
  } catch (e) { console.warn('applyOnSent_: ' + e); }
}

/** A column added after the Outbox tab was made (Setup / repair tabs does the same). */
function ensureOutboxColumn_(name) {
  var sh = Tabs.sheet(OUTBOX_TAB);
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  if (have.indexOf(name) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(name).setFontWeight('bold');
}

/** Initials for a member email (or the text itself). */
function memberTag_(by) {
  var m = Access.memberFor(committeeAll_(), by);
  if (m && m.initials) return String(m.initials);
  return String(by || '').split('@')[0];                      // not a member (e.g. the Council account): short form
}

function outboxRows_() { try { return Tabs.read(OUTBOX_TAB); } catch (e) { return []; } }

function outboxItem_(r, withBody) {
  var o = { id: String(r['Id']), created: r['Created'] instanceof Date ? r['Created'].getTime() : new Date(r['Created']).getTime(),
    createdBy: memberTag_(r['Created by']), recordId: String(r['Record ID'] || ''), scout: String(r['Scout'] || ''),
    template: String(r['Template'] || ''), status: String(r['Status'] || ''), to: String(r['To'] || ''), cc: String(r['Cc'] || ''),
    subject: String(r['Subject'] || ''), done: r['Done'] ? new Date(r['Done']).getTime() : 0, doneBy: String(r['Done by'] || ''),
    attachments: Outbox.parseAttachments(r['Attachments']).map(function (a) { return a.name; }),
    eventAt: r['Event at'] instanceof Date ? r['Event at'].getTime() : Number(r['Event at']) || 0,
    sendAt: r['Send at'] instanceof Date ? r['Send at'].getTime() : 0, scheduledBy: r['Scheduled by'] ? memberTag_(r['Scheduled by']) : '',
    note: String(r['Note'] || ''), replyTo: String(r['Reply to'] || '') };
  o.choices = o.status === Outbox.STATUS.PENDING ? Outbox.scheduleChoices(o.eventAt, Date.now()) : [];
  if (withBody) { o.html = String(r['Html'] || ''); o.attachSizes = attachSizes_(r); }
  return o;
}

/** Bytes of each attached Drive file (0 if it is gone): the Outbox shows sizes and warns before Google Groups' 8 MB. */
function attachSizes_(row) {
  return Outbox.parseAttachments(row['Attachments']).map(function (a) {
    try { return DriveApp.getFileById(a.id).getSize(); } catch (e) { return 0; }
  });
}

function pendingCount_() {
  return outboxRows_().filter(function (r) { return String(r['Status']) === Outbox.STATUS.PENDING; }).length;
}

function actionOutboxList_(req) {
  var c = committeeMe_(req.session);
  var rows = outboxRows_();
  var open = function (r) { var st = String(r['Status']); return st === Outbox.STATUS.PENDING || st === Outbox.STATUS.SCHEDULED; };
  var pending = rows.filter(open).map(function (r) { return outboxItem_(r, true); });
  var done = rows.filter(function (r) { return !open(r) && r['Id']; }).slice(-60).reverse()
    .map(function (r) { return outboxItem_(r, false); });
  var s = getSettings_();
  return { items: pending.concat(done), me: c.email, testMode: s.testMode !== false, groups: [String(s.committeeGroupEmail || '')].filter(String) };
}

/** Find a pending row (under the lock) and apply fn(row) -> fields to write. */
function outboxFinish_(id, fn) {
  return withLock_(function () {
    var row = outboxRows_().filter(function (r) { return String(r['Id']) === String(id || ''); })[0];
    if (!row) throw userError_('That email is no longer in the Outbox. Reload the page.');
    if (String(row['Status']) !== Outbox.STATUS.PENDING) throw userError_('Someone already handled this email (' + row['Status'] + ' by ' + row['Done by'] + ').');
    var upd = fn(row);
    Tabs.update(OUTBOX_TAB, row._row, upd);
    return row;
  });
}

function outboxLog_(row, who, outcome) {
  var id = String(row['Record ID'] || '');
  if (!id) return;
  try { addRecordNote_(id, Outbox.logLine(Intake.shortDate(new Date()), who, String(row['Template']), outcome)); } catch (e) {}
}

function checkedAddresses_(to, cc) {
  var t = Outbox.addresses(to), c = Outbox.addresses(cc);
  var bad = t.bad.concat(c.bad);
  if (bad.length) throw userError_('Not an email address: ' + bad.join(', '));
  if (!t.list.length) throw userError_('Add at least one address in To.');
  return { to: t.list, cc: c.list };
}

/** Drive files of an Outbox row as mail attachments (size-checked). */
function outboxBlobs_(row) {
  var att = row ? Outbox.parseAttachments(row['Attachments']) : [];
  var blobs = [], total = 0;
  att.forEach(function (a) {
    var b;
    try { b = DriveApp.getFileById(a.id).getBlob(); } catch (e) { throw userError_('An attached file is no longer in Drive: ' + (a.name || a.id) + '.'); }
    if (a.name) b.setName(a.name);
    total += b.getBytes().length;
    blobs.push(b);
  });
  if (total > Outbox.MAX_ATTACH_BYTES) throw userError_('The attachments are ' + Math.round(total / 1048576) + ' MB; an email can carry about 18 MB of files. Remove some photos (Download, send from your own email) or send in two emails.');
  return blobs;
}

/**
 * Send one Outbox row (already claimed: status Sent written under the lock). On failure the row goes back to
 * `backTo` with the reason in Note. replyTo: the member who sent/scheduled it, when there are attachments
 * (Jim W., 2026-10-23: Council's "please rescan" reaches them).
 */
function outboxDeliver_(row, mail, replyMember, backTo) {
  var p;
  try {
    var blobs = outboxBlobs_(row);
    var s = getSettings_();
    var mode = Outbox.replyMode(mail.replyMode || row['Reply to'], blobs.length > 0);
    var rt = Outbox.replyTo(mode, replyMember, s.replyTo || s.committeeGroupEmail);
    p = sendMail_({ to: mail.to, cc: mail.cc, subject: mail.subject, body: Outbox.htmlToText(mail.html), htmlBody: mail.html,
      attachments: blobs, replyTo: rt });
    if (!p.send) throw new Error(p.reason);
  } catch (e) {
    withLock_(function () { Tabs.update(OUTBOX_TAB, row._row, { 'Status': backTo, 'Done': '', 'Done by': '', 'Note': 'Send failed: ' + (e.userMessage || e.message) }); });
    throw userError_('Not sent: ' + (e.userMessage || e.message));
  }
  applyOnSent_(row);
  return p;
}

function actionOutboxSend_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var a = checkedAddresses_(req.to, req.cc);
  var html = Outbox.clean(req.html);
  var subject = String(req.subject || '').trim();
  if (!subject) throw userError_('The subject is empty.');
  var pre = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id || ''); })[0];
  outboxBlobs_(pre);                                          // refuse missing / too large files before claiming the row
  var mode = Outbox.replyMode(req.replyTo, Outbox.parseAttachments(pre && pre['Attachments']).length > 0);
  ensureOutboxColumn_('Reply to');
  var row = outboxFinish_(req.id, function () {
    return { 'Status': Outbox.STATUS.SENT, 'Done': new Date(), 'Done by': who, 'To': a.to.join(', '), 'Cc': a.cc.join(', '),
      'Subject': subject, 'Html': html, 'Text': Outbox.htmlToText(html), 'Reply to': mode };
  });
  var p = outboxDeliver_(row, { to: a.to, cc: a.cc, subject: subject, html: html, replyMode: mode }, c.email, Outbox.STATUS.PENDING);
  outboxLog_(row, who, 'sent');
  return { message: 'Sent' + (p.intended ? ' (test mode: to ' + p.to.join(', ') + ' only)' : '') + '.' };
}

/** Outbox → Send later: saves the edits and the time; the hourly trigger sends it (outboxSendDue_). */
function actionOutboxSchedule_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var a = checkedAddresses_(req.to, req.cc);
  var html = Outbox.clean(req.html);
  var subject = String(req.subject || '').trim();
  if (!subject) throw userError_('The subject is empty.');
  var at = Number(req.at);
  ensureOutboxColumn_('Send at'); ensureOutboxColumn_('Scheduled by'); ensureOutboxColumn_('Event at'); ensureOutboxColumn_('Reply to');
  outboxFinish_(req.id, function (r) {
    var ev = r['Event at'] instanceof Date ? r['Event at'].getTime() : Number(r['Event at']) || 0;
    var prob = Outbox.scheduleProblem(at, Date.now(), ev);
    if (prob) throw userError_(prob);
    return { 'Status': Outbox.STATUS.SCHEDULED, 'Send at': new Date(at), 'Scheduled by': c.email, 'To': a.to.join(', '),
      'Cc': a.cc.join(', '), 'Subject': subject, 'Html': html, 'Text': Outbox.htmlToText(html), 'Note': '',
      'Reply to': Outbox.replyMode(req.replyTo, Outbox.parseAttachments(r['Attachments']).length > 0) };
  });
  var row = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id); })[0];
  if (row) outboxLog_(row, who, 'scheduled for ' + whenText_(at));
  return { message: 'Scheduled for ' + whenText_(at) + ' (sent within the hour after that).' };
}

/** Back to the Outbox (to edit, send now or discard). */
function actionOutboxUnschedule_(req) {
  var c = committeeMe_(req.session);
  var row = withLock_(function () {
    var r = outboxRows_().filter(function (x) { return String(x['Id']) === String(req.id || ''); })[0];
    if (!r) throw userError_('That email is no longer in the Outbox. Reload the page.');
    if (String(r['Status']) !== Outbox.STATUS.SCHEDULED) throw userError_('That email is not scheduled (' + r['Status'] + ').');
    Tabs.update(OUTBOX_TAB, r._row, { 'Status': Outbox.STATUS.PENDING, 'Send at': '', 'Scheduled by': '' });
    return r;
  });
  outboxLog_(row, c.me.initials || c.email, 'unscheduled (back in the Outbox)');
  return { message: 'Back in the Outbox.' };
}

/** Hourly: send scheduled emails whose time has come. */
function outboxSendDue_() {
  var due = Outbox.due(outboxRows_(), Date.now());
  due.forEach(function (r0) {
    var row;
    try {
      row = withLock_(function () {
        var r = outboxRows_().filter(function (x) { return String(x['Id']) === String(r0['Id']); })[0];
        if (!r || String(r['Status']) !== Outbox.STATUS.SCHEDULED) return null;          // someone changed it meanwhile
        var by = memberTag_(r['Scheduled by']);
        Tabs.update(OUTBOX_TAB, r._row, { 'Status': Outbox.STATUS.SENT, 'Done': new Date(), 'Done by': by + ' (scheduled)' });
        return r;
      });
      if (!row) return;
      var t = Outbox.addresses(row['To']), cc = Outbox.addresses(row['Cc']);
      outboxDeliver_(row, { to: t.list, cc: cc.list, subject: String(row['Subject']), html: String(row['Html']) },
        String(row['Scheduled by'] || ''), Outbox.STATUS.PENDING);
      outboxLog_(row, memberTag_(row['Scheduled by']), 'sent as scheduled');
    } catch (e) {
      console.error('outboxSendDue_ ' + r0['Id'] + ': ' + (e.userMessage || e.message));
      notifyAdmin_('Scheduled email not sent', (r0['Template'] || '') + ' for ' + (r0['Scout'] || '') + ': ' + (e.userMessage || e.message) +
        '\nIt is back in the Outbox.');
    }
  });
  return due.length;
}

function actionOutboxSentByMe_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var row = outboxFinish_(req.id, function () {
    var upd = { 'Status': Outbox.STATUS.SENT_BY_MEMBER, 'Done': new Date(), 'Done by': who };
    if (req.subject) upd['Subject'] = String(req.subject);
    if (req.to) upd['To'] = String(req.to);
    if (req.cc != null) upd['Cc'] = String(req.cc);
    return upd;
  });
  outboxLog_(row, who, 'sent from ' + who + '\'s own email');
  applyOnSent_(row);
  return { message: 'Marked as sent from your email.' };
}

function actionOutboxDiscard_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var row = outboxFinish_(req.id, function () { return { 'Status': Outbox.STATUS.DISCARDED, 'Done': new Date(), 'Done by': who }; });
  outboxLog_(row, who, 'discarded (not sent)');
  return { message: 'Discarded.' };
}

/** Discarded by mistake: back to the Outbox, unchanged (Jim W., 2026-10-25). */
function actionOutboxRestore_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var row = withLock_(function () {
    var r = outboxRows_().filter(function (x) { return String(x['Id']) === String(req.id || ''); })[0];
    if (!r) throw userError_('That email is no longer on the Outbox tab. Reload the page.');
    if (String(r['Status']) !== Outbox.STATUS.DISCARDED) throw userError_('Only discarded emails can be restored (this one is ' + r['Status'] + ').');
    Tabs.update(OUTBOX_TAB, r._row, { 'Status': Outbox.STATUS.PENDING, 'Done': '', 'Done by': '', 'Note': 'Restored by ' + who + ' ' + Intake.shortDate(new Date()) });
    return r;
  });
  outboxLog_(row, who, 'restored to the Outbox (was discarded)');
  return { message: 'Back in the Outbox.' };
}

/** A sent (or discarded) email as a new draft, to send again (Jim W., 2026-10-25). "On sent" dates are not repeated. */
function actionOutboxCopy_(req) {
  var c = committeeMe_(req.session);
  var who = c.me.initials || c.email;
  var r = outboxRows_().filter(function (x) { return String(x['Id']) === String(req.id || ''); })[0];
  if (!r) throw userError_('That email is no longer on the Outbox tab. Reload the page.');
  var id = Outbox.makeId(Date.now());
  withLock_(function () {
    var f = { 'Id': id, 'Created': new Date(), 'Created by': c.email, 'Record ID': r['Record ID'] || '', 'Scout': r['Scout'] || '',
      'Template': r['Template'] || '', 'Status': Outbox.STATUS.PENDING, 'To': r['To'] || '', 'Cc': r['Cc'] || '',
      'Subject': r['Subject'] || '', 'Html': r['Html'] || '', 'Text': r['Text'] || '', 'Note': 'Copy of ' + r['Id'] + ' (' + r['Status'] + ')' };
    if (r['Attachments']) f['Attachments'] = r['Attachments'];
    if (r['Event at']) f['Event at'] = r['Event at'];
    if (r['Reply to']) f['Reply to'] = r['Reply to'];
    Tabs.append(OUTBOX_TAB, f);
  });
  outboxLog_(r, who, 'drafted again (copy in the Outbox)');
  return { message: 'A copy is waiting in the Outbox.', id: id };
}

/** The file attached to an Outbox email (committee members only), for "Download" on the Outbox. */
function actionOutboxAttachment_(req) {
  committeeMe_(req.session);
  var row = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id || ''); })[0];
  if (!row) throw userError_('That email is no longer in the Outbox. Reload the page.');
  var a = Outbox.parseAttachments(row['Attachments'])[Number(req.index) || 0];
  if (!a) throw userError_('This email has no attachment.');
  var f;
  try { f = DriveApp.getFileById(a.id); } catch (e) { throw userError_('The attached file is no longer in Drive.'); }
  var blob = f.getBlob();
  return { name: a.name || f.getName(), mime: blob.getContentType() || 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) };
}

/**
 * Attach a file to a waiting email (the committee chair, 2026-11-02). The file goes to the Scout's folder → "Email attachments"
 * (no Scout or folder: the intake folder → "Outbox attachments"), and the email lists it; Send includes it.
 * req: {session, id, name, data (base64)} -> {attachments: [names], message}
 */
function actionOutboxAttach_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var name = String(req.name || '').replace(/[\\/]+/g, '_').slice(0, 200);
  var bytes = Utilities.base64Decode(String(req.data || ''));
  var problem = Intake.checkFile({ name: name, tag: 'Other', bytes: bytes.length }, s.maxUploadMB);
  if (problem) throw userError_(name + ': ' + problem);
  var pre = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id || ''); })[0];
  if (!pre) throw userError_('That email is no longer in the Outbox. Reload the page.');
  if (String(pre['Status']) !== Outbox.STATUS.PENDING) throw userError_('Only an email waiting in the Outbox can get attachments (this one is ' + pre['Status'] + ').');
  var total = bytes.length;
  Outbox.parseAttachments(pre['Attachments']).forEach(function (a) { try { total += DriveApp.getFileById(a.id).getSize(); } catch (e) {} });
  if (total > Outbox.MAX_ATTACH_BYTES) throw userError_('With this file the attachments come to ' + Math.round(total / 1048576) + ' MB; an email can carry about 18 MB of files.');
  var folder = null;
  var rec = pre['Record ID'] ? Records.get(String(pre['Record ID'])) : null;
  if (rec) { try { var sf = folderForRecord_(rec, false); if (sf) folder = childFolder_(sf, 'Email attachments'); } catch (e) {} }
  if (!folder) {
    if (!s.intakeFolderId) throw new Error('Settings → intakeFolderId is empty: run Admin → Setup / repair tabs');
    folder = childFolder_(DriveApp.getFolderById(s.intakeFolderId), 'Outbox attachments');
  }
  var file = folder.createFile(Utilities.newBlob(bytes, Intake.mimeFor(name), name));
  ensureOutboxColumn_('Attachments');
  var list;
  try {
    outboxFinish_(req.id, function (r) {
      list = Outbox.withAttachment(Outbox.parseAttachments(r['Attachments']), { id: file.getId(), name: name });
      return { 'Attachments': JSON.stringify(list) };
    });
  } catch (e) { try { file.setTrashed(true); } catch (e2) {} throw e; }
  outboxLog_(pre, c.me.initials || c.email, 'attached ' + name);
  var after = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id); })[0];
  return { attachments: list.map(function (a) { return a.name; }), attachSizes: after ? attachSizes_(after) : [],
    message: 'Attached ' + name + '. Send includes it.' };
}

/** Take a file off a waiting email (the Drive file stays). req: {session, id, index} -> {attachments: [names], message} */
function actionOutboxDetach_(req) {
  committeeMe_(req.session);
  var list, gone = '';
  outboxFinish_(req.id, function (r) {
    var cur = Outbox.parseAttachments(r['Attachments']);
    var a = cur[Number(req.index)];
    if (!a) throw userError_('That attachment is already gone. Reload the page.');
    gone = a.name;
    list = Outbox.withoutAttachment(cur, req.index);
    return { 'Attachments': list.length ? JSON.stringify(list) : '' };
  });
  var after = outboxRows_().filter(function (r) { return String(r['Id']) === String(req.id); })[0];
  return { attachments: list.map(function (a) { return a.name; }), attachSizes: after ? attachSizes_(after) : [],
    message: 'Removed ' + gone + ' from this email (the file stays in Drive).' };
}
