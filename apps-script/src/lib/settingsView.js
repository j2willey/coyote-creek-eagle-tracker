/**
 * SettingsView (Jim W., 2026-11-12; plan: vault admin-ui-plan.md): the Settings tab grouped for the Admin page's
 * Settings sub-tab, with a short help line per key, and who may see it (the Admin role). Pure.
 *
 * Step 2 of the plan shows everything read-only; editing comes group by group (District details and Scheduling
 * first). "Internal wiring" stays read-only for good: IDs and column names are set by Setup / repair or by hand.
 */
var SettingsView = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }

  // [key, help]. Order = order on the page.
  var GROUPS = [
    { id: 'district', label: 'District details', who: 'Committee chair', keys: [
      ['districtName', 'The Advancement Report\'s District box'],
      ['advancementTitle', 'The Advancement Report\'s Title box'],
      ['approvalRepName', 'Council or District Project Approval Representative (the District Advancement Chair), as on the Proposal\'s Contact Information page'],
      ['approvalRepPhone', ''], ['approvalRepEmail', ''], ['approvalRepAddress', ''], ['approvalRepCity', ''], ['approvalRepState', ''], ['approvalRepZip', ''],
      ['councilEaglesEmail', 'Council Eagle Services address for the signed EBoR paperwork'],
      ['dayOfContact', '"Running late?" line in the EBoR reminder, e.g. "text 408-555-0100"; blank = left out']] },
    { id: 'scheduling', label: 'Scheduling', who: 'Committee chair', keys: [
      ['onlineBooking', 'Session types Scouts book online: a list, "all" or "none"'],
      ['bookingLeadHours', 'Scouts can\'t book a Pre-Review Call sooner than this many hours ahead'],
      ['reviewLeadHours', '… or a Proposal Review sooner than this'],
      ['eborLeadHours', '… or an EBoR sooner than this (the unit needs time to assemble a board)'],
      ['cancelCutoffHours', 'Scouts can cancel up to this many hours before'],
      ['intakeMinutes', 'Pre-Review Call length (new sessions)'], ['reviewMinutes', 'Proposal Review length'],
      ['eborMinutes', 'EBoR length'], ['followupMinutes', 'Follow-Up / Consult length'],
      ['defaultStartTime', 'Start time when a member clicks a day'],
      ['defaultLocation', 'Default place for Proposal Reviews and EBoRs'], ['defaultAddress', ''],
      ['reservedForUnits', 'Reserved slots on the unit page: Off | See | Assign (only Off is built)']] },
    { id: 'reminders', label: 'Reminders and email', who: 'Committee chair or Jim W.', keys: [
      ['digestHours', 'Committee digest times, e.g. "6 PM" or "6 AM, 6 PM"; blank = none'],
      ['digestTo', 'Digest recipients; blank = the committee group'],
      ['pleaseBookDays', '"Please book" reminders: days in the To Book stage per session type'],
      ['eborReminderDays', 'EBoR reminder drafted this many days before the board'],
      ['signingNudgeDays', 'Proposal signatures waiting this many days: listed in the digest'],
      ['closeReviewDays', 'No log line or update for this long: "Close?" suggestion'],
      ['closeSnoozeDays', '"Keep open" hides the "Close?" suggestion for this long'],
      ['councilAckDays', 'Days after sending the signed paperwork to Council'],
      ['committeeGroupEmail', 'Copied on substantive emails (never on sign-in links)'],
      ['replyTo', 'Where replies go; blank = the committee group'],
      ['adminEmail', 'Gets error reports; also has the Admin role']] },
    { id: 'intake', label: 'Web submissions', who: 'Jim W.', keys: [
      ['intakeConfirmDays', 'Confirmation link lifetime (days)'],
      ['intakePurgeDays', 'Unconfirmed submissions purged after this many days'],
      ['maxUploadMB', 'Largest file a Scout can upload (MB)'],
      ['intakeLinkHours', '"Start your Proposal" link lifetime (hours, at most 6)'],
      ['unitPipeline', 'Unit page: read-only list of the unit\'s Eagle candidates']] },
    { id: 'signin', label: 'Sign-in and security', who: 'Jim W.', keys: [
      ['signinCode', 'The sign-in email also carries a 6-digit code'],
      ['linkBrowserCheck', 'Link opened in another browser: off | log | enforce'],
      ['linkMinutes', 'Sign-in link lifetime (minutes)'],
      ['sessionDays', 'How long a sign-in lasts (days)'],
      ['committeeSessionDays', '… for committee members'],
      ['parentsSignIn', 'FALSE: only the Scout\'s email signs in; parents are copied on emails']] },
    { id: 'test', label: 'Test mode', who: 'Jim W.', keys: [
      ['testMode', 'TRUE: no email reaches families or units (fail-safe: missing = TRUE)'],
      ['testRecipient', 'Where test-mode mail goes'],
      ['testDeliverToCommittee', 'Staging: in test mode, committee members still get mail addressed only to them']] },
    { id: 'wiring', label: 'Internal wiring (read-only)', who: 'Setup / repair or by hand in the sheet', keys: [
      ['webOrigin', ''], ['trackingTab', ''], ['scheduleSheetId', ''], ['scheduleTab', ''], ['calendarId', ''],
      ['templatesDocId', ''], ['templatesCatalogId', ''], ['intakeFolderId', ''], ['scoutsFolderId', ''], ['inProgressFolder', ''],
      ['folderReportFolders', ''], ['exceptionsFolder', ''], ['closedFolder', ''], ['formTemplatesFolderId', ''], ['stampsFolderId', ''],
      ['advancementReportTemplateId', ''], ['eagleArchiveTab', ''], ['councilAppFrom', ''], ['councilDomain', ''], ['allowProduction', ''],
      ['eborDoneColor', ''], ['svmbcReceivedMark', ''], ['eborSignupUrl', ''], ['reviewSignupUrl', ''],
      ['eborDateColumn', ''], ['eborWhoColumn', ''], ['proposalReviewDateColumn', ''], ['proposalReviewWhoColumn', ''],
      ['preReviewDateColumn', ''], ['preReviewWhoColumn', ''], ['approvedDateColumn', ''], ['appSubmittedColumn', ''],
      ['appVerifiedColumn', ''], ['eborEmailedColumn', ''], ['signedSentColumn', ''], ['svmbcReceivedColumn', '']] }
  ];

  var LINKS = {
    scheduleSheetId: 'https://docs.google.com/spreadsheets/d/', templatesCatalogId: 'https://docs.google.com/spreadsheets/d/',
    templatesDocId: 'https://docs.google.com/document/d/', advancementReportTemplateId: 'https://drive.google.com/file/d/',
    intakeFolderId: 'https://drive.google.com/drive/folders/', scoutsFolderId: 'https://drive.google.com/drive/folders/',
    formTemplatesFolderId: 'https://drive.google.com/drive/folders/', stampsFolderId: 'https://drive.google.com/drive/folders/'
  };

  function show(v) {
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return str(v);
  }

  /**
   * settings: getSettings_(); defaults: SettingsModel.DEFAULT_VALUES ->
   * {groups: [{id, label, who, items: [{key, value, def, isDefault, help, link}]}], sections: [{key, label, scoutStatus, order}]}
   * Keys on the tab that no group lists go in "Other" (read-only).
   */
  function view(settings, defaults) {
    var s = settings || {}, d = defaults || {};
    var listed = {};
    var item = function (key, help) {
      listed[key] = true;
      var value = show(s[key]), def = show(d[key]);
      var link = LINKS[key] && str(s[key]) ? LINKS[key] + encodeURIComponent(str(s[key])) : '';
      return { key: key, value: value, def: def, isDefault: value === def, help: help || '', link: link };
    };
    var groups = GROUPS.map(function (g) {
      return { id: g.id, label: g.label, who: g.who, items: g.keys.map(function (k) { return item(k[0], k[1]); }) };
    });
    var other = Object.keys(s).filter(function (k) { return !listed[k] && k !== 'sections' && k.charAt(0) !== '_'; }).sort()
      .map(function (k) { return item(k, ''); });
    if (other.length) groups.push({ id: 'other', label: 'Other (not grouped yet)', who: '', items: other });
    var sections = (s.sections || []).map(function (x) { return { key: x.key, label: x.label, scoutStatus: x.scoutStatus, order: x.order }; });
    return { groups: groups, sections: sections };
  }

  /** The Admin role: Role "Admin" on the Committee tab, or the Settings adminEmail (so there is always one). */
  function isAdmin(member, email, settings) {
    if (member && /^admin$/i.test(str(member.role))) return true;
    var e = str(email).toLowerCase();
    return !!e && e === str(settings && settings.adminEmail).toLowerCase();
  }

  return { GROUPS: GROUPS, view: view, isAdmin: isAdmin };
})();

if (typeof module !== 'undefined') module.exports = SettingsView;
