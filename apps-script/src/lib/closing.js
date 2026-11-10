/**
 * Closing (Jim W., 2026-11-10): the terminal "Closed" stage for records that will not come back (withdrew, aged out with
 * no extension, extension denied, moved away, duplicate). Visible, reversible, cleared once a year. Pure.
 *
 *   closed section     side section after Proposal Not Approved (key `closed`); status only; the Exceptions tab hides it
 *   _closed            hidden column, JSON {r: reason, d: 'YYYY-MM-DD', by: initials, from: section key, n: note}; Reopen
 *                      reads `from`; cleared on Reopen
 *   _close_snooze      hidden column, 'YYYY-MM-DD': a "Keep open" decision hides the "Close?" suggestion until then
 *   suggestions        humans decide: rows that look terminal get an amber "Close?" tag and a digest line
 *   January archive    Closed rows closed in a past year -> "Closed Records" tab (no contact details) + folder to
 *                      Archive/Closed + row deleted from the tracking tab
 */
var Closing = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }

  var SECTION = 'closed';
  /** Stages a record can be closed from: the Exceptions stages. */
  var FROM_SECTIONS = ['ebor_paused', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved'];
  /** Stages that may be SUGGESTED for closing. Beyond Age is never suggested (it has an approved extension). */
  var REVIEW_SECTIONS = ['proposal_not_approved', 'ebor_paused'];
  var REASONS = ['Withdrew', 'Aged out (no extension)', 'Extension denied', 'Moved out of district', 'Duplicate or error', 'Other'];
  var OTHER = 'Other';
  var DEFAULT_REVIEW_DAYS = 180, DEFAULT_SNOOZE_DAYS = 90;
  var DEFAULT_FOLDER = 'Archive/Closed';
  var COLUMN = '_closed', SNOOZE_COLUMN = '_close_snooze';
  var DAY = 86400000;

  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  function ms(ymd) { var m = YMD.exec(str(ymd)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function isYmd(v) { return !isNaN(ms(v)); }
  function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / DAY); }
  function addDays(ymd, n) {
    var d = new Date(ms(ymd) + n * DAY);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function nice(ymd) { var m = YMD.exec(str(ymd)); return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : str(ymd); }
  function posInt(v, fallback) { var n = Math.floor(Number(v)); return isNaN(n) || n < 1 ? fallback : n; }

  // ---------- the _closed cell ----------

  /** {r, d, by, from, n} -> the JSON cell text ('' when there is no reason). */
  function closedCell(o) {
    if (!o || !str(o.r)) return '';
    return JSON.stringify({ r: str(o.r), d: str(o.d), by: str(o.by), from: str(o.from), n: str(o.n).slice(0, 500) });
  }

  /** Cell text -> {reason, date, by, from, note} or null (empty, or not ours). */
  function parseClosed(cell) {
    try {
      var o = JSON.parse(str(cell) || 'null');
      if (!o || !str(o.r)) return null;
      return { reason: str(o.r), date: isYmd(o.d) ? str(o.d) : '', by: str(o.by), from: str(o.from), note: str(o.n) };
    } catch (e) { return null; }
  }

  /** "Other: moved to a council far away" -> "Other" (the reason as counted in Stats). */
  function reasonKey(reason) {
    var r = str(reason), head = r.split(':')[0].trim();
    var hit = REASONS.filter(function (x) { return x.toLowerCase() === head.toLowerCase(); })[0];
    return hit || (r ? OTHER : '');
  }

  // ---------- Close record… ----------

  /**
   * input: {section, reason (one of REASONS), reasonText (for Other), date, today, note, by}
   * -> {errors, closed: {r, d, by, from, n}} (closed = the _closed cell content).
   */
  function closePlan(input) {
    var errors = [], reason = str(input.reason), text = str(input.reasonText).replace(/\s+/g, ' ');
    if (FROM_SECTIONS.indexOf(input.section) < 0) errors.push('This record is no longer at a stage that can be closed. Reload the page.');
    var hit = REASONS.filter(function (x) { return x.toLowerCase() === reason.toLowerCase(); })[0];
    if (!hit) errors.push('Pick the reason.');
    else if (hit === OTHER && text.length < 3) errors.push('Say what the reason is (Other).');
    var d = str(input.date);
    if (!isYmd(d)) errors.push('Pick the date.');
    else if (input.today && d > str(input.today)) errors.push('The date can\'t be in the future.');
    if (errors.length) return { errors: errors, closed: null };
    return { errors: [], closed: { r: hit === OTHER ? OTHER + ': ' + text : hit, d: d, by: str(input.by), from: input.section,
      n: str(input.note).replace(/\s+/g, ' ') } };
  }

  /** "11/10 [JW] Closed: Withdrew (the family moved)" */
  function closeLine(shortDate, by, reason, note) {
    var n = str(note).replace(/\s+/g, ' ');
    return shortDate + ' [' + (str(by) || 'committee') + '] Closed: ' + str(reason) + (n ? ' (' + n + ')' : '');
  }

  // ---------- Reopen… ----------

  /**
   * input: {closed (parseClosed result or null), to (chosen section key or ''), reason, sectionKeys}
   * -> {errors, to}. No `to`: back to where it came from.
   */
  function reopenPlan(input) {
    var errors = [], keys = input.sectionKeys || [];
    var to = str(input.to) || (input.closed && input.closed.from) || '';
    if (!to) errors.push('This record has no stage to go back to (it was moved to Closed by hand). Pick the stage.');
    else if (to === SECTION) errors.push('Pick a stage other than Closed.');
    else if (keys.length && keys.indexOf(to) < 0) errors.push('That stage is not on the tracking tab.');
    if (str(input.reason).length < 3) errors.push('Say why the record is being reopened (it goes into the log).');
    return { errors: errors, to: errors.length ? null : to };
  }

  /** "11/10 [JW] Reopened to Proposal Not Approved: new project coming" */
  function reopenLine(shortDate, by, toLabel, reason) {
    return shortDate + ' [' + (str(by) || 'committee') + '] Reopened to ' + str(toLabel) + ': ' + str(reason).replace(/\s+/g, ' ');
  }

  // ---------- review suggestions (a person decides) ----------

  /** Whole years of age at a date; null when either date is missing. */
  function ageYears(birthYmd, atYmd) {
    var b = YMD.exec(str(birthYmd)), a = YMD.exec(str(atYmd));
    if (!b || !a) return null;
    var years = +a[1] - +b[1];
    if (+a[2] < +b[2] || (+a[2] === +b[2] && +a[3] < +b[3])) years--;
    return years;
  }

  /** "proposal_not_approved 2026-05-01" (_stage_since) -> '2026-05-01' while the row is still in that stage, else ''. */
  function stageSinceDate(cell, section) {
    var m = /^(\S+)\s+(\d{4}-\d\d-\d\d)$/.exec(str(cell));
    return m && m[1] === section ? m[2] : '';
  }

  /**
   * Does this record look terminal? -> the reason to show ('' = no suggestion).
   *   rec: {section, birth ('YYYY-MM-DD'), lastActivity (newest log line / update, 'YYYY-MM-DD' or ''),
   *         stageSince (date it reached the stage or ''), snoozeUntil ('YYYY-MM-DD' or '')}
   *   opts: {today, reviewDays (Settings closeReviewDays, default 180)}
   * Only Proposal Not Approved and EBoR Paused; Beyond Age is never suggested (it has an approved extension).
   * Age 18 or older, or no log line or update for reviewDays (counted from the later of the last activity and the
   * day it reached the stage). "Keep open" hides it until snoozeUntil.
   */
  function suggest(rec, opts) {
    opts = opts || {};
    var today = str(opts.today);
    if (REVIEW_SECTIONS.indexOf(rec.section) < 0 || !isYmd(today)) return '';
    if (isYmd(rec.snoozeUntil) && str(rec.snoozeUntil) > today) return '';
    var age = ageYears(rec.birth, today);
    if (age !== null && age >= 18) return 'Age ' + age + ': 18 or older';
    var days = posInt(opts.reviewDays, DEFAULT_REVIEW_DAYS);
    var last = [str(rec.lastActivity), str(rec.stageSince)].filter(isYmd).sort().pop();
    if (last) {
      var idle = daysBetween(last, today);
      if (idle >= days) return 'No log line or update in ' + idle + ' days';
    }
    return '';
  }

  /** records [rec...] with recordId -> [{recordId, why}] for the ones that look terminal. */
  function suggestions(records, opts) {
    var out = [];
    (records || []).forEach(function (r) {
      var why = suggest(r, opts);
      if (why) out.push({ recordId: r.recordId, why: why });
    });
    return out;
  }

  // ---------- January archive ----------

  var ARCHIVE_TAB = 'Closed Records';
  /** The "Closed Records" tab. No contact details on purpose (no emails, phones, birth date, address, BSA ID): minors'
   *  records kept long-term; the Scout's folder holds the paperwork. */
  var ARCHIVE_HEADERS = ['Record ID', 'Scout', 'Unit', 'Closed', 'Reason', 'Note', 'Closed by', 'Stage before closing',
    'Proposal approved', 'EBoR date', 'Folder', 'Archived on'];

  /** Settings closedFolder ("Archive/Closed") -> ['Archive', 'Closed'] (under the Scouts folder); blank = the default. */
  function folderPath(setting) {
    var parts = str(setting).split(/[\/\\]+/).map(str).filter(Boolean);
    return parts.length ? parts : DEFAULT_FOLDER.split('/');
  }

  /**
   * Closed rows closed in a PAST year (those are cleared each January); a row with no closed date (moved to Closed by
   * hand) is never archived, only counted. records: [{recordId, section, scout_name, unit, closed (parseClosed)}].
   * -> {ids, rows: [{recordId, name, unit, closed ('YYYY-MM-DD'), reason}] oldest first, noDate, years: [{year, count}]}
   */
  function archiveCandidates(records, thisYear) {
    var rows = [], noDate = 0;
    (records || []).forEach(function (r) {
      if (r.section !== SECTION || !str(r.scout_name)) return;
      var d = r.closed && r.closed.date;
      if (!d) { noDate++; return; }
      if (Number(d.slice(0, 4)) < Number(thisYear)) {
        rows.push({ recordId: r.recordId, name: str(r.scout_name), unit: str(r.unit), closed: d, reason: r.closed.reason });
      }
    });
    rows.sort(function (a, b) { return a.closed < b.closed ? -1 : a.closed > b.closed ? 1 : a.name.localeCompare(b.name); });
    var by = {};
    rows.forEach(function (x) { var y = x.closed.slice(0, 4); by[y] = (by[y] || 0) + 1; });
    return { ids: rows.map(function (x) { return x.recordId; }), rows: rows, noDate: noDate,
      years: Object.keys(by).sort().map(function (y) { return { year: y, count: by[y] }; }) };
  }

  /**
   * One row of the Closed Records tab, keyed by ARCHIVE_HEADERS.
   * rec: {recordId, scout_name, unit, closed (parseClosed), approved, ebor ('YYYY-MM-DD' or ''), folderId}
   * ctx: {stageLabel(sectionKey), archivedOn ('YYYY-MM-DD')}. Takes only these fields: nothing else can leak in.
   */
  function archiveRow(rec, ctx) {
    var c = rec.closed || {};
    var o = {};
    o['Record ID'] = str(rec.recordId);
    o['Scout'] = str(rec.scout_name);
    o['Unit'] = str(rec.unit);
    o['Closed'] = str(c.date);
    o['Reason'] = str(c.reason);
    o['Note'] = str(c.note);
    o['Closed by'] = str(c.by);
    o['Stage before closing'] = c.from ? str((ctx && ctx.stageLabel ? ctx.stageLabel(c.from) : '') || c.from) : '';
    o['Proposal approved'] = str(rec.approved);
    o['EBoR date'] = str(rec.ebor);
    o['Folder'] = str(rec.folderId) ? 'https://drive.google.com/drive/folders/' + str(rec.folderId) : '';
    o['Archived on'] = str(ctx && ctx.archivedOn);
    return o;
  }

  // ---------- Stats ----------

  /**
   * Closures in a year by reason, from the Closed rows still on the tracking tab (a year's rows stay until the next
   * January). records: [{section, closed}]. -> {year, total, byReason: [{reason, count}] biggest first, reasons: text}
   */
  function closuresByReason(records, year) {
    var by = {}, total = 0;
    (records || []).forEach(function (r) {
      if (r.section !== SECTION || !r.closed || str(r.closed.date).slice(0, 4) !== String(year)) return;
      var k = reasonKey(r.closed.reason);
      if (!k) return;
      by[k] = (by[k] || 0) + 1; total++;
    });
    var list = Object.keys(by).map(function (k) { return { reason: k, count: by[k] }; })
      .sort(function (a, b) { return b.count - a.count || REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason); });
    return { year: String(year), total: total, byReason: list, reasons: list.map(function (x) { return x.reason + ' ' + x.count; }).join('; ') };
  }

  return { SECTION: SECTION, FROM_SECTIONS: FROM_SECTIONS, REVIEW_SECTIONS: REVIEW_SECTIONS, REASONS: REASONS, OTHER: OTHER,
    DEFAULT_REVIEW_DAYS: DEFAULT_REVIEW_DAYS, DEFAULT_SNOOZE_DAYS: DEFAULT_SNOOZE_DAYS, DEFAULT_FOLDER: DEFAULT_FOLDER,
    COLUMN: COLUMN, SNOOZE_COLUMN: SNOOZE_COLUMN,
    closedCell: closedCell, parseClosed: parseClosed, reasonKey: reasonKey, closePlan: closePlan, closeLine: closeLine,
    reopenPlan: reopenPlan, reopenLine: reopenLine, ageYears: ageYears, stageSinceDate: stageSinceDate,
    suggest: suggest, suggestions: suggestions,
    ARCHIVE_TAB: ARCHIVE_TAB, ARCHIVE_HEADERS: ARCHIVE_HEADERS, folderPath: folderPath, archiveCandidates: archiveCandidates,
    archiveRow: archiveRow, closuresByReason: closuresByReason,
    _util: { isYmd: isYmd, daysBetween: daysBetween, addDays: addDays, nice: nice, posInt: posInt, str: str }
  };
})();

if (typeof module !== 'undefined') module.exports = Closing;
