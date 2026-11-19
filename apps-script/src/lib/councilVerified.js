/**
 * Council "Ready for EBOR" emails (Jim W., 2026-11-18). After Council verifies a Scout's Eagle application, a Council
 * staff member emails cc-advancement from their own address (so the sender can't be trusted to identify these), subject
 * "<Scout name>, <Unit>, Ready for EBOR" (e.g. "Owen Patrick Fairbanks, T999, Ready for EBOR"), with the Verified
 * Eagle Application attached: the submitted application plus Council's verification signature. Sometimes more files:
 * corrected documents found during verification. Scanner file names ("doc2026111614520.pdf") say nothing about which
 * file is which.
 *
 * Pure: read the subject, recognise each file from its OCR text, plan the names, what moves to Archive/, and whether
 * the row moves. Gmail / Drive work is in councilVerifiedActions.js.
 *
 *   one attachment      -> it IS the Verified Application (Jim W.)
 *   several attachments -> OCR names each one; exactly one Eagle application = the Verified Application;
 *                          anything not recognised (or two applications) is "to identify" (digest + dashboard tag)
 *
 * Names (top of the Scout's folder, beside the -Application_ files Formsite filed):
 *   <Name>-<Unit>_EagleApplication-Verified.pdf   (lib/eborPaperwork.js pickVerified finds it: "verified" in the name)
 *   <Name>-<Unit>_Council-Workbook.pdf, _Council-Statement, _Council-Reference, _Council-Doc-01 (not recognised)
 *   <Name>-<Unit>_Council-ReadyForEBoR-Email.pdf  (what Council wrote)
 * Only the Verified Application's name contains "verified", so the EBoR paperwork page picks the right file.
 */
