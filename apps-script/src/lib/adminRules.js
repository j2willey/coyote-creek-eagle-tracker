/**
 * AdminRules: the committee Admin page (Jim W., 2026-10-24; every committee member can see it for now). Pure.
 *  - Intake exceptions: web submissions that need a person (never confirmed, possible duplicate, error, stuck).
 *  - Eagle archive: each January the past year's Eagles move from the tracking tab to "CC Eagles <year>".
 */
var AdminRules = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var HOUR = 3600 * 1000;
  function ms(v) { return v instanceof Date ? v.getTime() : (Date.parse(str(v)) || 0); }

  /** Which submissions need a person, and what can be done with each. queue: Intake Queue rows. */
  function intakeExceptions(queue, nowMs) {
    var out = [];
    (queue || []).forEach(function (q) {
      var st = str(q['Status']), sub = ms(q['Submitted']);
      var acts = null, why = '';
      if (st === 'Unconfirmed') {
        acts = ['resend', 'spam'];
        why = ms(q['_confirm_expires']) && ms(q['_confirm_expires']) < nowMs ? 'Confirmation link expired: never clicked' : 'Waiting for the family to click the confirmation link';
      } else if (st === 'Possible duplicate') { acts = ['attach', 'promote', 'spam']; why = 'Matches a Scout already on the tracking tab'; }
      else if (st === 'Error') { acts = ['promote', 'attach', 'spam']; why = 'Adding it to the tracking tab failed'; }
      else if (st === 'Confirmed' && sub && nowMs - sub > HOUR) { acts = ['promote', 'spam']; why = 'Confirmed but not added (stuck)'; }
      else if (st === 'Uploading' && sub && nowMs - sub > 2 * HOUR) { acts = ['spam']; why = 'Upload never finished'; }
      if (!acts) return;
      out.push({ queueId: str(q['Queue ID']), status: st, why: why, scout: str(q['Eagle Candidate']), unit: str(q['Unit']),
        submitted: sub, emails: [str(q['Scout Email']), str(q['Parent/Guardian Email'])].filter(Boolean), note: str(q['Note']),
        files: str(q['Files']), actions: acts });
    });
    return out.sort(function (a, b) { return b.submitted - a.submitted; });
  }

  /**
   * Field-by-field: the tracking row vs a web form (Jim W., 2026-11-04: a duplicate submission's newer details should
   * be easy to accept, field by field). Only fields the form filled. current: record fields; form: queueToClean_();
   * fields: Intake.FIELDS; show(v): cell value as text ('YYYY-MM-DD' for dates). -> [{key, label, sheet, form, differs}]
   */
  function compareRows(current, form, fields, show) {
    return (fields || []).filter(function (f) { return str((form || {})[f.key]); }).map(function (f) {
      var sheet = str(show((current || {})[f.key])), val = str(form[f.key]);
      var same = f.type === 'email' ? sheet.toLowerCase() === val.toLowerCase() : sheet === val;
      return { key: f.key, label: f.label, sheet: sheet, form: val, differs: !same };
    });
  }

  /**
   * Attached duplicate submissions whose form differed and nobody has compared yet (Note has "Differs:" but no
   * "Reviewed"), last 60 days -> [{queueId, scout, unit, submitted, recordId, note}] newest first.
   */
  function toReview(queue, nowMs) {
    return (queue || []).filter(function (q) {
      var sub = ms(q['Submitted']);
      return str(q['Status']) === 'Attached' && /Differs:/.test(str(q['Note'])) && !/Reviewed/.test(str(q['Note'])) &&
        str(q['Record ID']) && (!sub || nowMs - sub < 60 * 24 * HOUR);
    }).map(function (q) {
      return { queueId: str(q['Queue ID']), scout: str(q['Eagle Candidate']), unit: str(q['Unit']), submitted: ms(q['Submitted']),
        recordId: str(q['Record ID']), note: str(q['Note']) };
    }).sort(function (a, b) { return b.submitted - a.submitted; });
  }

  /** Eagles per EBoR year still on the tracking tab: [{year, count}] oldest first. records: [{section, ebor 'YYYY-MM-DD'}]. */
  function archiveYears(records) {
    var by = {};
    (records || []).forEach(function (r) {
      if (r.section !== 'eagle_earned') return;
      var y = (/^(\d{4})/.exec(str(r.ebor)) || [])[1] || 'no EBoR date';
      by[y] = (by[y] || 0) + 1;
    });
    return Object.keys(by).sort().map(function (y) { return { year: y, count: by[y] }; });
  }

  /** Record IDs to archive for a year. */
  function archiveIds(records, year) {
    return (records || []).filter(function (r) { return r.section === 'eagle_earned' && str(r.ebor).slice(0, 4) === String(year); })
      .map(function (r) { return r.recordId; });
  }

  /**
   * Sheet rows (1-based) to delete so that only `keep` rows remain below the header: contiguous runs, bottom-up.
   * rowCount: last row; firstData: first row below the headers; keepRow(r) -> true to keep.
   */
  function deleteRuns(rowCount, firstData, keepRow) {
    var runs = [], start = -1;
    for (var r = firstData; r <= rowCount; r++) {
      var del = !keepRow(r);
      if (del && start < 0) start = r;
      if ((!del || r === rowCount) && start >= 0) { var end = del ? r : r - 1; runs.push([start, end - start + 1]); start = -1; }
    }
    return runs.reverse();
  }

  return { intakeExceptions: intakeExceptions, archiveYears: archiveYears, archiveIds: archiveIds, deleteRuns: deleteRuns, compareRows: compareRows, toReview: toReview };
})();

if (typeof module !== 'undefined') module.exports = AdminRules;
