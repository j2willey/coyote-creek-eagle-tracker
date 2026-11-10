/**
 * SettingsModel: parse the "Settings" tab into a plain object.
 *
 * Pure (no Google services) so it runs in Apps Script and in Node tests.
 *
 * Settings tab layout:
 *   A:B  key | value                 (one setting per row, header row "Key | Value")
 *   D:G  section key | label prefix | scout status | order
 *        (header row "Section key | Label | Scout status | Order")
 *
 * Fail-safe rule: if `testMode` is missing or unreadable, test mode is ON.
 */
var SettingsModel = (function () {
  var DEFAULT_VALUES = {
    trackingTab: 'Eagle Tracker',
    testMode: true,
    testRecipient: '',            // filled by setup with the deploying user's email
    testDeliverToCommittee: false, // STAGING playground: in test mode, mail addressed ONLY to Committee tab members (their sign-in links) is delivered to them
    adminEmail: '',               // gets error reports
    committeeGroupEmail: '',      // copied on substantive emails (never on sign-in links)
    templatesDocId: '',
    templatesCatalogId: '',       // the email catalog Sheet (Admin → Templates: rebuild catalog); set by the tool           // Google Doc with one tab per email (Admin → Templates: create Doc); blank = built-in wording
    replyTo: '',                  // where replies to the tool's emails go; blank = committeeGroupEmail (nobody reads the cc-advancement inbox)
    scheduleSheetId: '',
    scheduleTab: 'Schedule',
    intakeFolderId: '',           // `_Intake Queue` folder (M3)
    scoutsFolderId: '',           // holds the year folders and `202x` (M3)
    inProgressFolder: '202x',     // subfolder for Scouts still in progress
    folderReportFolders: '',      // folder report scans these subfolders (comma list); blank = 202x + the tracking tab's year
    intakeConfirmDays: 7,         // confirmation link lifetime
    intakePurgeDays: 14,          // unconfirmed submissions purged after this
    maxUploadMB: 20,
    calendarId: 'primary',        // invites are created on the deploying account's calendar (M5)
    // Booking cutoffs (hours before the slot; Scouts' online booking only, committee "Book a slot" ignores them):
    bookingLeadHours: 48,         // Scouts can't book a Pre-Review Call sooner than this
    reviewLeadHours: 48,          // ...or a Proposal Review sooner than this (reps need time to sign up)
    eborLeadHours: 336,           // ...or an EBoR sooner than this (unit needs time to assemble a board)
    eborDateColumn: 'ebor_date',
    eborWhoColumn: 'ebor_ccac_reps',   // EBoR board: committee/council initials, copied from the schedule (Jim W., 2026-10-24)
    proposalReviewDateColumn: 'proposal_review.date',
    proposalReviewWhoColumn: 'proposal_review.who',
    approvedDateColumn: '',
    appSubmittedColumn: '',       // Application Submitted / Application Verified / Emailed to set up EBoR columns;
    appVerifiedColumn: '',        //   blank = found by name (lib/stageActions.js)
    eborEmailedColumn: '',
    eborSignupUrl: '',
    reviewSignupUrl: '',
    exceptionsFolder: 'Exceptions', // Scouts folder child for Eagle Not Awarded / Proposal Not Approved (year folders = Eagles only)
    closeReviewDays: 180,         // Proposal Not Approved / EBoR Paused with no log line or update for this long: "Close?" suggestion (lib/closing.js)
    closeSnoozeDays: 90,          // "Keep open" hides the "Close?" suggestion for this long
    eagleArchiveTab: 'Eagle Archive', // January archive: a past year's Eagles go to the top of this tab (a "<year> Eagles" section)
    closedFolder: 'Archive/Closed', // January archive: Closed Scouts' folders move to <Scouts folder>/<this path>
    councilEaglesEmail: '',       // Council Eagle Services address for the signed EBoR paperwork (set on the Settings tab)
    eborDoneColor: '#93c47d',     // EBoR Date cell painted on "Eagle earned" (the sheet's old green), blank = no paint
    signedSentColumn: '',         // "signed paperwork sent to Council" date / SVMBC Received columns; blank = found by name
    svmbcReceivedColumn: '',
    svmbcReceivedMark: '*',       // what "Council received the paperwork" writes into SVMBC Received (the sheet uses *)
    councilAckDays: 7,
    unitPipeline: true,           // unit page: read-only list of the unit's Eagle candidates (stage, age); FALSE hides it
    councilAppFrom: '',           // Council Formsite application emails filed into Scout folders from this date (YYYY-MM-DD); blank = off
    pleaseBookDays: 'Intake 7,14; ESSPPR 7,14; EBoR 7',   // "Please book" reminders: days in the To Book stage per session type; a type with no days = none
    signingNudgeDays: 3,          // Proposal signatures in progress: listed in the digest after this many days waiting on a signer
    eborReminderDays: 3,          // EBoR reminder (4.3.c, Scout + board) is drafted this many days before the board
    dayOfContact: '',             // "Running late?" line in the EBoR reminder, e.g. "text 408-555-0100"; blank = line left out            // paperwork sent this many days ago without SVMBC Received = overdue (amber, digest)          // {scheduleLink} in the Proposal Review booking email while reviews aren't booked online; blank = eborSignupUrl            // link for {scheduleLink} in the EBoR next-steps email (today: the old schedule sheet)       // machine name of the Approved Date column; blank = the column named approved_date (Review page)
    cancelCutoffHours: 24,        // Scouts can cancel up to this long before
    preReviewDateColumn: 'pre_screen_intake_review.date',   // tracking columns filled on booking (if present)
    preReviewWhoColumn: 'pre_screen_intake_review.who',
    linkMinutes: 60,
    signinCode: false,             // TRUE: the sign-in email also carries a 6-digit code, typed on the page that asked (for iPhone email apps)
    linkBrowserCheck: 'log',       // sign-in link opened in another browser than the one that asked: off | log (record in _SignIns) | enforce (offer a fresh link)
    intakeLinkHours: 6,           // "Start your Proposal" link (address not on file) lasts this long (max 6, CacheService)
    parentsSignIn: false,         // FALSE: only the Scout's email signs in; parent/guardian addresses are copied on emails only (Jim W. 2026-10-28)
    sessionDays: 14,
    committeeSessionDays: 30,     // sign-ins of Committee tab members last longer (they use the schedule page often)
    councilDomain: '',            // staging/production menu items require an account in this domain, e.g. the Council's (blank = no check)
    allowProduction: false,       // migration/apply refuses production sheets (not "Test Copy" / "STAGING") unless TRUE
    webOrigin: '',                // e.g. https://<project>.web.app (M2: links in emails)
    onlineBooking: 'Pre-Review Call',   // types Scouts book online; others scheduled the old way. "all" / "none" / list
    reservedForUnits: 'Off',      // reserved slots on the unit page: Off (committee only) | See | Assign. Only Off is built (reserved-slots-design.md)
    digestHours: '6 PM',          // committee digest: "6 PM", "6 AM, 6 PM", blank/off = none (Pacific time)
    // Committee schedule page: defaults for new slots (all editable in the form)
    intakeMinutes: 20,            // Pre-Review Call length
    reviewMinutes: 60,            // Proposal Review length
    eborMinutes: 90,              // EBoR length
    defaultStartTime: '7:00 PM',  // start time when a member clicks a day
    defaultLocation: '',          // e.g. the YMCA (Proposal Review, EBoR)
    defaultAddress: '',
    digestTo: '',                 // digest recipients; blank = committeeGroupEmail
    // Council or District Project Approval Representative (= District Advancement Chair), as it must appear on the
    // Proposal's Contact Information page. Kept here so a new chair = a Settings edit, not a code change.
    approvalRepName: '',
    approvalRepPhone: '',
    approvalRepEmail: '',
    approvalRepAddress: '',
    approvalRepCity: '',
    approvalRepState: '',
    approvalRepZip: ''
  };

  // Section keys are stored in the hidden _key column as "S:<key>".
  // Order = top-to-bottom order on the tracking tab.
  // Names = Jim W.'s standardized states (10/20). Keys: <stage>_<status> (stable; never shown).
  // aliases = older header texts (production before the cutover, Sunday's demo): the migration and Setup
  // recognize them (prefix match) and Setup renames the header row to the label.
  // Three "Scout must fix something" stages: proposal_incomplete (before the Intake Review / Pre-Review Call),
  // intake_revisions (after it, before the In-Person Review), proposal_revisions (after the review, before approval).
  var DEFAULT_SECTIONS = [
    { key: 'proposal_received', label: 'Proposal Received', aliases: ['New Submissions'],
      scoutStatus: 'Received; the committee will look at your Proposal soon', order: 5 },
    { key: 'proposal_incomplete', label: 'Proposal Incomplete', aliases: ['Something missing'],
      scoutStatus: 'Received; the committee is checking your Proposal', order: 30 },
    { key: 'intake_to_book', label: 'Intake Review: To Book', aliases: ['Pre-Review Call'],
      scoutStatus: 'Book your Pre-Review Call', order: 40 },
    { key: 'intake_booked', label: 'Intake Review: Booked', aliases: ['Pre-Review Call Scheduled'],
      scoutStatus: 'Pre-Review Call booked', order: 44 },
    { key: 'intake_revisions', label: 'Revisions Requested for Review', aliases: ['Proposal Awaiting Update'],
      scoutStatus: 'Update requested: please upload your updated Proposal on this page', order: 47 },
    { key: 'review_to_book', label: 'In-Person Review: To Book', aliases: ['Proposals Pending Review Date'],
      scoutStatus: 'Book your Proposal Review', order: 50 },
    { key: 'review_booked', label: 'In-Person Review: Booked', aliases: ['Proposal Reviews scheduled'],
      scoutStatus: 'Proposal Review booked', order: 60 },
    { key: 'proposal_revisions', label: 'Proposal Revisions Requested', aliases: ['Proposal awaiting revisions'],
      scoutStatus: 'Revisions requested; send an update when ready', order: 70 },
    { key: 'proposal_approved', label: 'Proposal Approved', aliases: ['Approved Proposals'],
      scoutStatus: 'Proposal approved', order: 80 },
    { key: 'app_submitted', label: 'Application Submitted', aliases: ['Submitted Eagle Applications'],
      scoutStatus: 'Eagle application submitted; waiting for Council verification', order: 90 },
    { key: 'app_verified', label: 'Application Verified', aliases: [],
      scoutStatus: 'Eagle application verified: book your Eagle Board of Review', order: 92 },
    { key: 'ebor_booked', label: 'EBoR Booked', aliases: ['EBoR Scheduled'],
      scoutStatus: 'Eagle Board of Review booked', order: 94 },
    // Added 10/20 (committee chair): board adjourned/continued; the Scout has something to complete.
    { key: 'ebor_paused', label: 'EBoR Paused', aliases: ['Paused EBoR'],
      scoutStatus: 'Eagle Board of Review paused; the committee will contact you about next steps', order: 95 },
    { key: 'eagle_earned', label: 'Eagle Earned', aliases: [],
      scoutStatus: 'Eagle Scout: congratulations!', order: 96 },
    { key: 'eagle_not_awarded', label: 'Eagle Not Awarded', aliases: ['Eagle Rank Not Awarded'],
      scoutStatus: 'The committee will contact you about next steps', order: 190 },
    { key: 'beyond_age', label: 'Beyond Age: Special Needs', aliases: ['Beyond Age of Eligibility'],
      scoutStatus: 'Under committee review', order: 200 },
    { key: 'proposal_not_approved', label: 'Proposal Not Approved', aliases: ['Unapproved Proposals', 'Denied Proposals'],
      scoutStatus: 'Received; the committee is looking at your Proposal', order: 210 },
    // Terminal, visible, reversible (Jim W., 2026-11-10; lib/closing.js): withdrew, aged out, extension denied...
    { key: 'closed', label: 'Closed', aliases: [],
      scoutStatus: 'Your record is closed. Questions? Reply to the committee.', order: 220 }
  ];

  function toBool(v, fallback) {
    if (v === true || v === false) return v;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (['true', 'yes', 'on', '1', 'y'].indexOf(s) >= 0) return true;
    if (['false', 'no', 'off', '0', 'n'].indexOf(s) >= 0) return false;
    return fallback;
  }

  function toNum(v, fallback) {
    var n = Number(v);
    return (v === '' || v == null || isNaN(n)) ? fallback : n;
  }

  /** values: 2D array from Settings!A1:G (getValues). */
  function parse(values) {
    var out = {};
    var k;
    for (k in DEFAULT_VALUES) out[k] = DEFAULT_VALUES[k];
    var sections = [];
    var seenSettingRow = false;

    (values || []).forEach(function (row, i) {
      if (i === 0) return; // header row
      var key = String(row[0] == null ? '' : row[0]).trim();
      if (key) {
        seenSettingRow = true;
        var raw = row[1];
        var def = DEFAULT_VALUES[key];
        if (typeof def === 'boolean') out[key] = toBool(raw, key === 'testMode' ? true : def);
        else if (typeof def === 'number') out[key] = toNum(raw, def);
        else if (raw instanceof Date) out[key] = raw.getHours() + ':' + (raw.getMinutes() < 10 ? '0' : '') + raw.getMinutes();  // "6 PM" typed into a cell becomes a time
        else out[key] = raw == null ? '' : String(raw).trim();
      }
      var sKey = String(row[3] == null ? '' : row[3]).trim();
      if (sKey) {
        var def = DEFAULT_SECTIONS.filter(function (d) { return d.key === sKey; })[0];
        sections.push({
          key: sKey,
          aliases: def ? def.aliases.concat([def.label]) : [],
          label: String(row[4] == null ? '' : row[4]).trim(),
          scoutStatus: String(row[5] == null ? '' : row[5]).trim(),
          order: toNum(row[6], 999)
        });
      }
    });

    out.sections = sections.length ? sections.sort(function (a, b) { return a.order - b.order; })
                                   : DEFAULT_SECTIONS.slice();
    out._empty = !seenSettingRow;
    return out;
  }

  /** Rows to write into a fresh Settings tab (A:G). */
  function defaultRows(overrides) {
    var vals = {};
    var k;
    for (k in DEFAULT_VALUES) vals[k] = DEFAULT_VALUES[k];
    for (k in (overrides || {})) vals[k] = overrides[k];
    var keys = Object.keys(vals);
    var n = Math.max(keys.length, DEFAULT_SECTIONS.length) + 1;
    var rows = [];
    for (var i = 0; i < n; i++) rows.push(['', '', '', '', '', '', '']);
    rows[0] = ['Key', 'Value', '', 'Section key', 'Label (starts with)', 'Scout status', 'Order'];
    keys.forEach(function (key, i) { rows[i + 1][0] = key; rows[i + 1][1] = vals[key]; });
    DEFAULT_SECTIONS.forEach(function (s, i) {
      rows[i + 1][3] = s.key; rows[i + 1][4] = s.label; rows[i + 1][5] = s.scoutStatus; rows[i + 1][6] = s.order;
    });
    return rows;
  }

  /** Labels offered in the Action ("move to") dropdown, top-to-bottom order. */
  function actionOptions(settings) {
    return (settings.sections || []).map(function (s) { return s.label; }).filter(Boolean);
  }

  var CURRENT_MARK = '● ';
  var CURRENT_SUFFIX = '  (here now)';

  /**
   * Per-row Action list: every section in sheet order, the row's CURRENT
   * section marked, so the natural next step is the item just below it.
   */
  function actionOptionsFor(settings, currentKey) {
    return (settings.sections || []).filter(function (s) { return s.label; }).map(function (s) {
      return s.key === currentKey ? CURRENT_MARK + s.label + CURRENT_SUFFIX : s.label;
    });
  }

  /** Extra item at the bottom of a Scout row's Action dropdown (runs as the trigger owner, not the clicker). */
  // One item for every stage (Jim W., 10/20): in a "To Book" stage it sends the booking email, otherwise a status
  // email; both link to the sign-in page, where the Scout's page shows what to do next. Not offered in the closed stages.
  var RESEND_LINK = '✉ Email status + page link';
  var NO_STATUS_EMAIL = ['eagle_earned', 'eagle_not_awarded'];
  // "Whose move" (state-model-v3): clears _pending_since without moving the row or sending anything.
  var CHECKED = '✓ Checked: nothing to do';
  function isChecked(value) { return String(value == null ? '' : value).trim() === CHECKED; }
  function isResendLink(value) { var v = String(value == null ? '' : value).trim(); return v === RESEND_LINK || v === '↻ Resend booking link'; }
  function offersStatusEmail(sectionKey) { return !!sectionKey && NO_STATUS_EMAIL.indexOf(sectionKey) < 0; }

  /** Action dropdown on a SECTION label row: tools for that section, not moves (Jim W., 2026-10-19). */
  var SECTION_ACTIONS = [{ id: 'sort_age', label: 'Sort by age (oldest first)' }];
  function sectionActionOptions() { return SECTION_ACTIONS.map(function (a) { return a.label; }); }
  function sectionActionFor(value) {
    var v = String(value == null ? '' : value).trim().toLowerCase();
    var hit = SECTION_ACTIONS.filter(function (a) { return a.label.toLowerCase() === v; })[0];
    return hit ? hit.id : null;
  }

  /** Action cell value -> section key (exact label, case-insensitive) or null. */
  function sectionForAction(settings, value) {
    var v = String(value == null ? '' : value).trim();
    if (v.indexOf(CURRENT_MARK.trim()) === 0) v = v.slice(CURRENT_MARK.trim().length);
    v = v.replace(/\s*\(here now\)\s*$/, '').trim().toLowerCase();
    if (!v) return null;
    var hit = (settings.sections || []).filter(function (s) { return String(s.label).toLowerCase() === v; })[0];
    return hit ? hit.key : null;
  }

  function sectionLabel(settings, key) {
    var hit = (settings.sections || []).filter(function (s) { return s.key === key; })[0];
    return hit ? hit.label : key;
  }

  /**
   * What the Scout's page offers at each stage (Jim W., 2026-10-12):
   *  'proposal' files + update form + booking; 'ebor' EBoR booking + others to invite; 'status' status only.
   */
  var EBOR_SECTIONS = ['app_verified', 'ebor_booked'];
  var STATUS_ONLY = ['proposal_approved', 'app_submitted', 'beyond_age', 'ebor_paused', 'eagle_earned', 'eagle_not_awarded', 'closed'];
  function pagePhase(sectionKey) {
    if (EBOR_SECTIONS.indexOf(sectionKey) >= 0) return 'ebor';
    if (STATUS_ONLY.indexOf(sectionKey) >= 0) return 'status';
    return 'proposal';
  }

  function scoutStatusFor(settings, sectionKey) {
    var s = (settings.sections || []).filter(function (x) { return x.key === sectionKey; })[0];
    return s ? s.scoutStatus : 'Under committee review';
  }

  return {
    DEFAULT_VALUES: DEFAULT_VALUES,
    DEFAULT_SECTIONS: DEFAULT_SECTIONS,
    parse: parse,
    defaultRows: defaultRows,
    scoutStatusFor: scoutStatusFor,
    actionOptions: actionOptions,
    pagePhase: pagePhase,
    actionOptionsFor: actionOptionsFor,
    sectionForAction: sectionForAction,
    sectionActionOptions: sectionActionOptions,
    RESEND_LINK: RESEND_LINK, CHECKED: CHECKED, isChecked: isChecked,
    isResendLink: isResendLink,
    offersStatusEmail: offersStatusEmail,
    sectionActionFor: sectionActionFor,
    sectionLabel: sectionLabel,
    toBool: toBool
  };
})();

if (typeof module !== 'undefined') module.exports = SettingsModel;
