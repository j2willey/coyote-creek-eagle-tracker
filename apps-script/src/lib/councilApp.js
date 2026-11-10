/**
 * Council Eagle application emails (Jim W., 2026-11-03). When a Scout submits the Eagle application on the Council's
 * Formsite form, Formsite emails cc-advancement: from noreply@fs10.formsite.com, subject "Eagle Project Result: <name>",
 * with the uploaded files attached (names "f-1608-<field>-<ref#>_<code>_<original>") and an HTML table of every answer.
 * The table row of each upload question links to the same file name, so the question is read from the table
 * (field numbers are only a fallback). Pure: parse, match the Scout, plan the file names, clean the body for the PDF.
 *
 * In the Scout's folder (councilAppActions.js), all in one place (Jim W., 2026-11-03: no Proposal/ subfolder, nobody
 * compares two folders): the new files go at the top as <Name>-<Unit>-Application_<Tag>.<ext>, so they sort together
 * and apart from the Proposal files (<Name>-<Unit>_ESSPP-V2.pdf …); nothing else moves. Files of an earlier
 * submission (a resubmission) move to Archive/.
 */
var CouncilApp = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }

  var FROM = 'noreply@fs10.formsite.com';
  var SUBJECT_PREFIX = 'Eagle Project Result:';
  var QUERY = 'from:' + FROM + ' subject:"Eagle Project Result"';

  function isMatch(from, subject) {
    return str(from).toLowerCase().indexOf(FROM) >= 0 && str(subject).indexOf(SUBJECT_PREFIX) === 0;
  }

  function decode(s) {
    return String(s || '').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/g, '&');
  }
  function text(html) { return str(decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')); }

  var ROW = /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  /** -> [{label, value (text), files: [Formsite file names linked in the row], urls: {file name: link}}] */
  function rows(html) {
    var out = [], m;
    ROW.lastIndex = 0;
    while ((m = ROW.exec(String(html || '')))) {
      var files = [], urls = {}, f, re = /href=["'](https:\/\/[^"'<>\s]*?\/files\/([^"'<>\s?#]+))["']/g;
      while ((f = re.exec(m[2]))) {
        var n = f[2];
        try { n = decodeURIComponent(n); } catch (e) {}
        if (files.indexOf(n) < 0) { files.push(n); urls[n] = decode(f[1]); }
      }
      out.push({ label: text(m[1]), value: files.length ? '' : text(m[2]), files: files, urls: urls });
    }
    return out;
  }

  // Upload questions on the form -> kind. Uniform before project (both say "Pictures").
  var KINDS = [
    { kind: 'application', re: /rank application/i, field: 25 },
    { kind: 'advancement', re: /rank advancement|advancement report/i },
    { kind: 'workbook', re: /workbook/i, field: 26 },
    { kind: 'statement', re: /statement/i, field: 63 },
    { kind: 'uniform', re: /uniform/i },
    { kind: 'project', re: /project pictures|pictures|photos/i, field: 15 }
  ];
  function kindOfLabel(label) { var k = KINDS.filter(function (x) { return x.re.test(str(label)); })[0]; return k ? k.kind : ''; }
  function fieldOf(fileName) { var m = /^f-\d+-(\d+)-\d+_/.exec(str(fileName)); return m ? +m[1] : null; }
  function kindOfField(n) { var k = KINDS.filter(function (x) { return x.field === n; })[0]; return k ? k.kind : ''; }
  /** "f-1608-25-21225499_boxQLzGb_Avatar.jpg" -> "Avatar.jpg" */
  function originalName(fileName) { return str(fileName).replace(/^f-\d+-\d+-\d+_[A-Za-z0-9]+_/, ''); }
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(str(name)); return m ? m[1].toLowerCase() : ''; }

  function UNIT_LETTER(type) { var t = str(type).toLowerCase(); return /troop/.test(t) ? 'T' : /crew/.test(t) ? 'C' : /ship/.test(t) ? 'S' : /pack/.test(t) ? 'P' : ''; }

  /**
   * html: the email's HTML body. -> {ref, first, middle, last, certName, unit ('T9999'), scoutEmail, parentEmail,
   * projectName, uploads: [{label, kind, files}], values: {label: text}}
   */
  function parse(html) {
    var rs = rows(html), v = {};
    rs.forEach(function (r) { if (!(r.label in v)) v[r.label] = r.value; });
    var get = function (re) { var k = Object.keys(v).filter(function (x) { return re.test(x); })[0]; return k ? v[k] : ''; };
    var unitNo = get(/^unit\s*#/i).replace(/\D+/g, '');
    return {
      ref: get(/^reference/i), first: get(/applicant first name/i), middle: get(/applicant middle name/i), last: get(/applicant last name/i),
      certName: get(/printed on certificate/i), unit: unitNo ? UNIT_LETTER(get(/^unit type/i)) + unitNo : '',
      scoutEmail: get(/^eagle applicant email/i).toLowerCase(), parentEmail: get(/parent.*email/i).toLowerCase(),
      projectName: get(/eagle project name/i),
      uploads: rs.filter(function (r) { return r.files.length; }).map(function (r) {
        return { label: r.label, kind: kindOfLabel(r.label) || kindOfField(fieldOf(r.files[0])) || 'other', files: r.files, urls: r.urls };
      }),
      values: v
    };
  }

  function norm(v) { return str(v).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function words(v) { var w = norm(v).split(' ').filter(Boolean); return w; }
  function mails(v) { return str(v).toLowerCase().split(/[\s,;]+/).filter(function (x) { return /@/.test(x); }); }

  /**
   * Which tracking record is this? Best effort (Jim W., 2026-11-03), graded:
   *   close: true  = same first AND last name (middle names ignored on both sides) in the same unit -> "Matched"
   *   close: false = anything looser -> "Check" (the digest lists it until a member ticks Checked):
   *     the schedule sheet's name matching (short forms, certificate name), or no unit on the form;
   *     same unit + same last name (one Scout); same unit + same first name (one Scout);
   *     the Scout's email (one record); the parent's email + same last name (one record).
   * records: [{recordId, scout_name, unit, scout_email, parent_email}]
   * -> {recordId, close, how} | {error}
   */
  function matchRecord(records, p, codeFn) {
    var recs = (records || []).filter(function (r) { return str(r.scout_name); });
    var first = words(p.first)[0] || '', last = words(p.last).slice(-1)[0] || '';
    // First names a record answers to: its own + each Preferred Name's first word (2026-11-04: Theodore / Teddy).
    var firsts = function (r) {
      return [words(r.scout_name)[0]].concat(str(r.preferred_name).split(';').map(function (x) { return words(x)[0]; })).filter(Boolean);
    };
    var inUnit = function (r) {
      if (!str(p.unit) || !codeFn) return false;
      var want = codeFn(p.unit);
      return [codeFn(r.unit)].concat(String(r.unit || '').split(/[\s,;\/&+]+/).map(codeFn)).filter(Boolean).indexOf(want) >= 0;
    };
    var one = function (list) { return list.length === 1 ? list[0] : null; };
    // 1. close: first + last name, same unit
    var hit = one(recs.filter(function (r) { var w = words(r.scout_name); return inUnit(r) && firsts(r).indexOf(first) >= 0 && w[w.length - 1] === last; }));
    if (hit) return { recordId: hit.recordId, close: true, how: 'name + unit' };
    // 2. the schedule sheet's matching (full name, first + last, certificate name; short forms)
    var names = [[p.first, p.middle, p.last].filter(str).join(' '), [p.first, p.last].filter(str).join(' '), p.certName]
      .map(str).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
    var errs = [];
    for (var i = 0; i < names.length; i++) {
      var m = B().matchScout(recs, names[i], p.unit, codeFn);
      if (m.recordId) return { recordId: m.recordId, close: false, how: 'similar name "' + names[i] + '"' + (str(p.unit) ? ' + unit' : ' (no unit on the form)') };
      errs.push(m.error);
    }
    // 3. looser: unit + last name, unit + first name
    hit = last && one(recs.filter(function (r) { var w = words(r.scout_name); return inUnit(r) && w[w.length - 1] === last; }));
    if (hit) return { recordId: hit.recordId, close: false, how: 'same last name + unit' };
    hit = first && one(recs.filter(function (r) { return inUnit(r) && firsts(r).indexOf(first) >= 0; }));
    if (hit) return { recordId: hit.recordId, close: false, how: 'same first name + unit' };
    // 4. emails
    var se = mails(p.scoutEmail)[0];
    hit = se && one(recs.filter(function (r) { return mails(r.scout_email).indexOf(se) >= 0; }));
    if (hit) return { recordId: hit.recordId, close: false, how: 'the Scout\'s email' };
    var pe = mails(p.parentEmail)[0];
    hit = pe && last && one(recs.filter(function (r) { var w = words(r.scout_name); return mails(r.parent_email).indexOf(pe) >= 0 && w[w.length - 1] === last; }));
    if (hit) return { recordId: hit.recordId, close: false, how: 'the parent\'s email + last name' };
    // The most useful reason: "on the tracking tab, but not in unit …" / "2 Scouts are named …" over "No Scout named …".
    return { error: errs.filter(function (e) { return !/^No Scout named/.test(e); })[0] || errs[0] || 'No name on the form.' };
  }

  // Council Applications tab: one row per Formsite email (the digest lists "Check" / "No match" rows until Checked).
  var TAB = 'Council Applications';
  var HEADERS = ['Received', 'Ref', 'Name on form', 'Unit on form', 'Match', 'Scout', 'Record ID', 'How', 'Files', 'Not attached', 'Folder', 'Email', 'Checked', 'Stage'];

  /**
   * Dashboard (Jim W., 2026-11-04): a red "Formsite" tag on a Scout's row while a Check / Stage? row of theirs on the
   * Council Applications tab is not Checked (a lookup on that tab, no tracking column; ticking Checked clears it).
   * -> {recordId: {why (hover text), folder}} (the newest when there are several)
   */
  function flags(rows, fmtDate) {
    var out = {};
    toCheck(rows, fmtDate).forEach(function (x) {
      if (!x.recordId) return;                                   // No match: no row to tag (digest only)
      out[x.recordId] = { why: 'Formsite application' + (x.when ? ' ' + x.when : '') + ': ' + x.why, folder: x.folder };
    });
    return out;
  }

  /**
   * What happens to the row (Jim W., 2026-11-04): ONLY a close match whose Scout is in Proposal Approved is promoted to
   * Application Submitted (the "Application submitted…" row action, date = the email's). Everything else stays where
   * it is and is flagged (digest until Checked):
   *   Match 'Matched'  close match, promoted                     (Checked ticked)
   *   Match 'Stage?'   close match, but the Scout is in another stage: not moved
   *   Match 'Check'    loose match: not moved
   * hit: matchRecord() result; section: the Scout's stage key. -> {match, promote}
   */
  function decide(hit, section) {
    if (!hit || !hit.recordId) return { match: 'No match', promote: false };
    if (!hit.close) return { match: 'Check', promote: false };
    return section === 'proposal_approved' ? { match: 'Matched', promote: true } : { match: 'Stage?', promote: false };
  }
  function checked(v) { return v === true || (v !== false && str(v) !== '' && str(v).toUpperCase() !== 'FALSE'); }
  /** Rows the committee still has to look at -> [{title, why, ms, recordId, folder}] oldest first. fmtDate(Date) -> "11/3". */
  function toCheck(rows, fmtDate) {
    return (rows || []).filter(function (r) { return str(r['Match']) && r['Match'] !== 'Matched' && !checked(r['Checked']); })
      .map(function (r) {
        var d = r['Received'] instanceof Date ? r['Received'] : new Date(r['Received']);
        var form = str(r['Name on form']) + (str(r['Unit on form']) ? ' (' + str(r['Unit on form']) + ')' : '');
        return { ms: d.getTime() || 0, recordId: str(r['Record ID']), folder: str(r['Folder']), when: isNaN(d) ? '' : fmtDate(d),
          title: form + ', #' + str(r['Ref']) + (isNaN(d) ? '' : ', ' + fmtDate(d)),
          why: r['Match'] === 'No match' ? 'no matching Scout: files in ' + str(r['Folder'])
            : r['Match'] === 'Stage?' ? 'filed for ' + str(r['Scout']) + ', but they are in ' + (str(r['Stage']) || 'another stage') +
              ' (not Proposal Approved): row not moved to Application Submitted'
            : 'filed for ' + str(r['Scout']) + ' by ' + str(r['How']) + ': is that right? (row not moved)' };
      }).sort(function (a, b) { return a.ms - b.ms; });
  }

  var TAG = { application: 'RankApplication', advancement: 'AdvancementReport', workbook: 'Workbook',
    statement: 'Statement', project: 'ProjectPhoto', uniform: 'UniformPhoto', other: 'File' };
  var NUMBERED = ['project', 'uniform', 'other'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * A fetched link is the file only when Formsite answered 200 with something that is not a web page (a login or
   * error page is HTML). -> '' (OK) or why not.
   */
  function fetchProblem(code, contentType, bytes) {
    if (code !== 200) return 'Formsite answered ' + code;
    if (/text\/html/i.test(str(contentType))) return 'Formsite sent a web page (a login?) instead of the file';
    if (!bytes) return 'empty file';
    return '';
  }

  /**
   * File names for the attachments: <Name>-<Unit>-Application_<Tag>.<ext> ("Scout_Name-T251-Application_Workbook.pdf");
   * photos numbered (_ProjectPhoto-01.jpg); a second file for a one-file question gets -2.
   * attachmentNames: names of the email's attachments. -> {files: [{index, name, kind, label}], links: [{url, name, kind,
   * label, original}] (linked, not attached: Formsite sends links instead of attachments when the files are big;
   * fetched from the link, Jim W. 2026-11-09), missing: [labels of linked files with no link to fetch],
   * extra: [attachment indexes no question names]}
   */
  function plan(p, attachmentNames, scoutName, unit, namePart, unitPart) {
    var base = namePart(scoutName) + '-' + unitPart(unit) + '-Application';
    var att = (attachmentNames || []).map(str), used = {}, count = {}, files = [], missing = [], links = [];
    var nameFor = function (kind, fileName) {
      var n = count[kind] = (count[kind] || 0) + 1;
      var tag = TAG[kind] + (NUMBERED.indexOf(kind) >= 0 ? '-' + pad(n) : n > 1 ? '-' + n : '');
      return base + '_' + tag + '.' + (extOf(fileName) || 'pdf');
    };
    var add = function (i, kind, label) {
      used[i] = true;
      files.push({ index: i, name: nameFor(kind, att[i]), kind: kind, label: label });
    };
    (p.uploads || []).forEach(function (u) {
      u.files.forEach(function (fname) {
        var i = att.indexOf(fname);
        if (i < 0) { var o = originalName(fname); i = att.indexOf(o); if (used[i]) i = -1; }
        if (i < 0 || used[i]) {
          var url = u.urls && u.urls[fname];
          if (url) links.push({ url: url, name: nameFor(u.kind, fname), kind: u.kind, label: u.label, original: originalName(fname) });
          else missing.push(u.label + ': ' + originalName(fname));
          return;
        }
        add(i, u.kind, u.label);
      });
    });
    var extra = [];
    att.forEach(function (n, i) { if (!used[i]) { extra.push(i); add(i, kindOfField(fieldOf(n)) || 'other', ''); } });
    return { files: files, links: links, missing: missing, extra: extra, emailName: base + '_FormsiteEmail.pdf' };
  }

  var SUBMITTED = /-Application_[A-Za-z]+(-\d+)?\.[A-Za-z0-9]+$/;
  /** A file this feature filed (an earlier submission: goes to Archive/ when a new one arrives). */
  function isSubmittedName(name) { return SUBMITTED.test(str(name)); }

  /** A resubmission: the earlier submission's files at the top (ids) go to Archive/. top: [{id, name}] */
  function toArchive(top) {
    return (top || []).filter(function (f) { return isSubmittedName(f.name); }).map(function (f) { return f.id; });
  }

  var DROP_ROWS = /^(IP|Browser|Device|Referrer)$/i;
  /** The email body for the PDF: no Formsite images (may need a login), no IP/browser rows, with a heading. */
  function emailHtml(html, heading) {
    var body = String(html || '').replace(/<img\b[^>]*>/gi, '').replace(/\[image:[^\]]*\]/g, '')
      .replace(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<\/tr>/gi, function (row, th) { return DROP_ROWS.test(text(th)) ? '' : row; });
    return '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11px}th{width:35%}' +
      'th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}</style></head><body>' +
      '<h2 style="font-size:14px">' + str(heading).replace(/</g, '&lt;') + '</h2>' + body + '</body></html>';
  }

  return { FROM: FROM, SUBJECT_PREFIX: SUBJECT_PREFIX, QUERY: QUERY, isMatch: isMatch, rows: rows,
    parse: parse, matchRecord: matchRecord, plan: plan, fetchProblem: fetchProblem, isSubmittedName: isSubmittedName, toArchive: toArchive, TAB: TAB, HEADERS: HEADERS, toCheck: toCheck, decide: decide, flags: flags, emailHtml: emailHtml,
    originalName: originalName, fieldOf: fieldOf };
})();

if (typeof module !== 'undefined') module.exports = CouncilApp;
