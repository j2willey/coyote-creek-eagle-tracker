/**
 * Form Templates folder access (Task 14a): Settings → formTemplatesFolderId (else the older stampsFolderId). Holds the
 * stamp PNGs and the blank forms. Rules in lib/formTemplates.js.
 */

/** The folder, or null when no id is set. Throws a user error when it can't be opened. */
function formTemplatesFolder_() {
  var id = FormTemplates.folderId(getSettings_());
  if (!id) return null;
  try { return DriveApp.getFolderById(id); }
  catch (e) { throw userError_('The Form Templates folder could not be opened. Check the formTemplatesFolderId setting (or the older stampsFolderId) and that the tool\'s account can see that folder.'); }
}

/** Top-level files of the folder: [{id, name, mime, bytes, modified (ms)}]; [] when no folder is set. */
function formTemplateFiles_() {
  var folder = formTemplatesFolder_();
  return listFolder_(folder).map(function (x) {
    return { id: String(x.id), name: String(x.name || ''), mime: String(x.file.getMimeType() || ''), bytes: Number(x.file.getSize()) || 0,
      modified: x.file.getLastUpdated().getTime() };
  });
}

/** The blank Advancement Report: Settings → advancementReportTemplateId when set, else the PDF in Form Templates. -> {id, name} or null */
function reportTemplateRef_() {
  var id = String(getSettings_().advancementReportTemplateId || '').trim();
  if (id) return { id: id, name: '' };
  var hit = FormTemplates.pickReport(formTemplateFiles_());
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Setup / repair: copy the old stampsFolderId into formTemplatesFolderId once (the old key stays). -> true when copied */
function copyFormTemplatesKey_() {
  var s = getSettings_();
  if (!FormTemplates.needsCopy(s)) return false;
  setSetting_('formTemplatesFolderId', String(s.stampsFolderId).trim());
  return true;
}
