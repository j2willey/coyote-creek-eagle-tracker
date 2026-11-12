/**
 * JSON endpoint for the Firebase-hosted pages.
 *
 * Pages POST a text/plain body (avoids the CORS preflight Apps Script
 * can't answer): {"action": "...", ...}. Response is JSON:
 *   { ok: true, ... } or { ok: false, error: "..." }
 *
 * Actions are added milestone by milestone (M2 identity, M3 intake, ...).
 */
var API_VERSION = '0.65.1';

var ACTIONS_ = {
  ping: function (req) {
    var s = getSettings_();
    return { pong: true, version: API_VERSION, testMode: s.testMode !== false, time: new Date().toISOString() };
  },
  // M2 sign-in (auth.js). Wrapped so other files' functions are looked up at call time, not load time.
  requestLink: function (req) { return actionRequestLink_(req); },
  redeemLink: function (req) { return actionRedeemLink_(req); },
  freshLink: function (req) { return actionFreshLink_(req); },
  redeemCode: function (req) { return actionRedeemCode_(req); },
  whoami: function (req) { return actionWhoami_(req); },
  signOut: function (req) { return actionSignOut_(req); },
  // M3 intake (intakeQueue.js)
  startIntake: function (req) { return actionStartIntake_(req); },
  submitIntake: function (req) { return actionSubmitIntake_(req); },
  uploadIntakeFile: function (req) { return actionUploadIntakeFile_(req); },
  finishIntake: function (req) { return actionFinishIntake_(req); },
  confirmIntake: function (req) { return actionConfirmIntake_(req); },
  // M7 Scout Update (scoutUpdate.js)
  myRecord: function (req) { return actionMyRecord_(req); },
  startUpdate: function (req) { return actionStartUpdate_(req); },
  uploadUpdateFile: function (req) { return actionUploadUpdateFile_(req); },
  finishUpdate: function (req) { return actionFinishUpdate_(req); },
  // M5 booking (bookingActions.js)
  slots: function (req) { return actionSlots_(req); },
  book: function (req) { return actionBook_(req); },
  cancelBooking: function (req) { return actionCancelBooking_(req); },
  changeBooking: function (req) { return actionChangeBooking_(req); },
  // EBoR: Unit Contacts (unitActions.js)
  unitEbors: function (req) { return actionUnitEbors_(req); },
  saveBoard: function (req) { return actionSaveBoard_(req); },
  unitCalendar: function (req) { return actionUnitCalendar_(req); },
  saveCc: function (req) { return actionSaveCc_(req); },
  // Committee schedule page (committeeActions.js)
  committeeSchedule: function (req) { return actionCommitteeSchedule_(req); },
  saveSlot: function (req) { return actionSaveSlot_(req); },
  saveSlots: function (req) { return actionSaveSlots_(req); },
  openTimesChoices: function (req) { return actionOpenTimesChoices_(req); },
  openTimesDraft: function (req) { return actionOpenTimesDraft_(req); },
  deleteSlot: function (req) { return actionDeleteSlot_(req); },
  saveReps: function (req) { return actionSaveReps_(req); },
  cancelSlotBooking: function (req) { return actionCancelSlotBooking_(req); },
  // Outbox (outboxActions.js)
  outboxList: function (req) { return actionOutboxList_(req); },
  outboxSend: function (req) { return actionOutboxSend_(req); },
  outboxSentByMe: function (req) { return actionOutboxSentByMe_(req); },
  outboxDiscard: function (req) { return actionOutboxDiscard_(req); },
  outboxAttachment: function (req) { return actionOutboxAttachment_(req); },
  outboxAttach: function (req) { return actionOutboxAttach_(req); },
  outboxDetach: function (req) { return actionOutboxDetach_(req); },
  outboxSchedule: function (req) { return actionOutboxSchedule_(req); },
  outboxUnschedule: function (req) { return actionOutboxUnschedule_(req); },
  // Committee dashboard + Review outcome (reviewActions.js)
  committeeHome: function (req) { return actionCommitteeHome_(req); },
  reviewChoices: function (req) { return actionReviewChoices_(req); },
  reviewStart: function (req) { return actionReviewStart_(req); },
  uploadReviewFile: function (req) { return actionUploadReviewFile_(req); },
  reviewFinish: function (req) { return actionReviewFinish_(req); },
  signStart: function (req) { return actionSignStart_(req); },
  committeeUploadStart: function (req) { return actionCommitteeUploadStart_(req); },
  committeeUploadFile: function (req) { return actionCommitteeUploadFile_(req); },
  committeeUploadFinish: function (req) { return actionCommitteeUploadFinish_(req); },
  scoutReviewFiles: function (req) { return actionScoutReviewFiles_(req); },
  fetchScoutFile: function (req) { return actionFetchScoutFile_(req); },
  // Sign Workshop stamps (stampActions.js)
  stampList: function (req) { return actionStampList_(req); },
  stampFetch: function (req) { return actionStampFetch_(req); },
  // Dashboard row actions (rowActions.js)
  rowAction: function (req) { return actionRowAction_(req); },
  uploadRowFile: function (req) { return actionUploadRowFile_(req); },
  rowFinish: function (req) { return actionRowFinish_(req); },
  // Admin page (adminActions.js)
  stats: function (req) { return actionStats_(req); },
  shadowList: function (req) { return actionShadowList_(req); },
  shadowInvite: function (req) { return actionShadowInvite_(req); },
  broadcastPreview: function (req) { return actionBroadcastPreview_(req); },
  broadcastSend: function (req) { return actionBroadcastSend_(req); },
  unitDirectory: function (req) { return actionUnitDirectory_(req); },
  unitContactsGet: function (req) { return actionUnitContactsGet_(req); },
  unitContactSave: function (req) { return actionUnitContactSave_(req); },
  unitContactDelete: function (req) { return actionUnitContactDelete_(req); },
  unitMeetingSave: function (req) { return actionUnitMeetingSave_(req); },
  unitEaglesSave: function (req) { return actionUnitEaglesSave_(req); },
  outboxRestore: function (req) { return actionOutboxRestore_(req); },
  emailChoices: function (req) { return actionEmailChoices_(req); },
  emailDraft: function (req) { return actionEmailDraft_(req); },
  emailBulkList: function (req) { return actionEmailBulkList_(req); },
  emailBulkDraft: function (req) { return actionEmailBulkDraft_(req); },
  outboxCopy: function (req) { return actionOutboxCopy_(req); },
  saveUnitBoard: function (req) { return actionSaveUnitBoard_(req); },
  templateList: function (req) { return actionTemplateList_(req); },
  templatePreview: function (req) { return actionTemplatePreview_(req); },
  adminData: function (req) { return actionAdminData_(req); },
  adminIntake: function (req) { return actionAdminIntake_(req); },
  adminIntakeCompare: function (req) { return actionAdminIntakeCompare_(req); },
  adminIntakeApply: function (req) { return actionAdminIntakeApply_(req); },
  adminArchive: function (req) { return actionAdminArchive_(req); },
  adminClosedArchive: function (req) { return actionAdminClosedArchive_(req); },
  adminRequestDone: function (req) { return actionAdminRequestDone_(req); },
  hostRequest: function (req) { return actionHostRequest_(req); },
  // Scout detail window (scoutDetailActions.js)
  scoutDetail: function (req) { return actionScoutDetail_(req); },
  scoutSave: function (req) { return actionScoutSave_(req); },
  // Life to Eagle Log panel (scoutLogActions.js)
  scoutLog: function (req) { return actionScoutLog_(req); },
  scoutLogAdd: function (req) { return actionScoutLogAdd_(req); },
  scoutLogEdit: function (req) { return actionScoutLogEdit_(req); },
  scoutMove: function (req) { return actionScoutMove_(req); }
};

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad JSON' });
  }
  return json_(dispatch_(req));
}

/** GET is only for a quick "is it alive" check in a browser. */
function doGet(e) {
  return json_(dispatch_({ action: 'ping' }));
}

function dispatch_(req) {
  var handler = ACTIONS_[req && req.action];
  if (!handler) return { ok: false, error: 'Unknown action' };
  var t0 = Date.now();
  try {
    var out = handler(req) || {};
    out.ok = true;
    console.log('timing ' + req.action + ' ' + (Date.now() - t0) + ' ms');   // Executions log: where the time goes
    return out;
  } catch (err) {
    if (err && err.userMessage) return { ok: false, error: err.userMessage };
    console.error('Action ' + req.action + ' failed: ' + (err && err.stack || err));
    // Never leak internals to the page.
    return { ok: false, error: 'Something went wrong. Please try again later.' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