var CouncilVerified = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }

  var QUERY = 'subject:"ready for EBOR"';
  var READY = /ready\s+for\s+(?:an?\s+|the\s+)?e\.?\s*b\.?\s*o\.?\s*r\b/i;
  var PREFIX = /^\s*(?:(?:re|fwd?|fw|aw|tr)\s*:\s*)+/i;

  /** Any subject that says "Ready for EBOR" (a forward or reply included). */
  function isMatch(subject) { return READY.test(str(subject)); }

  var UNIT = /^(troop|crew|ship|pack|[TCSP])\s*#?\s*-?\s*(\d{1,5})$/i;
  /** "T9817" / "Troop 9817" / "t-9817" -> "T9817"; '' when it isn't a unit. */
  function unitCode(s) {
    var m = UNIT.exec(str(s).replace(/\s+/g, ' '));
    return m ? m[1].charAt(0).toUpperCase() + String(+m[2]) : '';
  }

  /**
   * "Fwd: Owen Patrick Fairbanks, T999, Ready for EBOR" -> {name, first, middle, last, unit: 'T999'} (unit '' when
   * the subject has none); null when the subject doesn't say "Ready for EBOR" or has no name before it.
   */
  function parseSubject(subject) {
    var s = str(subject).replace(PREFIX, '');
    var m = READY.exec(s);
    if (!m) return null;
    var parts = s.slice(0, m.index).split(',').map(str).filter(Boolean);
    var unit = '';
    if (parts.length > 1 && unitCode(parts[parts.length - 1])) unit = unitCode(parts.pop());
    else if (parts.length === 1) {                             // "Owen Fairbanks T999 Ready for EBOR"
      var u = /\s((?:troop|crew|ship|pack)\s*#?\s*\d{1,5}|[TCSP]\s*-?\s*\d{1,5})$/i.exec(parts[0]);
      if (u) { unit = unitCode(u[1]); parts[0] = str(parts[0].slice(0, u.index)); }
    }
    var name = str(parts.join(' ').replace(/^(?:scout|eagle candidate)\s*:\s*/i, '').replace(/[-–:]+$/, ''));
    var w = name.split(/\s+/).filter(Boolean);
    if (!w.length) return null;
    return { name: name, first: w[0], middle: w.slice(1, -1).join(' '), last: w.length > 1 ? w[w.length - 1] : '', unit: unit };
  }

  // What a file is, from the first part of its OCR text (the first page is what tells). Application first: its title.
  var KINDS = [
    { kind: 'application', re: /eagle\s+scout\s+rank\s+application/i },
    { kind: 'workbook', re: /service\s+project\s+(?:proposal|workbook|plan|report)|project\s+workbook/i },
    { kind: 'statement', re: /ambitions\s+and\s+life\s+purpose|life\s+purpose/i },
    { kind: 'reference', re: /letter\s+of\s+recommendation|reference\s+letter|recommendation\s+for/i }
  ];
  /** OCR text -> 'application' | 'workbook' | 'statement' | 'reference' | '' (not recognised). */
  function classify(text) {
    var t = str(text).slice(0, 2500).replace(/\s+/g, ' ');
    var k = KINDS.filter(function (x) { return x.re.test(t); })[0];
    return k ? k.kind : '';
  }

  /**
   * Attachments worth filing: drop small images (email signature logos that arrive as attachments).
   * atts: [{name, mime, bytes}] -> indexes kept.
   */
  function keep(atts) {
    var out = [];
    (atts || []).forEach(function (a, i) {
      var img = /^image\//i.test(str(a.mime)) || /\.(png|gif|jpe?g)$/i.test(str(a.name));
      if (img && (Number(a.bytes) || 0) < 40000) return;
      out.push(i);
    });
    return out;
  }

  var TAG = { workbook: 'Workbook', statement: 'Statement', reference: 'Reference' };
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(str(name)); return m ? m[1].toLowerCase() : 'pdf'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * atts: [{name, kind}] (kind from classify(); '' when not recognised or OCR didn't run). One attachment = the
   * Verified Application whatever OCR says. -> {files: [{index, name, kind}], verified: index | -1,
   * toIdentify: [file names a member should look at], emailName}
   */
  function plan(atts, scoutName, unit, namePart, unitPart) {
    var base = namePart(scoutName) + '-' + unitPart(unit);
    atts = atts || [];
    var apps = [];
    atts.forEach(function (a, i) { if (a.kind === 'application') apps.push(i); });
    var verified = atts.length === 1 ? 0 : apps.length === 1 ? apps[0] : -1;
    var count = {}, files = [], toIdentify = [];
    atts.forEach(function (a, i) {
      var name;
      if (i === verified) name = base + '_EagleApplication-Verified.' + extOf(a.name);
      else if (TAG[a.kind]) {
        var n = count[a.kind] = (count[a.kind] || 0) + 1;
        name = base + '_Council-' + TAG[a.kind] + (n > 1 ? '-' + n : '') + '.' + extOf(a.name);
      } else {
        var d = count.doc = (count.doc || 0) + 1;
        name = base + '_Council-Doc-' + pad(d) + '.' + extOf(a.name);
        toIdentify.push(name + (a.kind === 'application' ? ' (looks like an Eagle application: which one is the verified one?)' : ''));
      }
      files.push({ index: i, name: name, kind: i === verified ? 'application' : a.kind });
    });
    return { files: files, verified: verified, toIdentify: toIdentify, emailName: base + '_Council-ReadyForEBoR-Email.pdf' };
  }

  var SUBMITTED_APP = /-Application_RankApplication(-\d+)?\.[A-Za-z0-9]+$/;
  var VERIFIED_APP = /_EagleApplication-Verified\.[A-Za-z0-9]+$/;
  /**
   * What moves to Archive/ before the new files land (top: [{id, name}] at the top of the folder): when a Verified
   * Application came, the application as submitted (Formsite's -Application_RankApplication) and an earlier Verified
   * one; always an earlier file with the same name as a new one (the same email filed twice, or a corrected resend).
   */
  function toArchive(top, plan) {
    var names = (plan.files || []).map(function (f) { return f.name.toLowerCase(); }).concat([str(plan.emailName).toLowerCase()]);
    var hasVerified = plan.verified >= 0;
    return (top || []).filter(function (f) {
      var n = str(f.name);
      if (names.indexOf(n.toLowerCase()) >= 0) return true;
      return hasVerified && (SUBMITTED_APP.test(n) || VERIFIED_APP.test(n));
    }).map(function (f) { return f.id; });
  }

  var MOVE_FROM = ['app_submitted', 'proposal_approved'];   // the "Application verified…" row action's stages
  var ALREADY = ['app_verified', 'ebor_booked', 'ebor_paused', 'eagle_earned', 'eagle_not_awarded'];
  /**
   * hit: CouncilApp.matchRecord() result; section: the Scout's stage key. Only a close match (first + last name, unit)
   * in Application Submitted or Proposal Approved moves to Application Verified.
   *   'Matched'  close match; moved, or already at/after Application Verified (moveNote says which)
   *   'Stage?'   close match in an earlier stage: not moved
   *   'Check'    loose match: not moved      'No match'
   * -> {match, promote}
   */
  function decide(hit, section) {
    if (!hit || !hit.recordId) return { match: 'No match', promote: false };
    if (!hit.close) return { match: 'Check', promote: false };
    if (MOVE_FROM.indexOf(section) >= 0) return { match: 'Matched', promote: true };
    if (ALREADY.indexOf(section) >= 0) return { match: 'Matched', promote: false };
    return { match: 'Stage?', promote: false };
  }

  // Council Verified tab: one row per "Ready for EBOR" email.
  var TAB = 'Council Verified';
  var HEADERS = ['Received', 'Subject', 'Name on email', 'Unit on email', 'Match', 'Scout', 'Record ID', 'How', 'Files',
    'To identify', 'Folder', 'Email', 'Checked', 'Stage'];

  function checked(v) { return v === true || (v !== false && str(v) !== '' && str(v).toUpperCase() !== 'FALSE'); }
  /** Rows a member still has to look at: not Matched, or files to identify; until Checked. -> [{title, why, ms, recordId, folder, when}] */
  function needsCheck(r) { return !!str(r['Match']) && (r['Match'] !== 'Matched' || !!str(r['To identify'])) && !checked(r['Checked']); }
  /** Dashboard "✓ Council email checked" (2026-11-19): this Scout's rows that still raise the tag. -> rows (with _row) */
  function rowsToTick(rows, recordId) {
    return (rows || []).filter(function (r) { return str(recordId) && str(r['Record ID']) === str(recordId) && needsCheck(r); });
  }
  function toCheck(rows, fmtDate) {
    return (rows || []).filter(needsCheck).map(function (r) {
      var d = r['Received'] instanceof Date ? r['Received'] : new Date(r['Received']);
      var who = str(r['Name on email']) + (str(r['Unit on email']) ? ' (' + str(r['Unit on email']) + ')' : '');
      var why = r['Match'] === 'No match' ? 'no matching Scout: files in ' + str(r['Folder'])
        : r['Match'] === 'Stage?' ? 'filed for ' + str(r['Scout']) + ', but they are in ' + (str(r['Stage']) || 'another stage') + ': row not moved to Application Verified'
        : r['Match'] === 'Check' ? 'filed for ' + str(r['Scout']) + ' by ' + str(r['How']) + ': is that right? (row not moved)'
        : 'filed for ' + str(r['Scout']);
      if (str(r['To identify'])) why += '; which document is which? ' + str(r['To identify']);
      return { ms: d.getTime() || 0, recordId: str(r['Record ID']), folder: str(r['Folder']), when: isNaN(d) ? '' : fmtDate(d),
        title: 'Ready for EBOR: ' + who + (isNaN(d) ? '' : ', ' + fmtDate(d)), why: why };
    }).sort(function (a, b) { return a.ms - b.ms; });
  }

  /** Dashboard tag: {recordId: {why, folder, label: 'Council', tab}} (newest wins), like CouncilApp.flags. */
  function flags(rows, fmtDate) {
    var out = {};
    toCheck(rows, fmtDate).forEach(function (x) {
      if (!x.recordId) return;
      out[x.recordId] = { why: 'Council "Ready for EBOR"' + (x.when ? ' ' + x.when : '') + ': ' + x.why, folder: x.folder, label: 'Council', tab: TAB };
    });
    return out;
  }

  return { QUERY: QUERY, isMatch: isMatch, parseSubject: parseSubject, unitCode: unitCode, classify: classify, keep: keep,
    plan: plan, toArchive: toArchive, decide: decide, TAB: TAB, HEADERS: HEADERS, toCheck: toCheck, flags: flags,
    needsCheck: needsCheck, rowsToTick: rowsToTick };
})();

if (typeof module !== 'undefined') module.exports = CouncilVerified;
