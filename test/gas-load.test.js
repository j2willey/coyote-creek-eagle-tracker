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
      'onTrackingEdit', 'onTrackingChange', 'menuInstallTriggers', 'postNote_', 'menuStartLogs', 'logFor_', 'refreshActionDropdowns_', 'menuFolderReport', 'menuFolderApply', 'folderForRecord_', 'protectHidden_', 'ensureHelpTab_', 'menuMarkQueueSpam', 'menuPurgeIntake', 'ensureIntakeFolders_', 'digestHourly', 'runDigest_', 'recordActivity_', 'menuSendDigestNow', 'digestStatus_', 'ensureSettingKeys_', 'ensureParentEmailColumn_', 'onlineType_', 'notOnlineMsg_', 'councilAccountOk_', 'handleQueueAction_', 'handleResendLink_', 'queueActionDropdown_', 'promoteQueueChecked_', 'markQueueSpam_', 'handleScheduleNameEdit_', 'syncSectionHeaders_', 'menuMakeMockFolders', 'actionCommitteeSchedule_', 'actionSaveSlot_', 'actionDeleteSlot_', 'actionSaveReps_', 'actionCancelSlotBooking_', 'actionSaveSlots_', 'actionOpenTimesChoices_', 'actionOpenTimesDraft_', 'insertSlotRow_', 'syncBookedRow_', 'menuAnonymizeStaging', 'anonymizeStaging_', 'unlinkColumns_', 'mailFromTemplate_', 'menuTemplatesDoc', 'templatesStatus_', 'ensureTemplateDoc_', 'queueOutbox_', 'actionOutboxList_', 'actionOutboxSend_', 'actionOutboxSentByMe_', 'actionOutboxDiscard_', 'menuScheduleCheck', 'scheduleCheck_', 'actionOutboxAttachment_', 'actionCommitteeHome_', 'actionReviewChoices_', 'actionReviewStart_', 'actionUploadReviewFile_', 'actionReviewFinish_', 'queueBuiltIn_', 'raisePending_', 'clearPending_', 'pendingWaiting_', 'ensurePendingFormat_', 'menuFlagPending', 'handleChecked_', 'boardRecords_', 'actionRowAction_', 'applyOnSent_', 'stageColumns_', 'actionScoutDetail_', 'actionScoutSave_', 'actionScoutMove_', 'detailFields_', 'actionUploadRowFile_', 'actionRowFinish_', 'rowExecute_', 'placeFolder_', 'placeFolderQuietly_', 'menuPlaceFolders', 'paintCell_', 'lastEborSlot_', 'menuNumberTemplateTabs', 'menuTemplatesCatalog', 'rebuildTemplateCatalog_', 'ensureCatalogTab_', 'actionOutboxSchedule_', 'actionOutboxUnschedule_', 'outboxSendDue_', 'runReminders_', 'draftEborReminder_', 'digestHourly', 'actionChangeBooking_', 'saveRequest_', 'unitScouts_', 'actionUnitCalendar_', 'actionAdminData_', 'actionAdminIntake_', 'actionAdminArchive_', 'actionAdminRequestDone_', 'actionHostRequest_', 'openUnitRequests_', 'runNudges_', 'digestAwaiting_', 'healthCheck_', 'stageDays_', 'sortEborBooked_', 'menuSortEborBooked', 'actionTemplateList_', 'actionTemplatePreview_', 'actionStats_', 'statsRecords_', 'addStatsYear_', 'seedStatsHistory_', 'femaleColumn_', 'actionSaveUnitBoard_', 'sortSettingsKeys_', 'actionOutboxRestore_', 'actionOutboxCopy_', 'actionEmailChoices_', 'actionEmailDraft_', 'buildEmail_', 'nextSlot_', 'statusOrBookingEmail_', 'draftPleaseBook_', 'draftBoardMissing_', 'sendBriefing_', 'draftOne_', 'actionEmailBulkList_', 'actionEmailBulkDraft_', 'actionUnitDirectory_', 'actionUnitContactsGet_', 'actionUnitContactSave_', 'actionUnitContactDelete_', 'unitAccess_', 'sortUnitContacts_', 'actionBroadcastPreview_', 'actionBroadcastSend_', 'actionShadowList_', 'actionShadowInvite_', 'actionScoutLog_', 'actionScoutLogAdd_', 'actionScoutLogEdit_', 'existingLog_', 'runCouncilApps_', 'fileCouncilApp_', 'menuCouncilApps', 'councilRow_', 'councilAppsToCheck_', 'ensureCouncilTab_', 'actionSignerStart_', 'signFinish_', 'signCheck_', 'sendSignRequest_', 'ensureSigningColumn_', 'currentSignedFile_', 'scoutStatusOf_', 'activeMembers_', 'stagingDrive_', 'fetchCouncilLinks_', 'menuCouncilFetchLinks', 'councilFetchLinks_', 'actionCommitteeUploadStart_', 'actionCommitteeUploadFile_', 'actionCommitteeUploadFinish_', 'insideStaging_', 'stagingFolderFor_', 'actionScoutReviewFiles_', 'actionFetchScoutFile_', 'actionStampList_', 'actionStampFetch_', 'actionClosing_', 'closeSuggestions_', 'closedRecords_', 'closedArchiveReport_', 'actionAdminClosedArchive_', 'eagleArchiveTabName_', 'eagleArchiveHead_', 'createEagleArchiveTab_', 'eagleArchivePlan_', 'eagleArchiveWrite_', 'actionEborPaperworkChoices_', 'actionEborPaperworkScout_', 'actionEborPaperworkTemplate_', 'actionEborPaperworkStart_', 'actionEborPaperworkUpload_', 'actionEborPaperworkFinish_', 'draftCouncilPaperwork_', 'existingSigned_', 'key3Rows_', 'writeKey3Address_', 'committeeAll_', 'whoIs_']) {
      expect(typeof ctx[fn], fn).toBe('function');
    }
  });

  it('no top-level function is defined in two files (one shared scope: the later file would win silently)', () => {
    const seen = {}, dup = [];
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)) {
      if (seen[m[1]] && seen[m[1]] !== f) dup.push(m[1] + ': ' + path.basename(seen[m[1]]) + ' + ' + path.basename(f));
      seen[m[1]] = f;
    }
    expect(dup).toEqual([]);
  });

  it('the router has no action name twice (a later key would silently replace an earlier one)', () => {
    const keys = [...fs.readFileSync(path.join(SRC, 'router.js'), 'utf8').matchAll(/^  ([A-Za-z]+): function/gm)].map(m => m[1]);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('Setup creates the _Signatures tab with the ledger columns (remote EBoR signing)', () => {
    expect(vm.runInContext('TAB_HEADERS_', ctx)['_Signatures']).toEqual(vm.runInContext('Signatures.HEADERS', ctx));
    for (const fn of ['actionEborPaperworkSavePartial_', 'actionEborSignatureStatus_', 'actionEborSignatureRequest_', 'actionEborSignatureEdit_',
      'actionEborPaperworkFinishPartial_', 'actionSignerChoices_', 'actionSignerDocs_', 'actionSignerFetch_', 'actionSignerStart_', 'actionSignerUpload_',
      'actionSignerFinish_', 'openSignaturesFor_', 'closeSignatureSeries_']) expect(typeof ctx[fn], fn).toBe('function');
  });

  it('Setup creates the Closed Archive tab with the archive columns (and the Stats History closure columns)', () => {
    const tabs = vm.runInContext('TAB_HEADERS_', ctx);
    expect(tabs['Closed Archive']).toEqual(vm.runInContext('Closing.ARCHIVE_HEADERS', ctx));
    expect(tabs['Stats History']).toEqual(vm.runInContext('Stats.HISTORY_HEADERS', ctx));
  });

  it('the Eagle Archive library loads and the tab name has a Settings default', () => {
    expect(vm.runInContext("EagleArchive.labelKey(2025)", ctx)).toBe('S:eagles_2025');
    expect(vm.runInContext("SettingsModel.parse([]).eagleArchiveTab", ctx)).toBe('Eagle Archive');
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

  it('stampList / stampFetch: blank folder = no stamps; only listed PNGs are served; bad bytes are refused', () => {
    const png = [-119, 80, 78, 71, 13, 10, 26, 10, 1, 2];
    const mk = (id, name, mime, size, bytes) => ({
      getId: () => id, getName: () => name, getMimeType: () => mime, getSize: () => size,
      getLastUpdated: () => new Date(2026, 10, 9),
      getBlob: () => ({ getContentType: () => mime, getBytes: () => bytes })
    });
    const files = [
      mk('S-OK', 'Approved.png', 'image/png', 10, png),
      mk('S-BAD', 'Fake.png', 'image/png', 10, [37, 80, 68, 70, 45, 49, 46, 52]),
      mk('S-BIG', 'Big.png', 'image/png', 5 * 1024 * 1024, png),
      mk('S-PDF', 'notes.pdf', 'application/pdf', 10, [37, 80, 68, 70])
    ];
    const folder = { getId: () => 'STAMPS', getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; } };
    const cacheStore = {};
    ctx.CacheService = { getScriptCache: () => ({ get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) };
    ctx.committeeMe_ = () => ({ email: 'ab@example.org', me: { name: 'Pat Reviewer', initials: 'AB' }, committee: [] });
    ctx.Utilities = { base64Encode: (b) => Buffer.from(b.map(x => x & 255)).toString('base64') };
    ctx.DriveApp = {
      getFolderById: id => { if (id !== 'STAMPS') throw new Error('nope'); return folder; },
      getFileById: id => files.find(f => f.getId() === id)
    };

    ctx.getSettings_ = () => ({ stampsFolderId: '' });
    const off = vm.runInContext("dispatch_({action:'stampList', session:'s'})", ctx);
    expect(off).toMatchObject({ ok: true, enabled: false, stamps: [] });

    ctx.getSettings_ = () => ({ stampsFolderId: 'MISSING' });
    const bad = vm.runInContext("dispatch_({action:'stampList', session:'s'})", ctx);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Form Templates folder could not be opened/);

    ctx.getSettings_ = () => ({ stampsFolderId: 'STAMPS' });
    const list = vm.runInContext("dispatch_({action:'stampList', session:'s'})", ctx);
    expect(list.ok).toBe(true);
    expect(list.enabled).toBe(true);
    expect(list.stamps.map(s => s.id)).toEqual(['S-OK', 'S-BAD']);   // PNG-named files up to 2 MB, by name (Approved, Fake)
    expect(list.skipped.map(s => s.name)).toEqual(['Big.png']);

    const ok = vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:'S-OK'})", ctx);
    expect(ok).toMatchObject({ ok: true, name: 'Approved.png', mime: 'image/png' });
    expect(ok.data).toBe(Buffer.from(png.map(x => x & 255)).toString('base64'));
    const again = vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:'S-OK'})", ctx);
    expect(again.data).toBe(ok.data);    // served from the cache the second time

    expect(vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:'S-BAD'})", ctx).error).toMatch(/not a valid PNG/);
    expect(vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:'S-BIG'})", ctx).error).toMatch(/not in the Form Templates folder/);
    expect(vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:'S-PDF'})", ctx).error).toMatch(/not in the Form Templates folder/);
    expect(vm.runInContext("dispatch_({action:'stampFetch', session:'s', id:''})", ctx).error).toMatch(/Pick a stamp/);

    // 14a: formTemplatesFolderId is the folder; the older stampsFolderId still works when it is blank.
    ctx.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };
    ctx.getSettings_ = () => ({ formTemplatesFolderId: 'STAMPS', stampsFolderId: '' });
    expect(vm.runInContext("dispatch_({action:'stampList', session:'s'})", ctx).stamps.map(s => s.id)).toEqual(['S-OK', 'S-BAD']);
    ctx.getSettings_ = () => ({ formTemplatesFolderId: 'MISSING', stampsFolderId: 'STAMPS' });
    expect(vm.runInContext("dispatch_({action:'stampList', session:'s'})", ctx).ok).toBe(false);   // the new key wins over the old
  });

  it('EBoR paperwork: bad tokens are refused; the template must be set and be a PDF; the choices list Booked and Paused Scouts', () => {
    expect(vm.runInContext("dispatch_({action:'eborPaperworkFinish', uploadToken:'nope'})", ctx).error).toMatch(/not valid/);
    expect(vm.runInContext("dispatch_({action:'eborPaperworkUpload', uploadToken:'nope'})", ctx).error).toMatch(/not valid/);

    ctx.committeeMe_ = () => ({ email: 'ab@example.org', me: { name: 'Pat Reviewer', initials: 'AB' }, committee: [{ name: 'Pat Reviewer', initials: 'AB', email: 'ab@example.org' }] });
    ctx.getSettings_ = () => ({ advancementReportTemplateId: '', sections: [] });
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).error).toMatch(/advancementReportTemplateId is empty/);

    const mkFile = bytes => ({ getName: () => 'Blank.pdf', getBlob: () => ({ getBytes: () => bytes }) });
    ctx.Utilities = { base64Encode: (b) => Buffer.from(b.map(x => x & 255)).toString('base64') };
    ctx.getSettings_ = () => ({ advancementReportTemplateId: 'TPL', sections: [] });
    ctx.DriveApp = { getFileById: id => { if (id !== 'TPL') throw new Error('nope'); return mkFile([37, 80, 68, 70, 45]); } };
    const ok = vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx);
    expect(ok).toMatchObject({ ok: true, name: 'Blank.pdf', mime: 'application/pdf' });
    expect(ok.data).toBe(Buffer.from([37, 80, 68, 70, 45]).toString('base64'));
    ctx.DriveApp = { getFileById: () => mkFile([1, 2, 3, 4, 5]) };
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).error).toMatch(/not a PDF/);
    ctx.DriveApp = { getFileById: () => { throw new Error('no access'); } };
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).error).toMatch(/could not be opened/);

    // 14a: no template id -> the PDF in the Form Templates folder (34403 / Advancement), newest wins.
    const mkPdf = (id, name, t) => ({ getId: () => id, getName: () => name, getMimeType: () => 'application/pdf', getSize: () => 5, getLastUpdated: () => new Date(t),
      getBlob: () => ({ getBytes: () => [37, 80, 68, 70, 45] }) });
    const ftFiles = [mkPdf('OLD', 'Advancement Form 34403 (old).pdf', 1000), mkPdf('NEWEST', 'Advancement Form 34403.pdf', 2000), mkPdf('APP', 'Blank Eagle Application.pdf', 3000)];
    const ftFolder = { getFiles: () => { let i = 0; return { hasNext: () => i < ftFiles.length, next: () => ftFiles[i++] }; } };
    ctx.DriveApp = { getFolderById: id => { if (id !== 'FT') throw new Error('nope'); return ftFolder; }, getFileById: id => ftFiles.find(f => f.getId() === id) };
    ctx.getSettings_ = () => ({ advancementReportTemplateId: '', formTemplatesFolderId: 'FT', sections: [] });
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx)).toMatchObject({ ok: true, name: 'Advancement Form 34403.pdf' });
    ctx.getSettings_ = () => ({ advancementReportTemplateId: '', formTemplatesFolderId: '', stampsFolderId: 'FT', sections: [] });
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).ok).toBe(true);
    ctx.getSettings_ = () => ({ advancementReportTemplateId: '', formTemplatesFolderId: 'FT', sections: [] });
    ftFiles.length = 0;
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).error).toMatch(/advancementReportTemplateId is empty/);
    ftFiles.push(mkPdf('OLD', 'Advancement Form 34403 (old).pdf', 1000), mkPdf('NEWEST', 'Advancement Form 34403.pdf', 2000), mkPdf('APP', 'Blank Eagle Application.pdf', 3000));
    ctx.getSettings_ = () => ({ advancementReportTemplateId: 'APP', formTemplatesFolderId: 'FT', sections: [] });   // an explicit id wins over the folder
    expect(vm.runInContext("dispatch_({action:'eborPaperworkTemplate', session:'s'})", ctx).name).toBe('Blank Eagle Application.pdf');

    ctx.getSettings_ = () => ({ advancementReportTemplateId: 'TPL', districtName: 'Coyote Creek', advancementTitle: 'Coyote Creek Advancement', sections: [], maxUploadMB: 20, testMode: true });
    ctx.todayYmd_ = () => '2026-02-01';
    ctx.Records = { all: () => [
      { recordId: 'R-1', section: 'ebor_booked', scout_name: 'Teddy Sample', preferred_name: '', unit: 'T999' },
      { recordId: 'R-2', section: 'ebor_paused', scout_name: 'Owen Fairbanks', preferred_name: '', unit: 'C917' },
      { recordId: 'R-3', section: 'eagle_earned', scout_name: 'Done Scout', preferred_name: '', unit: 'T1' }] };
    ctx.readSchedule_ = () => ({ rows: [{ record_id: 'R-1', slot_type: 'EBoR', date: '2026-03-14', time: '7:00 PM', reps: 'AB' }] });
    const ch = vm.runInContext("dispatch_({action:'eborPaperworkChoices', session:'s'})", ctx);
    expect(ch.ok).toBe(true);
    expect(ch.scouts.map(x => [x.recordId, x.boardYmd])).toEqual([['DEMO', '2026-02-01'], ['R-1', '2026-03-14'], ['R-2', '']]);   // the Demo Scout is first (14b)
    expect(ch.selected).toBe('R-1');
    expect(ch.settings.templateSet).toBe(true);
    expect(ch.slots.report).toHaveLength(3);
  });
  it('Setup / repair copies stampsFolderId into formTemplatesFolderId once and leaves the old key', () => {
    const writes = [];
    ctx.setSetting_ = (k, v) => { writes.push([k, v]); };
    ctx.getSettings_ = () => ({ formTemplatesFolderId: '', stampsFolderId: ' OLD ' });
    expect(vm.runInContext('copyFormTemplatesKey_()', ctx)).toBe(true);
    expect(writes).toEqual([['formTemplatesFolderId', 'OLD']]);
    ctx.getSettings_ = () => ({ formTemplatesFolderId: 'NEW', stampsFolderId: 'OLD' });
    expect(vm.runInContext('copyFormTemplatesKey_()', ctx)).toBe(false);
    expect(writes).toHaveLength(1);
  });
});
