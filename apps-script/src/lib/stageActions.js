/**
 * StageActions: what a committee member can do to a Scout from the web (dashboard row "Action" button), per stage.
 * Pure. One table so the dashboard, the dialogs and (later) a database share the same rules (Jim W., 2026-10-23).
 *
 * Each action: which sections offer it, which tracking dates it records, where the row moves, which email it sends or
 * drafts, and which column is filled WHEN that email is actually sent (Outbox Send / I sent it). Every action is a
 * committee decision, so it also stops the "new files" clock (state-model-v3).
 *
 * Proposal stages (Jim W., 2026-10-23):
 *   Proposal Received / Incomplete   Complete -> Intake: To Book (booking link) | Incomplete: ask for changes (note email)
 *                                    | Not approved (note email)
 *   Intake: To Book                  Resend booking link | book on the schedule page
 *   Intake: Booked / Revisions Req.  Ready for in-person review -> In-Person: To Book (booking info) | Changes needed
 *                                    before review (note email) | Not approved
 *   In-Person: To Book               Resend booking info | book on the schedule page
 *   In-Person: Booked / Prop. Rev.   Record review outcome (Review page)
 *   Application Verified             Book an EBoR (schedule page) | Resend EBoR next-steps email
 *   EBoR Booked                      Eagle earned (one step: scans + photos, Council + congratulations emails) | EBoR paused (note email)
 *                                    | Eagle not awarded (note email); each records the board's date as EBoR Date
 *   Eagle Earned                     Send signed paperwork to Council (later) | Council received the paperwork
 *   EBoR Paused                      Book an EBoR again (schedule page) | Eagle not awarded without reconvening (note email)
 *   any proposal/EBoR stage          ✓ Checked: nothing to do (only when new files are waiting)
 *   every stage but Eagle Earned     Schedule a follow-up / consult… (opens the schedule page's new-session dialog, create-and-book
 *                                    mode, type Follow-Up / Consult, this Scout; Jim W., 2026-11-11). No row move, no tracking date.
 *
 *   Application submitted  Proposal Approved -> Application Submitted; records the submitted date; acknowledgement (3.1.a) in the Outbox
 *                          (just a heads-up that an EBoR is coming).
 *   Application verified   Application Submitted (or Proposal Approved, when Council's email is the first news)
 *                          -> Application Verified; records the date of Council's email; drafts the EBoR next-steps
 *                          email ("Book: Eagle Board of Review" tab) to Scout, parent and the unit's contacts;
 *                          "Emailed to set up EBoR" is filled when that email is sent.
 *   Review outcome         In-Person Review: Booked / Proposal Revisions Requested -> the Review outcome page.
 */
