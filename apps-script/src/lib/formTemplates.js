/**
 * FormTemplates (Task 14a, Jim W., 2026-11-11): the ONE Drive folder of reusable files for the Sign Workshop and the
 * EBoR paperwork page: the stamp PNGs and the blank forms (Advancement Report 34403, blank Eagle Application for the
 * demo). Pure: Settings -> which folder, file list -> which file. No form or stamp image lives in the repo.
 *
 * Settings `formTemplatesFolderId`; when blank the older `stampsFolderId` is used (same folder, renamed in Drive).
 */
var FormTemplates = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function isPdf(f) { return /\.pdf$/i.test(str(f && f.name)) || /pdf/i.test(str(f && f.mime)); }
  function newestFirst(a, b) {
    return (Number(b.modified) || 0) - (Number(a.modified) || 0) || (str(a.name).toLowerCase() < str(b.name).toLowerCase() ? -1 : 1);
  }
  function pick(files, test) {
    return (files || []).filter(function (f) { return f && str(f.id) && isPdf(f) && test(str(f.name)); }).sort(newestFirst)[0] || null;
  }

  /** The Form Templates folder id: formTemplatesFolderId, else stampsFolderId, else ''. */
  function folderId(settings) {
    var s = settings || {};
    return str(s.formTemplatesFolderId) || str(s.stampsFolderId);
  }

  /** Setup / repair: true when the old key holds a folder and the new one is blank (copy it across once; the old key stays). */
  function needsCopy(settings) {
    var s = settings || {};
    return !str(s.formTemplatesFolderId) && !!str(s.stampsFolderId);
  }

  /** The blank Advancement Report: the PDF whose name contains "34403" or "Advancement"; newest wins. files: [{id, name, mime, modified}] */
  function pickReport(files) {
    return pick(files, function (n) { return /34403|advancement/i.test(n); });
  }

  /** The blank Eagle Application (demo only): the PDF whose name contains "Eagle Application" and not "Verified"; newest wins. */
  function pickApplication(files) {
    return pick(files, function (n) { return /eagle application/i.test(n) && !/verified/i.test(n); });
  }

  return { folderId: folderId, needsCopy: needsCopy, pickReport: pickReport, pickApplication: pickApplication };
})();

if (typeof module !== 'undefined') module.exports = FormTemplates;
