// Loads every Apps Script file into one shared global scope (as Apps Script does)
// to catch load-time errors, name collisions and missing globals before `clasp push`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../apps-script/src');

function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? listJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
}

describe('Apps Script bundle', () => {
  const files = listJs(SRC).sort();
  const ctx = vm.createContext({ console });
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });

  it('defines the entry points', () => {
    for (const fn of ['doPost', 'doGet', 'onOpen', 'menuSetup', 'menuSelfCheck', 'menuSendTestEmail',
      'menuMigrateDryRun', 'menuNameNewColumns', 'actionRequestLink_', 'actionRedeemLink_', 'actionWhoami_', 'actionSignOut_', 'menuMigrateApply', 'menuMakeFakeSchedule',
      'actionSubmitIntake_', 'actionUploadIntakeFile_', 'actionFinishIntake_', 'actionConfirmIntake_',
      'menuPromoteQueueRow', 'actionMyRecord_', 'actionStartUpdate_', 'actionUploadUpdateFile_', 'actionFinishUpdate_',
      'attachFiles_', 'storeUpload_', 'attachQueueToRecord_',
      'actionSlots_', 'actionBook_', 'actionCancelBooking_', 'bookSlot_', 'cancelBooking_', 'syncInvites_', 'syncInvitesHourly', 'menuSyncInvites', 'upcomingBooking_', 'onScheduleEdit', 'eborMail_', 'actionUnitEbors_', 'actionSaveBoard_', 'ensureSectionRows_', 'ensureSettingsSections_', 'seedUnitInfo_', 'actionSaveCc_', 'menuIntakeOk', 'menuResendBookingLink', 'menuBookOnBehalf', 'menuCancelBooking', 'seedCommittee_', 'menuKeySlots',
      'onTrackingEdit', 'onTrackingChange', 'menuInstallTriggers', 'postNote_', 'menuStartLogs', 'logFor_', 'refreshActionDropdowns_', 'menuFolderReport', 'menuFolderApply', 'folderForRecord_', 'protectHidden_', 'ensureHelpTab_', 'menuMarkQueueSpam', 'menuPurgeIntake', 'ensureIntakeFolders_', 'digestHourly', 'runDigest_', 'recordActivity_', 'menuSendDigestNow', 'digestStatus_', 'ensureSettingKeys_', 'ensureParentEmailColumn_', 'onlineType_', 'notOnlineMsg_', 'councilAccountOk_', 'handleQueueAction_', 'handleResendLink_', 'queueActionDropdown_', 'promoteQueueChecked_', 'markQueueSpam_', 'handleScheduleNameEdit_', 'syncSectionHeaders_', 'menuMakeMockFolders', 'actionCommitteeSchedule_', 'actionSaveSlot_', 'actionDeleteSlot_', 'actionSaveReps_', 'actionCancelSlotBooking_', 'actionSaveSlots_', 'actionOpenTimesChoices_', 'actionOpenTimesDraft_', 'insertSlotRow_', 'syncBookedRow_', 'menuAnonymizeStaging', 'anonymizeStaging_', 'unlinkColumns_', 'mailFromTemplate_', 'menuTemplatesDoc', 'templatesStatus_', 'ensureTemplateDoc_', 'queueOutbox_', 'actionOutboxList_', 'actionOutboxSend_', 'actionOutboxSentByMe_', 'actionOutboxDiscard_', 'menuScheduleCheck', 'scheduleCheck_', 'actionOutboxAttachment_', 'actionCommitteeHome_', 'actionReviewChoices_', 'actionReviewStart_', 'actionUploadReviewFile_', 'actionReviewFinish_', 'queueBuiltIn_', 'raisePending_', 'clearPending_', 'pendingWaiting_', 'ensurePendingFormat_', 'menuFlagPending', 'handleChecked_', 'boardRecords_', 'actionRowAction_', 'applyOnSent_', 'stageColumns_', 'actionScoutDetail_', 'actionScoutSave_', 'actionScoutMove_', 'detailFields_', 'actionUploadRowFile_', 'actionRowFinish_', 'rowExecute_', 'placeFolder_', 'placeFolderQuietly_', 'menuPlaceFolders', 'paintCell_', 'lastEborSlot_', 'menuNumberTemplateTabs', 'menuTemplatesCatalog', 'rebuildTemplateCatalog_', 'ensureCatalogTab_', 'actionOutboxSchedule_', 'actionOutboxUnschedule_', 'outboxSendDue_', 'runReminders_', 'draftEborReminder_', 'digestHourly', 'actionChangeBooking_', 'saveRequest_', 'unitScouts_', 'actionUnitCalendar_', 'actionAdminData_', 'actionAdminIntake_', 'actionAdminArchive_', 'actionAdminRequestDone_', 'actionHostRequest_', 'openUnitRequests_', 'runNudges_', 'digestAwaiting_', 'healthCheck_', 'stageDays_', 'sortEborBooked_', 'menuSortEborBooked', 'actionTemplateList_', 'actionTemplatePreview_', 'actionStats_', 'statsRecords_', 'addStatsYear_', 'seedStatsHistory_', 'femaleColumn_', 'actionSaveUnitBoard_', 'sortSettingsKeys_', 'actionOutboxRestore_', 'actionOutboxCopy_', 'actionEmailChoices_', 'actionEmailDraft_', 'buildEmail_', 'nextSlot_', 'statusOrBookingEmail_', 'draftPleaseBook_', 'draftBoardMissing_', 'sendBriefing_', 'draftOne_', 'actionEmailBulkList_', 'actionEmailBulkDraft_', 'actionUnitDirectory_', 'actionUnitContactsGet_', 'actionUnitContactSave_', 'actionUnitContactDelete_', 'unitAccess_', 'sortUnitContacts_', 'actionBroadcastPreview_', 'actionBroadcastSend_', 'actionShadowList_', 'actionShadowInvite_', 'actionScoutLog_', 'actionScoutLogAdd_', 'actionScoutLogEdit_', 'existingLog_', 'runCouncilApps_', 'fileCouncilApp_', 'menuCouncilApps', 'councilRow_', 'councilAppsToCheck_', 'ensureCouncilTab_', 'actionSignStart_', 'signFinish_', 'signCheck_', 'sendSignRequest_', 'ensureSigningColumn_', 'currentSignedFile_', 'scoutStatusOf_', 'activeMembers_', 'stagingDrive_', 'fetchCouncilLinks_', 'menuCouncilFetchLinks', 'councilFetchLinks_', 'actionCommitteeUploadStart_', 'actionCommitteeUploadFile_', 'actionCommitteeUploadFinish_', 'insideStaging_', 'stagingFolderFor_', 'actionScoutReviewFiles_', 'actionFetchScoutFile_', 'actionClosing_', 'closeSuggestions_']) {
      expect(typeof ctx[fn], fn).toBe('function');
    }
  });

  it('libraries are usable from the shared scope', () => {
    const plan = vm.runInContext(
      "MigrationPlan.plan([['Eagle Candidate'],['Something missing'],['Scout 1']], SettingsModel.parse([]), function(){return 0;})", ctx);
    expect(plan.recordWrites).toHaveLength(1);
    expect(plan.recordWrites[0].section).toBe('proposal_incomplete');
  });

  it('ping works through the dispatcher', () => {
    ctx.SpreadsheetApp = { getActive: () => ({ getSheetByName: () => null }) };
    const out = vm.runInContext("dispatch_({action:'ping'})", ctx);
    expect(out.ok).toBe(true);
    expect(out.testMode).toBe(true);
    expect(vm.runInContext("dispatch_({action:'nope'})", ctx).ok).toBe(false);
  });

  it('intake actions are routed and reject bad input with a user-safe message', () => {
    // Email-first intake: no form token = no submission (the address must be proven first).
    const out = vm.runInContext("dispatch_({action:'submitIntake', scout_name:''})", ctx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/entering your email/);
    const st = vm.runInContext("dispatch_({action:'startIntake', token:'x'})", ctx);
    expect(st.error).toMatch(/not valid/);
    const bad = vm.runInContext("dispatch_({action:'confirmIntake', token:'x'})", ctx);
    expect(bad.error).toMatch(/not valid/);
    const upd = vm.runInContext("dispatch_({action:'finishUpdate', uploadToken:'nope'})", ctx);
    expect(upd.error).toMatch(/not valid/);
    const bk = vm.runInContext("dispatch_({action:'book', adultConfirmed:false})", ctx);
    expect(bk.error).toMatch(/Signed out/);
    const rv = vm.runInContext("dispatch_({action:'reviewFinish', uploadToken:'nope'})", ctx);
    expect(rv.error).toMatch(/not valid/);
    const srf = vm.runInContext("dispatch_({action:'scoutReviewFiles'})", ctx);
    expect(srf.error).toMatch(/Signed out/);
    const fsf = vm.runInContext("dispatch_({action:'fetchScoutFile'})", ctx);
    expect(fsf.error).toMatch(/Signed out/);
  });

  it('scoutReviewFiles and fetchScoutFile enforce folder-membership check', () => {
    const f1 = {
      getId: () => 'F-IN',
      getName: () => 'Pat_Q-T999_ESSPP-V1.pdf',
      getMimeType: () => 'application/pdf',
      getSize: () => 4,
      getLastUpdated: () => new Date(2026, 10, 9),
      getBlob: () => ({ getContentType: () => 'application/pdf', getBytes: () => [37, 80, 68, 70] })
    };
    const gdoc = {
      getId: () => 'F-LOG',
      getName: () => 'Pat Q - T999 - Life to Eagle Log',
      getMimeType: () => 'application/vnd.google-apps.document',
      getSize: () => 0,
      getLastUpdated: () => new Date(2026, 10, 9)
    };
    const folder = {
      getId: () => 'FOLDER-1',
      isTrashed: () => false,
      getFiles: () => {
        const arr = [f1, gdoc];
        let i = 0;
        return { hasNext: () => i < arr.length, next: () => arr[i++] };
      }
    };
    ctx.committeeMe_ = () => ({ email: 'ab@example.org', me: { name: 'Pat Reviewer', initials: 'AB' }, committee: [] });
    ctx.Records = { get: (id) => id === 'R-1' ? { recordId: 'R-1', section: 'review_booked', fields: { scout_name: 'Pat Q', unit: 'T999', _folder_id: 'FOLDER-1' } } : null };
    ctx.DriveApp = { getFolderById: (id) => id === 'FOLDER-1' ? folder : null };
    ctx.Session = { getScriptTimeZone: () => 'America/Los_Angeles' };
    ctx.Utilities = {
      formatDate: () => '11/9/2026',
      base64Encode: (b) => Buffer.from(b).toString('base64')
    };

    const listRes = vm.runInContext("dispatch_({action:'scoutReviewFiles', session:'s', recordId:'R-1'})", ctx);
    expect(listRes.ok).toBe(true);
    expect(listRes.folderUrl).toBe('https://drive.google.com/drive/folders/FOLDER-1');
    expect(listRes.files).toEqual([
      { id: 'F-IN', name: 'Pat_Q-T999_ESSPP-V1.pdf', mime: 'application/pdf', bytes: 4, date: '11/9/2026' }
    ]);

    const okFetch = vm.runInContext("dispatch_({action:'fetchScoutFile', session:'s', recordId:'R-1', fileId:'F-IN'})", ctx);
    expect(okFetch.ok).toBe(true);
    expect(okFetch.name).toBe('Pat_Q-T999_ESSPP-V1.pdf');
    expect(okFetch.data).toBe(Buffer.from([37, 80, 68, 70]).toString('base64'));

    const outsideFetch = vm.runInContext("dispatch_({action:'fetchScoutFile', session:'s', recordId:'R-1', fileId:'OUTSIDE-ID'})", ctx);
    expect(outsideFetch.ok).toBe(false);
    expect(outsideFetch.error).toMatch(/not in Pat Q's folder/);
  });
});
