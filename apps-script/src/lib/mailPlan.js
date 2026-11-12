/**
 * MailPlan: decide who actually receives a message.
 *
 * Pure. The Mail adapter (mail.js) sends whatever this returns.
 *
 * Test mode (default ON, fail-safe): every message goes only to
 * settings.testRecipient, subject prefixed "[TEST]", and the intended
 * recipients are listed at the top of the body. If test mode is on and no
 * test recipient is set, nothing is sent.
 */
var MailPlan = (function () {
  function list(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
    return String(v).split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function uniq(arr) {
    var seen = {};
    return arr.filter(function (a) {
      var k = a.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  /**
   * msg: { to, cc, bcc, subject, body, htmlBody?, kind? }
   *   kind 'signin' = carries a working credential: never cc'd to the Committee Group.
   *   kind 'private' = to one person about a minor's paperwork (remote EBoR signing): never cc'd to the Committee Group either.
   * returns { send: bool, reason?, to, cc, bcc, subject, body, htmlBody }
   */
  function plan(msg, settings) {
    var to = uniq(list(msg.to));
    var cc = uniq(list(msg.cc));
    var bcc = uniq(list(msg.bcc));
    var group = (settings.committeeGroupEmail || '').trim();

    if ((msg.kind === 'signin' || msg.kind === 'private') && group) {
      var g = group.toLowerCase();
      var strip = function (a) { return a.toLowerCase() !== g; };
      to = to.filter(strip); cc = cc.filter(strip); bcc = bcc.filter(strip);
    }

    if (!to.length && !cc.length && !bcc.length) {
      return { send: false, reason: 'no recipients' };
    }

    var subject = String(msg.subject || '(no subject)');
    var body = String(msg.body || '');
    var htmlBody = msg.htmlBody ? String(msg.htmlBody) : null;

    // Test mode, but every recipient is on the pass-through list (staging: committee members' own
    // sign-in links): deliver for real. Anything addressed to anyone else still goes to testRecipient.
    var allow = list(settings.testAllow).map(function (a) { return a.toLowerCase(); });
    var everyone = to.concat(cc, bcc);
    if (settings.testMode !== false && allow.length && everyone.every(function (a) { return allow.indexOf(a.toLowerCase()) >= 0; })) {
      return { send: true, to: to, cc: cc, bcc: bcc, subject: '[TEST SITE] ' + subject, body: body, htmlBody: htmlBody };
    }
    if (settings.testMode !== false) {
      var tr = (settings.testRecipient || '').trim();
      if (!tr) return { send: false, reason: 'test mode on but testRecipient is empty' };
      var header = 'TEST MODE. Would have sent to: ' + to.join(', ') +
        (cc.length ? ' | cc: ' + cc.join(', ') : '') +
        (bcc.length ? ' | bcc: ' + bcc.join(', ') : '');
      return {
        send: true,
        to: [tr], cc: [], bcc: [],
        subject: '[TEST] ' + subject,
        body: header + '\n\n' + body,
        htmlBody: htmlBody ? '<p style="color:#b00"><b>' + escapeHtml(header) + '</b></p>' + htmlBody : null,
        intended: { to: to, cc: cc, bcc: bcc }
      };
    }

    return { send: true, to: to, cc: cc, bcc: bcc, subject: subject, body: body, htmlBody: htmlBody };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Addresses from any mix of strings ("a, b") and arrays, lower-cased, de-duplicated, in order. */
  function merge() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      list(arguments[i]).forEach(function (e) { e = e.toLowerCase(); if (/@/.test(e) && out.indexOf(e) < 0) out.push(e); });
    }
    return out;
  }

  /**
   * Emails about a Scout (Jim W., 2026-10-24: empower the Scout): To the Scout, Cc the parent/guardian (two-deep
   * coverage), plus `cc` (committee group, unit contacts …). No Scout email: To the parent. Extra `to` addresses
   * (unit contacts, the board …) follow the Scout. -> {to:[], cc:[], keepCc:[parent]}
   */
  /**
   * To the Scout, Cc the parent/guardian (keepCc: copied even when a template says "Cc: none").
   * noParent (2026-11-01): no parent/guardian email on file -> this address (the committee group) is copied instead,
   * so a Scout email always has an adult on it, and the committee is copied only when it has to be.
   */
  function family(scoutEmail, parentEmail, cc, to, noParent) {
    var t = merge(scoutEmail, to);
    var p = merge(parentEmail);
    if (!p.length && noParent) p = merge(noParent);
    if (!merge(scoutEmail).length) { t = merge(p, to); p = []; }
    p = p.filter(function (e) { return t.indexOf(e) < 0; });
    return { to: t, cc: merge(p, cc).filter(function (e) { return t.indexOf(e) < 0; }), keepCc: p };
  }

  return { plan: plan, list: list, merge: merge, family: family };
})();

if (typeof module !== 'undefined') module.exports = MailPlan;
