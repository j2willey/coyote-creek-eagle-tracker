/**
 * Committee member adds files for a Scout (Jim W., 2026-11-09): a Scout emailed their Proposal instead of
 * uploading it, and on staging to test without signing in as the Scout. Dashboard → Scout detail → "Add files…".
 * Same path as a Scout Update (attachFiles_): standard name, next version, older versions to Archive, "New files"
 * raised. Logged as "[JW] Files added for the Scout: …". No receipt email to the family.
 *
 * Router actions (committee members only):
 *   committeeUploadStart  {session, recordId, note}          -> {uploadToken, tags}
 *   committeeUploadFile   {uploadToken, name, tag, data}     -> {stored}
 *   committeeUploadFinish {session, uploadToken}             -> {message, files}
 */
function actionCommitteeUploadStart_(req) {
  var c = committeeMe_(req.session);
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var token = Identity.makeToken(Utilities.getUuid);
  var batchId = Intake.makeQueueId(null, [], new Date()).replace(/^Q-/, 'C-');
  CacheService.getScriptCache().put('cu:' + token, JSON.stringify({
    recordId: rec.recordId, by: c.me.initials || c.email, email: c.email, batchId: batchId,
    note: String(req.note || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }), UPDATE_TOKEN_SECONDS);
  return { uploadToken: token, tags: Intake.TAGS };
}

function committeeUploadContext_(token) {
  if (!Identity.isTokenShape(token)) throw userError_('Upload session not valid. Please start again.');
  var raw = CacheService.getScriptCache().get('cu:' + token);
  if (!raw) throw userError_('Upload session expired. Please start again.');
  return JSON.parse(raw);
}

function actionCommitteeUploadFile_(req) {
  var ctx = committeeUploadContext_(req.uploadToken);
  if (Intake.TAGS.indexOf(String(req.tag || '')) < 0) throw userError_('Pick what the file is (ESSPP, Photo, …).');
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  storeUpload_(ctx.batchId, rec.fields.scout_name, rec.fields.unit, ctx.recordId, req);
  return { stored: String(req.name || '') };
}

function actionCommitteeUploadFinish_(req) {
  var c = committeeMe_(req.session);
  var ctx = committeeUploadContext_(req.uploadToken);
  var rec = Records.get(ctx.recordId);
  if (!rec) throw userError_('Record not found.');
  var uploads = uploadsFor_(ctx.batchId);
  if (!uploads.length) throw userError_('Add a file first.');
  var res = attachFiles_(rec, uploads);
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + (c.me.initials || c.email) + '] Files added for the Scout: ' +
    res.names.join(', ') + (ctx.note ? '. Note: ' + ctx.note : ''));
  CacheService.getScriptCache().remove('cu:' + req.uploadToken);
  return { message: 'Filed in ' + rec.fields.scout_name + '\'s folder: ' + res.names.join(', ') + '. The row shows New files until someone acts on it.',
    files: res.names };
}
