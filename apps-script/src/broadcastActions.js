/**
 * "Email the units" (Admin page; rules in lib/unitBroadcast.js). From the committee account, To the committee group,
 * the units in Bcc (batches of 48), Reply-To the group unless changed. Test mode applies (sendMail_).
 *   broadcastPreview {session, types, chairs, leaders, contacts}       -> {recipients, units, batches, quota, group}
 *   broadcastSend    {session, ...same, skip:[emails], subject, html, replyTo, test}  -> {message}
 */
function broadcastList_(req) {
  var types = (req.types || []).map(String).filter(function (t) { return UnitBroadcast.TYPES[t]; });
  return UnitBroadcast.recipients(readTabOrEmpty_(KEY3_TAB), readTabOrEmpty_(UNIT_CONTACTS_TAB),
    { types: types, chairs: !!req.chairs, leaders: !!req.leaders, contacts: !!req.contacts });
}

function actionBroadcastPreview_(req) {
  committeeMe_(req.session);
  var r = broadcastList_(req);
  var quota = null;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  var s = getSettings_();
  return { recipients: r.recipients, units: r.units, batches: UnitBroadcast.batches(r.recipients).length, perMessage: UnitBroadcast.PER_MESSAGE,
    quota: quota, group: String(s.committeeGroupEmail || ''), testMode: s.testMode !== false };
}

function actionBroadcastSend_(req) {
  var c = committeeMe_(req.session);
  var s = getSettings_();
  var group = String(s.committeeGroupEmail || '').trim();
  if (!group) throw userError_('Settings → committeeGroupEmail is empty.');
  var subject = String(req.subject || '').trim();
  if (!subject) throw userError_('Type the subject.');
  var html = Outbox.clean(req.html);
  var text = Outbox.htmlToText(html).trim();
  if (!text) throw userError_('The message is empty.');
  var replyTo = String(req.replyTo || '').trim() || group;
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(replyTo)) throw userError_('Reply-To is not an email address.');
  var skip = (req.skip || []).map(function (e) { return String(e).toLowerCase(); });
  var emails = broadcastList_(req).recipients.map(function (x) { return x.email; }).filter(function (e) { return skip.indexOf(e) < 0; });
  if (!emails.length) throw userError_('No recipients: tick at least one unit type and one group of people.');
  var groups = UnitBroadcast.batches(emails);
  if (req.test) {
    var head = '<p style="padding:8px;background:#fff4c2;border:1px solid #c7891a;font:12px/1.4 monospace">PREVIEW: only to you. The real email goes To ' +
      group + ', Bcc ' + emails.length + ' unit address(es) in ' + groups.length + ' email(s), Reply-To ' + replyTo + '.</p>';
    var p0 = sendMail_({ to: c.email, subject: '[PREVIEW, only to you] ' + subject, body: 'PREVIEW (only to you): ' + emails.length + ' recipients, ' + groups.length + ' email(s).\n\n' + text,
      htmlBody: head + html, replyTo: replyTo });
    return { message: p0.send ? 'Test sent to ' + p0.to.join(', ') + '.' : 'Not sent: ' + p0.reason };
  }
  var quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 1500; }
  if (quota < emails.length + groups.length) throw userError_('Today\'s email allowance left: ' + quota + ' recipients; this needs ' + (emails.length + groups.length) + '. Try tomorrow.');
  var sent = 0, failed = [];
  groups.forEach(function (bcc, i) {
    try {
      var p = sendMail_({ to: group, bcc: bcc, subject: subject, body: text, htmlBody: html, replyTo: replyTo });
      if (p.send) sent += bcc.length; else failed.push('email ' + (i + 1) + ': ' + p.reason);
    } catch (e) { failed.push('email ' + (i + 1) + ': ' + e.message); }
  });
  adminLog_('Email to the units "' + subject + '": ' + sent + ' of ' + emails.length + ' addresses in ' + groups.length + ' email(s)' +
    (failed.length ? '; FAILED ' + failed.join('; ') : ''), c.email);
  if (failed.length) throw userError_('Sent to ' + sent + ' of ' + emails.length + '. Not sent: ' + failed.join('; '));
  return { message: 'Sent to ' + emails.length + ' unit address' + (emails.length === 1 ? '' : 'es') + ' in ' + groups.length + ' email' + (groups.length === 1 ? '' : 's') +
    ' (To ' + group + ', Bcc the units' + (s.testMode !== false ? '; TEST MODE: only the test inbox got it' : '') + ').' };
}
