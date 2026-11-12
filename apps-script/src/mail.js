/**
 * Mail adapter. Every outgoing email goes through sendMail_ so test mode
 * (lib/mailPlan.js) can't be bypassed.
 *
 * msg: { to, cc, bcc, subject, body, htmlBody?, kind?, replyTo?, attachments? (blobs) }
 *   kind 'signin' = never cc the Committee Group. replyTo overrides Settings → replyTo (e.g. the member who sends
 *   an email with attachments, so Council's "please rescan" reaches them).
 */
function sendMail_(msg) {
  var settings = getSettings_();
  if (settings.testMode !== false && settings.testDeliverToCommittee === true) {
    // Staging playground: committee members get mail addressed only to themselves (their sign-in links).
    settings = Object.assign({}, settings, { testAllow: committeeAll_().map(function (m) { return m.email; }).filter(String) });
  }
  var p = MailPlan.plan(msg, settings);
  if (!p.send) {
    console.warn('Mail not sent (' + p.reason + '): ' + (msg.subject || ''));
    return p;
  }
  var opts = { name: 'Coyote Creek Advancement' };
  if (p.cc.length) opts.cc = p.cc.join(',');
  if (p.bcc.length) opts.bcc = p.bcc.join(',');
  if (p.htmlBody) opts.htmlBody = p.htmlBody;
  var replyTo = String(msg.replyTo || settings.replyTo || settings.committeeGroupEmail || '').trim();
  if (msg.attachments && msg.attachments.length) opts.attachments = msg.attachments;
  if (replyTo) opts.replyTo = replyTo;
  MailApp.sendEmail(p.to.join(','), p.subject, p.body, opts);
  console.log('Mail sent: ' + p.subject + ' → ' + p.to.join(','));
  return p;
}

/** msg fields for an email about a Scout: To the Scout, Cc parent + cc (see MailPlan.family). fields: record fields. */
function familyMsg_(fields, cc, to) {
  var group = '';
  try { group = getSettings_().committeeGroupEmail || ''; } catch (e) {}
  return MailPlan.family(fields.scout_email, fields.parent_email, cc, to, group);   // no parent email: the committee is copied
}

/** Errors go to the admin (still subject to test mode). */
function notifyAdmin_(subject, body) {
  var s = getSettings_();
  var to = s.adminEmail || s.testRecipient;
  if (!to) return;
  try { sendMail_({ to: to, subject: '[Eagle Tracker] ' + subject, body: body }); }
  catch (e) { console.error('notifyAdmin_ failed: ' + e); }
}

/** Menu: send yourself a message to prove mail + test mode work. */
function menuSendTestEmail() {
  if (!councilAccountOk_()) return;
  var s = getSettings_();
  var p = sendMail_({
    to: Anonymize.testEmail(s.testRecipient, 'Scout_1'),
    cc: s.committeeGroupEmail || '',
    subject: 'Eagle Tracker test email',
    body: 'If test mode is on, this arrived only at ' + s.testRecipient + ' with a [TEST] subject.\n' +
          'Remaining daily mail quota: ' + MailApp.getRemainingDailyQuota()
  });
  SpreadsheetApp.getUi().alert(p.send ? 'Sent to ' + p.to.join(', ') + '\nSubject: ' + p.subject
                                      : 'Not sent: ' + p.reason);
}
