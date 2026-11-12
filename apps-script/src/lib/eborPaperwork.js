/**
 * EborPaperwork (Task 12, Jim W., 2026-11-11): the two documents signed at an Eagle Board of Review. Pure.
 *
 *  1. The Verified Eagle Application (Council's scan), page 2, Requirement 7: a date (MM / DD / YY boxes) and two
 *     signatures (the board of review chair, the council / district board representative).
 *  2. The Advancement Report (BSA form 34403, fillable, named fields): unit, leader, district, title, the Scout's row
 *     and three signatures (`Signature1` "Signed" = the council / district person, `Signature2`, `Signature3`).
 *
 * Every date on both = the EBoR date. The page is built on the Sign Workshop engine; this file holds what is decided
 * on the server: the field map, the signer rules, which file in the folder is the Verified Application, what moves to
 * Archive, and the Scout dropdown. Names and addresses are runtime data: nothing here is a real person's.
 */
var EborPaperwork = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function B() { return (typeof Booking !== 'undefined') ? Booking : require('./booking'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var BADGE = 'Eagle Scout';
  var UNIT_GROUP = 'Group16';
  /** Group16 is four radio widgets in this order (left to right): pick the widget by position, not by export value. */
  var UNIT_ORDER = ['P', 'T', 'C', 'S'];
  var UNIT_TYPES = { P: 'Pack', T: 'Troop', C: 'Crew', S: 'Ship' };
  var FIELD = {
    unitNumber: 'No', district: 'District', leader: 'Leader', address: 'Address', city: 'City', state: 'State', zip: 'Zip',
    forwarded: 'Date this report forwarded to council service center', title: 'Title', boardDate: 'Board of Review Date',
    scout: '#1', earned: 'Date Award Earned1', badge: 'Badge of Rank Merit Badge or Award1'
  };
  var SIGNATURE_FIELDS = ['Signature1', 'Signature2', 'Signature3'];

  /** 'YYYY-MM-DD' -> {y, m, d} or null (a real calendar date). */
  function parts(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  /** Requirement 7's three boxes: {mm, dd, yy, text: 'MM/DD/YY'}; null when the date is not a date. */
  function mmddyy(ymd) {
    var p = parts(ymd);
    if (!p) return null;
    var yy = pad2(p.y % 100);
    return { mm: pad2(p.m), dd: pad2(p.d), yy: yy, text: pad2(p.m) + '/' + pad2(p.d) + '/' + yy };
  }

  /** The Advancement Report's date fields: 'MM/DD/YYYY' (a four-digit year, unmistakable). '' for a bad date. */
  function reportDate(ymd) {
    var p = parts(ymd);
    return p ? pad2(p.m) + '/' + pad2(p.d) + '/' + p.y : '';
  }

  /** 'T999' / 'Troop 999' -> {letter: 'T', number: '999', type: 'Troop', index: 1 (Group16 widget)}; null when unreadable. */
  function unitParts(unit) {
    var m = /^\s*(pack|troop|crew|ship|[PTCS])\s*0*(\d+)\s*$/i.exec(str(unit));
    if (!m) return null;
    var letter = m[1].charAt(0).toUpperCase();
    return { letter: letter, number: String(+m[2]), type: UNIT_TYPES[letter], index: UNIT_ORDER.indexOf(letter) };
  }

  /**
   * The Advancement Report fill. i: {scout, unit, district, title, leaderName, address, city, state, zip, boardYmd}.
   * -> {text: {field name: value}, radio: {group, index} | null, problems: [text]}  (blank values are left out)
   */
  function reportFields(i) {
    var text = {}, problems = [];
    var date = reportDate(i.boardYmd);
    if (!date) problems.push('The EBoR date is missing or not a date.');
    var u = unitParts(i.unit);
    if (!u) problems.push('The unit "' + str(i.unit) + '" is not a Pack, Troop, Crew or Ship number.');
    function put(name, v) { v = str(v); if (v) text[name] = v; }
    if (u) put(FIELD.unitNumber, u.number);
    put(FIELD.district, i.district);
    put(FIELD.leader, i.leaderName);
    put(FIELD.address, i.address);
    put(FIELD.city, i.city);
    put(FIELD.state, i.state);
    put(FIELD.zip, i.zip);
    put(FIELD.forwarded, date);
    put(FIELD.title, i.title);
    put(FIELD.boardDate, date);
    put(FIELD.scout, i.scout);
    // Date Award Earned is a narrow column: MM/DD/YY lets its text be larger (Jim W., 2026-11-12).
    var short = mmddyy(i.boardYmd);
    put(FIELD.earned, short ? short.text : '');
    put(FIELD.badge, BADGE);
    if (!str(i.leaderName)) problems.push('No Unit Leader on the Key 3 tab for ' + (str(i.unit) || 'this unit') + ': the Leader box stays empty.');
    return { text: text, radio: u ? { group: UNIT_GROUP, index: u.index } : null, problems: problems };
  }

  // ---------- signers ----------

  var SLOTS = {
    application: [
      { key: 'chair', label: 'Board of review chair', rep: false },
      { key: 'rep', label: 'Council / district board representative', rep: true }
    ],
    report: [
      { key: 'Signature1', label: 'Council / district ("Signed")', rep: true },
      { key: 'Signature2', label: 'Board member', rep: false },
      { key: 'Signature3', label: 'Board member', rep: false }
    ]
  };
  var REP_LABEL = 'District Advancement Committee / Council representative';
  var DOC_LABEL = { application: 'Eagle Scout Rank Application (Requirement 7)', report: 'Advancement Report' };

  /** Signature slots of a document: [{key, label, rep (ticked by default)}]. */
  function signerSlots(kind) {
    return (SLOTS[kind] || []).map(function (s) { return { key: s.key, label: s.label, rep: s.rep }; });
  }

  /**
   * signers: [{name, rep, signed}] in slot order. Every slot needs a typed name and a signature; the same person
   * can't sign twice on one document; at least one signer is a District Advancement Committee / Council
   * representative (the others are any adult board member present).
   * -> {ok, errors, clean: [{key, name, rep}]}
   */
  function checkSigners(kind, signers, opts) {
    var slots = SLOTS[kind], errors = [], clean = [];
    var partial = !!(opts && opts.partial);   // Save partial (remote signing, 2026-11-12): empty boxes allowed, signed ones need a name
    if (!slots) return { ok: false, errors: ['Unknown document.'], clean: [] };
    var label = DOC_LABEL[kind], list = signers || [];
    if (list.length !== slots.length) errors.push(label + ' needs ' + slots.length + ' signatures.');
    var seen = {};
    slots.forEach(function (slot, i) {
      var s = list[i] || {}, name = str(s.name).replace(/\s+/g, ' ').slice(0, 80);
      if (partial && !s.signed) { clean.push({ key: slot.key, name: name, rep: !!s.rep, signed: false }); return; }
      if (name.length < 2) errors.push(label + ', ' + slot.label + ': type the signer\'s name.');
      else if (seen[name.toLowerCase()]) errors.push(label + ': ' + name + ' is on two signature lines.');
      seen[name.toLowerCase()] = true;
      if (!s.signed) errors.push(label + ', ' + slot.label + ': the signature is missing.');
      clean.push(partial ? { key: slot.key, name: name, rep: !!s.rep, signed: true } : { key: slot.key, name: name, rep: !!s.rep });
    });
    if (!partial && !clean.some(function (c) { return c.rep; })) errors.push(label + ': tick "' + REP_LABEL + '" for at least one signer.');
    return { ok: !errors.length, errors: errors, clean: clean };
  }

  // ---------- files in the Scout's folder ----------

  var OUR_SIGNED = /_(EagleApplication|AdvancementReport)-Signed\.pdf$/i;
  function isPdf(f) { return /\.pdf$/i.test(str(f && f.name)) || /pdf/i.test(str(f && f.mime)); }
  function newest(a, b) { return (Number(b.modified) || 0) - (Number(a.modified) || 0) || (str(b.name) < str(a.name) ? -1 : 1); }

  /**
   * The Verified Eagle Application Council emailed: the newest PDF whose name contains "verified" (any case), apart from
   * our own signed outputs. files: [{id, name, mime, modified (ms)}]. -> the file or null.
   */
  function pickVerified(files) {
    var hits = (files || []).filter(function (f) { return isPdf(f) && /verified/i.test(str(f.name)) && !OUR_SIGNED.test(str(f.name)); });
    return hits.sort(newest)[0] || null;
  }

  /** Every PDF in the folder for the picker: the "verified" ones first, newest first inside each group. */
  function pdfChoices(files) {
    var pdfs = (files || []).filter(isPdf).map(function (f) {
      return { id: f.id, name: f.name, mime: f.mime, bytes: f.bytes, modified: f.modified, date: f.date, verified: /verified/i.test(str(f.name)) && !OUR_SIGNED.test(str(f.name)) };
    });
    return pdfs.sort(function (a, b) { return (a.verified === b.verified ? 0 : a.verified ? -1 : 1) || newest(a, b); });
  }

  /**
   * What moves to Archive when the signed pair is filed: the Verified Application used, and any earlier file with the
   * same standard name as one of the new files. top: [{id, name}] (top level); keepIds: the new files' ids;
   * names: EagleDone.fileNames(...); verifiedId: '' when the Verified Application came from the computer.
   */
  function archivePlan(top, keepIds, names, verifiedId) {
    var keep = {};
    (keepIds || []).forEach(function (id) { keep[id] = true; });
    var std = [str(names && names.application).toLowerCase(), str(names && names.report).toLowerCase()];
    return (top || []).filter(function (f) {
      if (keep[f.id]) return false;
      if (verifiedId && f.id === verifiedId) return true;
      return std.indexOf(str(f.name).toLowerCase()) >= 0;
    }).map(function (f) { return f.id; });
  }

  // ---------- the Scout dropdown ----------

  /**
   * The Scout's EBoR on the schedule: the earliest on or after `todayYmd`, else the latest before it.
   * rows: schedule rows. -> {ymd, time, reps: [initials], boardMembers (cell text), upcoming} or null
   */
  function boardFor(rows, recordId, todayYmd) {
    var b = B(), t = parts(todayYmd), startOfToday = t ? new Date(t.y, t.m - 1, t.d).getTime() : 0;
    var mine = (rows || []).filter(function (r) { return str(r.record_id) === recordId && b.typeCode(r.slot_type) === 'EBoR'; })
      .map(function (r) { return { r: r, start: b.slotStart(r.date, r.time) }; })
      .filter(function (x) { return !isNaN(x.start); });
    if (!mine.length) return null;
    var up = mine.filter(function (x) { return x.start >= startOfToday; }).sort(function (x, y) { return x.start - y.start; })[0];
    var pick = up || mine.sort(function (x, y) { return y.start - x.start; })[0];
    var d = new Date(pick.start);
    return { ymd: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), time: str(pick.r.time), start: pick.start,
      reps: b.splitWho(pick.r.reps), boardMembers: str(pick.r.board_members), upcoming: !!up };
  }

  /**
   * records: [{recordId, section, name, unit}] (EBoR Booked and EBoR Paused), boards: {recordId: boardFor(...)}.
   * -> {scouts (upcoming boards first, soonest first; then past ones, latest first; then no board), selected (recordId or '')}
   */
  function choices(records, boards, sectionLabel) {
    var list = (records || []).filter(function (r) { return r.section === 'ebor_booked' || r.section === 'ebor_paused'; }).map(function (r) {
      var bd = boards && boards[r.recordId] || null;
      return { recordId: r.recordId, name: r.name, unit: r.unit, section: r.section, stage: sectionLabel ? sectionLabel(r.section) : r.section,
        boardYmd: bd ? bd.ymd : '', boardTime: bd ? bd.time : '', upcoming: !!(bd && bd.upcoming), start: bd ? bd.start : 0 };
    });
    var rank = function (x) { return x.upcoming ? 0 : x.boardYmd ? 1 : 2; };
    list.sort(function (a, b) {
      return rank(a) - rank(b) || (rank(a) === 0 ? a.start - b.start : b.start - a.start) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    var first = list[0];
    return { scouts: list, selected: first && first.upcoming ? first.recordId : '' };
  }

  // ---------- log ----------

  /** The Life to Eagle Log line. sign: {application: [{name, rep}], report: [...]}. */
  function logLine(shortDate, by, boardYmd, sign, filedNames, archivedCount, emailDrafted) {
    var who = function (list) { return (list || []).map(function (s) { return s.name + (s.rep ? ' (DAC/Council)' : ''); }).join(', '); };
    var d = mmddyy(boardYmd);
    return shortDate + ' [' + by + '] EBoR paperwork signed in the browser' + (d ? ' (board ' + d.text + ')' : '') +
      '. Requirement 7: ' + who(sign && sign.application) + '. Advancement Report: ' + who(sign && sign.report) +
      '. Filed ' + (filedNames || []).join(' and ') + (archivedCount ? '; ' + archivedCount + ' earlier file(s) to Archive' : '') +
      (emailDrafted ? '; Council email drafted in the Outbox' : '; no Council email drafted') + '.';
  }

  // ---------- the Demo Scout (Task 14b) ----------

  /**
   * A fictional Scout for showing the committee the page. It is NOT a record: the server handles recordId 'DEMO' in explicit
   * branches that never read or write the tracking tab or a Scout's log and never address Council.
   */
  var DEMO = {
    recordId: 'DEMO',
    label: '\uD83E\uDDEA Demo Scout (test: no email to Council)',
    name: 'Theodore "Teddy" Sample', preferred: 'Teddy', unit: 'T999', stage: 'Demo (test)',
    leaderName: 'Pat Q Leader', address: '1 Example Way', city: 'San Jose', state: 'CA', zip: '95100',
    folderName: 'Demo Scout - T999 (test)', verifiedName: 'Verified Eagle Application (demo).pdf',
    activity: 'EBoR paperwork demo run by ',
    note: '[DEMO] A test run of the EBoR paperwork page with a fictional Scout. This is what Council would receive; nothing was sent to Council.'
  };

  function isDemo(recordId) { return str(recordId) === DEMO.recordId; }

  /** The Scout dropdown with the Demo Scout first. ch: choices(...) -> same shape; `selected` is untouched. */
  function withDemo(ch, todayYmd) {
    var entry = { recordId: DEMO.recordId, name: DEMO.name, unit: DEMO.unit, section: 'demo', stage: DEMO.stage, label: DEMO.label,
      boardYmd: str(todayYmd), boardTime: '', upcoming: false, start: 0, demo: true };
    return { scouts: [entry].concat((ch && ch.scouts) || []), selected: ch ? ch.selected : '' };
  }

  /** Folder path under the Scouts folder: [<current year>, 'Demo Scout - T999 (test)']. */
  function demoFolderPath(todayYmd) {
    var p = parts(todayYmd);
    return [String(p ? p.y : new Date().getFullYear()), DEMO.folderName];
  }

  /** Which signed documents are already at the top of a folder. files: [{name}] -> {application, report} */
  function signedIn(files) {
    var out = { application: false, report: false };
    (files || []).forEach(function (f) {
      var n = str(f && f.name);
      if (/_EagleApplication-Signed\.pdf$/i.test(n)) out.application = true;
      if (/_AdvancementReport-Signed\.pdf$/i.test(n)) out.report = true;
    });
    return out;
  }

  /** "Reset demo": the signed files at the top of the demo folder (they move to its Archive). top: [{id, name}] -> [id] */
  function demoResetPlan(top) {
    return (top || []).filter(function (f) { return OUR_SIGNED.test(str(f.name)); }).map(function (f) { return f.id; });
  }

  /** What the demo page shows for the Scout: the Report fill needs this one's leader and address. */
  function demoReportInput(boardYmd, district, title) {
    return { scout: DEMO.name, unit: DEMO.unit, district: district, title: title, leaderName: DEMO.leaderName, address: DEMO.address,
      city: DEMO.city, state: DEMO.state, zip: DEMO.zip, boardYmd: boardYmd };
  }

  /**
   * The Council email as a demo: the same subject and body, marked [DEMO], To the member who ran the demo ONLY (no Cc, no Bcc,
   * whatever the original addressed). out: {to, cc, bcc, subject, body, htmlBody, ...}. -> a new object
   */
  function demoEmail(out, toEmail) {
    var o = out || {};
    var subject = str(o.subject).replace(/^\[DEMO\]\s*/, '');
    var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    return { to: [str(toEmail)].filter(String), cc: '', bcc: '', kind: o.kind, subject: '[DEMO] ' + subject,
      body: DEMO.note + '\n\n' + str(o.body), htmlBody: '<p><b>' + esc(DEMO.note) + '</b></p>' + str(o.htmlBody) };
  }

  /** The Activity line for a demo run. */
  function demoActivity(by) { return DEMO.activity + str(by); }

  return { BADGE: BADGE, UNIT_GROUP: UNIT_GROUP, UNIT_ORDER: UNIT_ORDER, FIELD: FIELD, SIGNATURE_FIELDS: SIGNATURE_FIELDS, REP_LABEL: REP_LABEL,
    parts: parts, mmddyy: mmddyy, reportDate: reportDate, unitParts: unitParts, reportFields: reportFields,
    signerSlots: signerSlots, checkSigners: checkSigners, pickVerified: pickVerified, pdfChoices: pdfChoices, archivePlan: archivePlan,
    boardFor: boardFor, choices: choices, logLine: logLine,
    DEMO: DEMO, isDemo: isDemo, withDemo: withDemo, demoFolderPath: demoFolderPath, signedIn: signedIn, demoResetPlan: demoResetPlan,
    demoReportInput: demoReportInput, demoEmail: demoEmail, demoActivity: demoActivity };
})();

if (typeof module !== 'undefined') module.exports = EborPaperwork;