var StageActions = (function () {
  // Tracking columns by role; the sheet's machine names are found by these patterns (Settings can override).
  var COLUMNS = {
    submitted: { setting: 'appSubmittedColumn', pattern: /(^|\.)application_submitted$/, label: 'Application Submitted' },
    verified: { setting: 'appVerifiedColumn', pattern: /(^|\.)application_verified$/, label: 'Application Verified' },
    emailedEbor: { setting: 'eborEmailedColumn', pattern: /(^|\.)emailed_to_set_up_ebor/, label: 'Emailed to set up EBoR' },
    ebor: { setting: 'eborDateColumn', pattern: /(^|\.)ebor_date$/, label: 'EBoR Date' },
    signedSent: { setting: 'signedSentColumn', pattern: /^signed[^.]*\.date$/, label: 'Signed paperwork sent to Council' },
    svmbcReceived: { setting: 'svmbcReceivedColumn', pattern: /(^|\.)svmbc_received$/, label: 'SVMBC Received' }
  };

  var PRE_INTAKE = ['proposal_received', 'proposal_incomplete'];
  var AFTER_CALL = ['intake_booked', 'intake_revisions'];
  var PROPOSAL_STAGES = ['proposal_received', 'proposal_incomplete', 'intake_to_book', 'intake_booked', 'intake_revisions',
    'review_to_book', 'review_booked', 'proposal_revisions', 'proposal_approved', 'app_submitted', 'app_verified', 'ebor_booked'];

  var EXCEPTIONS = ['ebor_paused', 'eagle_not_awarded', 'beyond_age', 'proposal_not_approved'];   // lib/closing.js FROM_SECTIONS
  var CLOSE_REVIEW = ['proposal_not_approved', 'ebor_paused'];                                   // lib/closing.js REVIEW_SECTIONS
  // Follow-Up / Consult: every stage except Eagle Earned (same list as CommitteeSchedule.FOLLOWUP_SECTIONS; a test keeps them equal)
  var FOLLOWUP_STAGES = PROPOSAL_STAGES.filter(function (k) { return k !== 'eagle_earned'; }).concat(EXCEPTIONS, ['closed']);

  // email: 'note' = the member's note goes into the email (draft always in the Outbox); booking: the "Book: <type>"
  // email (online type: as the sheet's Action does, template Mode decides; not online: Outbox draft with {scheduleLink}).
  var ACTIONS = [
    // Committee check of a (re)submission, before the Pre-Review Call
    { key: 'intake_ok', label: 'Complete: invite to book a Pre-Review Call', sections: PRE_INTAKE, to: 'intake_to_book', booking: 'Intake',
      past: 'Proposal complete: invited to book a Pre-Review Call' },
    { key: 'incomplete', label: 'Incomplete: ask for changes…', sections: PRE_INTAKE, to: 'proposal_incomplete', template: 'Proposal incomplete',
      email: 'note', past: 'Proposal incomplete: changes requested' },
    { key: 'resend_intake', label: 'Resend booking link', sections: ['intake_to_book'], booking: 'Intake', past: 'Pre-Review Call booking link resent' },
    { key: 'book_intake', label: 'Book a Pre-Review Call (schedule)…', sections: ['intake_to_book'], page: '/committee/schedule' },
    // Outcome of the Pre-Review Call (or check of the update that followed it)
    { key: 'review_ok', label: 'Ready for in-person review', sections: AFTER_CALL, to: 'review_to_book', booking: 'ESSPPR',
      past: 'Ready for the in-person Proposal Review' },
    { key: 'intake_revisions', label: 'Changes needed before review…', sections: AFTER_CALL, to: 'intake_revisions',
      template: 'Revisions before review', email: 'note', past: 'Changes requested before the in-person review' },
    { key: 'resend_review', label: 'Resend booking info', sections: ['review_to_book'], booking: 'ESSPPR', past: 'Proposal Review booking info resent' },
    { key: 'book_review', label: 'Book a Proposal Review (schedule)…', sections: ['review_to_book'], page: '/committee/schedule' },
    // In-person Proposal Review
    { key: 'review_outcome', label: 'Record review outcome…', sections: ['review_booked', 'proposal_revisions'], page: '/committee/review' },
    // Before the in-person review: the project can't be approved
    { key: 'not_approved', label: 'Not approved…', sections: PRE_INTAKE.concat(AFTER_CALL), to: 'proposal_not_approved',
      template: 'Proposal not approved', email: 'note', past: 'Proposal not approved' },
    // Eagle application
    { key: 'app_submitted', label: 'Application submitted…', sections: ['proposal_approved'], to: 'app_submitted',
      dateRole: 'submitted', dateLabel: 'Date the application was submitted', past: 'Eagle application submitted',
      template: 'Application submitted: acknowledgement' },
    { key: 'app_verified', label: 'Application verified…', sections: ['app_submitted', 'proposal_approved'], to: 'app_verified',
      dateRole: 'verified', dateLabel: 'Date of Council\'s "verified" email', fillIfEmpty: 'submitted', past: 'Eagle application verified by Council',
      template: 'Book: Eagle Board of Review', toUnit: true, onSent: 'emailedEbor' },
    // Application Verified: the Scout books the EBoR (online later); until then a member books it on the schedule page
    { key: 'book_ebor', label: 'Book an EBoR (schedule)…', sections: ['app_verified', 'ebor_paused'], page: '/committee/schedule' },
    { key: 'resend_ebor', label: 'Resend EBoR next-steps email', sections: ['app_verified'], past: 'EBoR next-steps email drafted again',
      template: 'Book: Eagle Board of Review', toUnit: true, onSent: 'emailedEbor' },
    // EBoR outcome (the board's date: default the row's EBoR date)
    // Eagle earned in one step: signed scans -> folder + Council email; photos -> "EBoR Photos" + congratulations email.
    { key: 'eagle_earned', label: 'Eagle earned…', sections: ['ebor_booked'], to: 'eagle_earned', dateRole: 'ebor', dateDefault: 'ebor',
      dateLabel: 'Date of the Board of Review', past: 'Eagle Board of Review: Eagle Scout rank earned', template: 'New Eagle Scout',
      eagleDone: true, paint: 'ebor', files: ['application', 'report', 'photo'] },
    { key: 'paperwork', label: 'Send signed paperwork to Council…', sections: ['eagle_earned'], ifNot: 'councilSent', past: 'Signed EBoR paperwork filed for Council',
      eagleDone: true, files: ['application', 'report'], requireFiles: ['application', 'report'] },
    { key: 'svmbc_received', label: 'Council received the paperwork', sections: ['eagle_earned'], setTrue: 'svmbcReceived', ifCouncil: true,
      past: 'Council (SVMBC) acknowledged receipt of the EBoR paperwork' },
    { key: 'ebor_paused', label: 'EBoR paused…', sections: ['ebor_booked'], to: 'ebor_paused', dateRole: 'ebor', dateDefault: 'ebor',
      dateLabel: 'Date of the Board of Review', past: 'Eagle Board of Review paused', template: 'EBoR paused', email: 'note',
      noteLabel: 'What must be completed before the board reconvenes?' },
    { key: 'eagle_not_awarded', label: 'Eagle not awarded…', sections: ['ebor_booked'], to: 'eagle_not_awarded', dateRole: 'ebor', dateDefault: 'ebor',
      dateLabel: 'Date of the Board of Review', past: 'Eagle Board of Review: rank not awarded', template: 'Eagle not awarded', email: 'note',
      noteLabel: 'Reasons (as the board agreed to state them)' },
    // EBoR Paused: normally booked again (above); sometimes ends without reconvening. No new board date: the email
    // refers to the board's date already on the row.
    { key: 'paused_not_awarded', label: 'Eagle not awarded (no reconvening)…', sections: ['ebor_paused'], to: 'eagle_not_awarded',
      past: 'Eagle not awarded (board did not reconvene)', template: 'Eagle not awarded', email: 'note', emailDate: 'ebor',
      noteLabel: 'Reasons (as the board agreed to state them)' },
    // New files looked at, nothing to change (only on rows with new files waiting)
    { key: 'checked', label: '✓ Checked: nothing to do', sections: PROPOSAL_STAGES, ifPending: true, past: 'New files checked (no change)' },
    // Closed records (Jim W., 2026-11-10; lib/closing.js, closingActions.js): no email, folder stays put
    { key: 'close', label: 'Close record…', sections: EXCEPTIONS, closing: 'close', dateLabel: 'Date closed', past: 'Record closed' },
    { key: 'keep_open', label: 'Keep open (hide "Close?")', sections: CLOSE_REVIEW, closing: 'keep', ifSuggest: true, past: 'Kept open' },
    { key: 'reopen', label: 'Reopen…', sections: ['closed'], closing: 'reopen', past: 'Record reopened' },
    // Follow-Up / Consult (2026-11-11): a page action; the schedule page opens its dialog with this Scout and the type chosen
    { key: 'followup', label: 'Schedule a follow-up / consult…', sections: FOLLOWUP_STAGES, page: '/committee/schedule', pageQuery: 'new=Followup' }
  ];

  var FILE_LABELS = { application: 'signed Eagle Scout Rank Application (PDF)', report: 'signed Advancement Report (PDF)', photo: 'EBoR photos' };

  function str(v) { return v == null ? '' : String(v).trim(); }

  /** cols: machine names on the tracking tab; settings: Settings. -> {role: machine name or ''} */
  function resolveColumns(cols, settings) {
    var out = {};
    Object.keys(COLUMNS).forEach(function (role) {
      var c = COLUMNS[role], set = str(settings && settings[c.setting]);
      out[role] = set && cols.indexOf(set) >= 0 ? set : (cols.filter(function (n) { return c.pattern.test(n); })[0] || '');
    });
    return out;
  }

  function get(key) { return ACTIONS.filter(function (a) { return a.key === key; })[0] || null; }

  /** Actions offered for a section, as {key, label, page?, dateLabel?}. */
  function forSection(sectionKey) {
    return ACTIONS.filter(function (a) { return a.sections.indexOf(sectionKey) >= 0; }).map(function (a) {
      var o = { key: a.key, label: a.label };
      if (a.page) { o.page = a.page; if (a.pageQuery) o.pageQuery = a.pageQuery; return o; }
      if (a.dateLabel) o.dateLabel = a.dateLabel;
      if (a.dateDefault) o.dateDefault = a.dateDefault;
      if (a.ifPending) o.ifPending = true;
      if (a.closing) { o.closing = a.closing; if (a.ifSuggest) o.ifSuggest = true; }   // handled by closingActions.js
      if (a.ifCouncil) o.ifCouncil = true;          // only rows waiting on Council's acknowledgement
      if (a.ifNot) o.ifNot = a.ifNot;               // hidden when the row already has it (e.g. paperwork sent)
      if (a.email === 'note') o.noteToEmail = true;
      if (a.noteLabel) o.noteLabel = a.noteLabel;
      if (a.files) { o.files = a.files; o.requireFiles = a.requireFiles || []; }
      o.emailHint = emailHint(a);
      return o;
    });
  }

  /** What the dialog says about the email. */
  function emailHint(a) {
    if (a.toUnit) return 'Saving drafts the email to the Scout, parent and unit contacts in the Outbox, where you check it and send it.' +
      (a.onSent === 'emailedEbor' ? ' The "Emailed to set up EBoR" date is filled in when it is sent.' : '');
    if (a.email === 'note') return 'Saving drafts the email to the Scout and parent in the Outbox, with your note as the list of changes; check it and send it there.';
    if (a.closing === 'close') return 'No email is sent (use Email… if the family should hear from you). The row moves to Closed and the folder stays where it is; Reopen puts it back.';
    if (a.closing === 'keep') return 'No email is sent. The "Close?" suggestion is hidden for a while (Settings → closeSnoozeDays).';
    if (a.closing === 'reopen') return 'No email is sent. The row goes back to the stage you pick, and the reason goes into the log.';
    if (a.key === 'eagle_earned') return 'Saving files the scans and photos in the Scout\'s folder, paints the EBoR date green, and drafts two emails in the Outbox: ' +
      'the signed paperwork to Council (with the scans) and the congratulations to the Scout, family, unit and board (with the photos). Replies go to you.';
    if (a.key === 'paperwork') return 'Saving files the scans and drafts the email to Council with both attached in the Outbox. "Signed paperwork sent" is filled in when it is sent.';
    if (a.booking) return 'Saving sends the booking email to the Scout and parent (or drafts it in the Outbox, if its template is set to Review or the type is not booked online yet).';
    return 'No email is sent.';
  }

  /** {section key: [actions]} for every section that has any (sent to the dashboard once). */
  function bySection(sectionKeys) {
    var out = {};
    (sectionKeys || []).forEach(function (k) { var l = forSection(k); if (l.length) out[k] = l; });
    return out;
  }

  function nice(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
    return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : str(ymd);
  }

  /**
   * input: {action, section, date, today, dates: {role: 'YYYY-MM-DD' already on the row}, cols: {role: machine name}}
   * -> {errors, warnings, set: {role: 'YYYY-MM-DD'}, to}
   */
  function plan(input) {
    var a = get(input.action), errors = [], warnings = [], set = {};
    if (!a || a.page) return { errors: ['Unknown action.'], warnings: [], set: set, to: null };
    if (a.sections.indexOf(input.section) < 0) errors.push('This Scout is no longer at a stage where "' + a.label.replace(/…$/, '') + '" applies. Reload the page.');
    var to = a.to && a.to !== input.section ? a.to : null;
    if (a.ifPending && !input.pending) errors.push('There are no new files waiting for this Scout. Reload the page.');
    if (a.email === 'note' && !str(input.note)) warnings.push('No note: the email will not say what to change. Add a note, or write it in the Outbox before sending.');
    if (a.setTrue && !(input.cols || {})[a.setTrue]) errors.push('The tracking tab has no "' + COLUMNS[a.setTrue].label + '" column (Settings → ' + COLUMNS[a.setTrue].setting + ').');
    (a.requireFiles || []).forEach(function (k) { if ((input.files || []).indexOf(k) < 0) errors.push('Add the ' + FILE_LABELS[k] + '.'); });
    if (a.key === 'eagle_earned' && input.files) {
      var hasApp = input.files.indexOf('application') >= 0, hasRep = input.files.indexOf('report') >= 0;
      if (hasApp !== hasRep) errors.push('Add both signed scans (application and Advancement Report), or neither (send them later from the Eagles tab).');
      else if (!hasApp) warnings.push('No signed scans: the Council email is not drafted. Send them later with "Send signed paperwork to Council…" on the Eagles tab.');
      if (input.files.indexOf('photo') < 0) warnings.push('No photos: the congratulations email goes without pictures.');
    }
    if (!a.dateRole) return { errors: errors, warnings: errors.length ? [] : warnings, set: set, to: to };
    var d = str(input.date), dates = input.dates || {}, cols = input.cols || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('Pick the date.');
    else if (input.today && d > input.today) errors.push('The date can\'t be in the future.');
    if (!cols[a.dateRole]) errors.push('The tracking tab has no "' + COLUMNS[a.dateRole].label + '" column (Settings → ' + COLUMNS[a.dateRole].setting + '). Ask the admin.');
    if (errors.length) return { errors: errors, warnings: warnings, set: set, to: to };
    var cur = str(dates[a.dateRole]);
    if (cur && cur !== d) warnings.push('The row already has ' + COLUMNS[a.dateRole].label + ' ' + nice(cur) + '. It will be changed to ' + nice(d) + '.');
    set[a.dateRole] = d;
    if (a.fillIfEmpty && cols[a.fillIfEmpty]) {
      var other = str(dates[a.fillIfEmpty]);
      if (!other) {
        set[a.fillIfEmpty] = d;
        warnings.push('No ' + COLUMNS[a.fillIfEmpty].label + ' date on the row: it will be set to ' + nice(d) + ' too.');
      } else if (other > d) {
        warnings.push(COLUMNS[a.fillIfEmpty].label + ' (' + nice(other) + ') is after ' + nice(d) + '. Check the dates.');
      }
    }
    if (a.onSent && !cols[a.onSent]) warnings.push('No "' + COLUMNS[a.onSent].label + '" column found: the date the email is sent won\'t be recorded.');
    return { errors: errors, warnings: warnings, set: set, to: to };
  }

  /** Log line: "10/23 [AB] Eagle application verified by Council (10/22/2026). Note: ..." */
  function logLine(shortDate, by, action, date, note) {
    var a = get(action);
    var n = str(note).replace(/\s+/g, ' ');
    return shortDate + ' [' + (str(by) || 'committee') + '] ' + (a ? a.past : action) + (date && a && a.dateRole ? ' (' + nice(date) + ')' : '') +
      (n ? '. Note: ' + n : '');
  }

  return { FILE_LABELS: FILE_LABELS, COLUMNS: COLUMNS, ACTIONS: ACTIONS, resolveColumns: resolveColumns, get: get, forSection: forSection,
    bySection: bySection, plan: plan, logLine: logLine, nice: nice };
})();

if (typeof module !== 'undefined') module.exports = StageActions;
