/**
 * SettingsView (Jim W., 2026-11-12; plan: vault admin-ui-plan.md): the Settings tab grouped for the Admin page's
 * Settings sub-tab, with a short help line per key, and who may see it (the Admin role). Pure.
 *
 * Step 2 of the plan shows everything read-only; editing comes group by group (District details and Scheduling
 * first). "Internal wiring" stays read-only for good: IDs and column names are set by Setup / repair or by hand.
 */
var SettingsView = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function B() { return (typeof Booking !== 'undefined') ? Booking : require('./booking'); }
  function D() { return (typeof Digest !== 'undefined') ? Digest : require('./digest'); }
  function N() { return (typeof Nudges !== 'undefined') ? Nudges : require('./nudges'); }

  // Groups an Admin can edit on the page. Test mode and Internal wiring stay on the sheet (a wrong click there sends
  // real email or breaks production); stage labels too (renaming one renames a tracking-tab section header).
  var EDITABLE = ['district', 'scheduling', 'reminders', 'intake', 'signin'];
  var EMAIL_KEYS = { councilEaglesEmail: 1, approvalRepEmail: 1, committeeGroupEmail: 1, replyTo: 1, adminEmail: 1 };
  var EMAIL_LISTS = { digestTo: 1 };
  var ENUMS = { reservedForUnits: ['Off', 'See', 'Assign'], linkBrowserCheck: ['off', 'log', 'enforce'] };
  // [min, max] for numbers (default: 0 and up; *Minutes keys 5 to 600).
  var RANGES = { maxUploadMB: [1, 50], intakeLinkHours: [1, 6], intakeConfirmDays: [1, 60], intakePurgeDays: [1, 365],
    linkMinutes: [5, 1440], sessionDays: [1, 365], committeeSessionDays: [1, 365], eborReminderDays: [0, 30],
    signingNudgeDays: [1, 60], signatureDays: [1, 60], closeReviewDays: [30, 1095], closeSnoozeDays: [7, 730], councilAckDays: [1, 90] };
  var MUST_HAVE = { committeeGroupEmail: 1, adminEmail: 1 };   // the tool can't work without these

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
      ['signingNudgeDays', 'Proposal signatures (and EBoR paperwork signatures) waiting this many days: listed in the digest'],
      ['signatureDays', 'EBoR paperwork signed outside the room: each signer\'s request stays open this many days'],
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
      return { key: key, value: value, def: def, isDefault: value === def, help: help || '', link: link, type: typeOf(key, d) };
    };
    var groups = GROUPS.map(function (g) {
      return { id: g.id, label: g.label, who: g.who, editable: EDITABLE.indexOf(g.id) >= 0,
        items: g.keys.map(function (k) { return item(k[0], k[1]); }) };
    });
    var other = Object.keys(s).filter(function (k) { return !listed[k] && k !== 'sections' && k.charAt(0) !== '_'; }).sort()
      .map(function (k) { return item(k, ''); });
    if (other.length) groups.push({ id: 'other', label: 'Other (not grouped yet)', who: '', items: other });
    var sections = (s.sections || []).map(function (x) { return { key: x.key, label: x.label, scoutStatus: x.scoutStatus, order: x.order }; });
    return { groups: groups, sections: sections };
  }

  /** 'number' | 'boolean' | 'email' | 'enum' | 'time' | 'text' (what the page shows as an input). */
  function typeOf(key, defaults) {
    var def = (defaults || {})[key];
    if (typeof def === 'number') return 'number';
    if (typeof def === 'boolean') return 'boolean';
    if (EMAIL_KEYS[key]) return 'email';
    if (EMAIL_LISTS[key]) return 'emails';
    if (ENUMS[key]) return 'enum';
    if (key === 'defaultStartTime') return 'time';
    return 'text';
  }

  /** {h, m} -> "7:00 PM". */
  function timeText(t) {
    var h = t.h % 12 || 12;
    return h + ':' + (t.m < 10 ? '0' : '') + t.m + ' ' + (t.h < 12 ? 'AM' : 'PM');
  }

  /**
   * An Admin's edits to one group (Jim W., 2026-11-12). values: {key: text | boolean} as typed; was: {key: text} as
   * the page showed them (someone else's change in between = an error, not an overwrite); current: getSettings_();
   * defaults: SettingsModel.DEFAULT_VALUES.
   * -> {changes: [{key, from, to}], errors: [{key, message}]}   (to: the value to write, normalized)
   */
  function validate(groupId, values, was, current, defaults) {
    var g = GROUPS.filter(function (x) { return x.id === groupId; })[0];
    var changes = [], errors = [];
    if (!g || EDITABLE.indexOf(groupId) < 0) return { changes: [], errors: [{ key: '', message: 'That group can\'t be edited here.' }] };
    var inGroup = {};
    g.keys.forEach(function (k) { inGroup[k[0]] = true; });
    Object.keys(values || {}).forEach(function (key) {
      if (!inGroup[key]) { errors.push({ key: key, message: key + ' is not in ' + g.label + '.' }); return; }
      var now = show((current || {})[key]);
      if (was && Object.prototype.hasOwnProperty.call(was, key) && str(was[key]) !== now) {
        errors.push({ key: key, message: key + ' was changed by someone else (now "' + now + '"). Reload the page.' });
        return;
      }
      var type = typeOf(key, defaults), raw = values[key], to;
      if (type === 'boolean') to = raw === true || /^(true|yes|1)$/i.test(str(raw));
      else {
        var t = str(raw);
        if (t.length > 300) { errors.push({ key: key, message: key + ': too long.' }); return; }
        var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (type === 'number') {
          var n = Number(t);
          var range = RANGES[key] || (/Minutes$/.test(key) ? [5, 600] : [0, Infinity]);
          if (t === '' || !isFinite(n) || n < range[0] || n > range[1]) {
            errors.push({ key: key, message: key + ': a number' + (range[1] === Infinity ? ', ' + range[0] + ' or more.' : ' from ' + range[0] + ' to ' + range[1] + '.') });
            return;
          }
          to = n;
        } else if (type === 'email') {
          if (!t && MUST_HAVE[key]) { errors.push({ key: key, message: key + ': can\'t be blank.' }); return; }
          if (t && !EMAIL_RE.test(t)) { errors.push({ key: key, message: key + ': not an email address.' }); return; }
          to = t.toLowerCase();
        } else if (type === 'emails') {
          var list = t.split(/[\s,;]+/).filter(Boolean);
          var badE = list.filter(function (e) { return !EMAIL_RE.test(e); });
          if (badE.length) { errors.push({ key: key, message: key + ': not an email address: ' + badE.join(', ') + '.' }); return; }
          to = list.map(function (e) { return e.toLowerCase(); }).join(', ');
        } else if (type === 'enum') {
          var hit = ENUMS[key].filter(function (o) { return o.toLowerCase() === t.toLowerCase(); })[0];
          if (!hit) { errors.push({ key: key, message: key + ': one of ' + ENUMS[key].join(', ') + '.' }); return; }
          to = hit;
        } else if (type === 'time') {
          var p = B().parseTime(t);
          if (!p) { errors.push({ key: key, message: key + ': a time like 7:00 PM.' }); return; }
          to = timeText(p);
        } else {
          if (key === 'onlineBooking') { var ob = B().parseOnline(t); if (ob.error) { errors.push({ key: key, message: ob.error }); return; } }
          if (key === 'digestHours') { var dh = D().parseHours(t); if (dh.error) { errors.push({ key: key, message: dh.error }); return; } }
          if (key === 'pleaseBookDays') { var pb = N().parseBookDays(t); if (pb.errors.length) { errors.push({ key: key, message: pb.errors.join(' ') }); return; } }
          to = t;
        }
      }
      if (show(to) !== now) changes.push({ key: key, from: now, to: to });
    });
    return { changes: errors.length ? [] : changes, errors: errors };
  }

  /** The Admin role: Role "Admin" on the Committee tab, or the Settings adminEmail (so there is always one). */
  /** Kept for callers; the rule lives in lib/access.js (Admin, Support, or Settings adminEmail). */
  function isAdmin(member, email, settings) {
    var A = (typeof Access !== 'undefined') ? Access : require('./access');
    return A.isAdmin(member, email, settings);
  }

  return { GROUPS: GROUPS, EDITABLE: EDITABLE, view: view, isAdmin: isAdmin, validate: validate, typeOf: typeOf };
})();

if (typeof module !== 'undefined') module.exports = SettingsView;
