/**
 * TemplateCatalog: every email that can come from the template Doc (one tab each), with its
 * placeholders and the starting wording (today's built-in text). Pure.
 *
 * key = tab title. cls: A automatic (Scout/parent/unit acted) | B committee-triggered (Outbox later).
 * The code keeps its built-in wording as the fallback when the Doc or a tab is missing.
 */
var TemplateCatalog = (function () {
  var SIGN = ['', 'Coyote Creek District Advancement Committee'];
  var ADULT = 'Youth protection: a parent/guardian or another adult 21 or older must be with the Scout for the whole call.';
  var ADULT_IN_PERSON = 'Youth protection: a parent/guardian or another adult 21 or older must come with the Scout to the review.';
  var TYPES = { Intake: 'Pre-Review Call', ESSPPR: 'Proposal Review', EBoR: 'Eagle Board of Review' };

  function t(key, cls, vars, subject, body, cc, mode) {
    return { key: key, cls: cls, vars: vars, subject: subject, body: body.concat(SIGN), cc: cc || 'group', mode: mode || 'automatic' };
  }

  var LIST = [
    t('Sign-in link', 'A', ['link', 'minutes', 'code'], 'Your Coyote Creek Eagle sign-in link', [
      'Use this link to sign in to the Coyote Creek District Eagle Project page:', '', '{link}', '',
      // {code} is empty unless Settings signinCode is on: then this line drops out (Jim W., 2026-10-29).
      'Or type this code on the page where you asked for the link: {code}', '',
      'It works once and expires in {minutes} minutes. It signs in as you, so please don\'t forward it. ' +
      'If you did not ask for it, ignore this email.'], 'none'),
    t('Start your Proposal', 'A', ['link', 'hours'], 'Your Coyote Creek Eagle Project Proposal link', [
      'This email address is not on file with the Coyote Creek District Advancement Committee.', '',
      'Scouts: to submit your Eagle Project Proposal for district review, use this link:', '', '{link}', '',
      'It works for {hours} hours.', '',
      'Already submitted a Proposal before (on this site, by email or on the old sign-up sheet)? Please do not submit again: ' +
      'request a sign-in link with the email address you used then, or reply to this email.', '',
      'Parents and guardians: you are copied on every email we send your Scout; your Scout signs in with their own email address.', '',
      'Adult leaders: this address is not on file as an authorized unit leader or committee member. If you think it should be, ' +
      'check with your unit leader or reply to this email.', '',
      'If you did not ask for this, ignore this email.'], 'none'),
    t('Confirm your submission', 'A', ['scout', 'link', 'days'], 'Confirm your Eagle Project Proposal submission ({scout})', [
      'We received an Eagle Project Proposal submission for {scout}.', '',
      'To finish, click this link (the Scout or a parent can click it; once is enough):', '', '{link}', '',
      'The link works for {days} days. Until it is clicked, the committee does not start on the Proposal.',
      'If you did not submit anything, ignore this email.'], 'none'),
    t('Proposal received', 'A', ['scout', 'entries', 'files', 'pageLink'], 'Eagle Project Proposal received: {scout}', [
      'Thank you. The Coyote Creek District Advancement Committee has received the Proposal for {scout}.', '',
      'What you entered:', '{entries}', '',
      'To correct the project details (title, beneficiary, address, coach, BSA ID, phone), sign in at {pageLink}. ' +
      'If your name, unit, birth date or an email address is wrong, or you have a question, reply to this email.', '',
      'Files received:', '{files}', '',
      'What happens next: a committee member checks that everything is there (signatures, contact information). ' +
      'If something is missing, we will email you. When it is complete, you will be invited to book a short Pre-Review Call.', '',
      'Check your status any time: {pageLink}']),
    t('Received, held (possible duplicate)', 'A', ['scout', 'pageLink'], 'Eagle Project Proposal received (being checked): {scout}', [
      'Thank you. We received the submission for {scout}, and it looks like the committee may already have a record for this Scout.', '',
      'A committee member will check and get back to you. If you are sending a new version of a Proposal you already sent, ' +
      'please sign in and send it as an update instead: {pageLink}']),
    t('Files added to existing record', 'A', ['scout', 'files', 'pageLink'], 'Eagle Project files received: {scout}', [
      'Thank you. We matched this submission to the record we already have for {scout} and added the files to it:', '{files}', '',
      'Next time, please sign in and use "Send an update" instead of the first-time form. ' +
      'Signing in also lets you correct your project details: {pageLink}']),
    t('Update received', 'A', ['scout', 'files', 'changes', 'description', 'pageLink'], 'Eagle Project update received: {scout}', [
      'We received an update for {scout}.', '', 'Your description: {description}', '', 'Files added:', '{files}', '', 'Information changed:', '{changes}', '',
      'Earlier versions are kept by the committee. See your status any time: {pageLink}']),
    t('Book: Pre-Review Call', 'B', ['scout', 'pageLink'], 'Next step: book your Pre-Review Call ({scout})', [
      'Good news: the committee has checked the Proposal for {scout} and it is ready for the next step.', '',
      'Please book a short (about 20 minute) Pre-Review Call with a committee member. It is an online call to go over ' +
      'anything notable and help you get ready to present your project.', '', 'Sign in and pick a time: {pageLink}', '', ADULT]),
    t('Book: Proposal Review', 'B', ['scout', 'pageLink', 'scheduleLink'], 'Next step: book your Proposal Review ({scout})', [
      'The committee is ready for {scout} to present the Eagle Project Proposal at a Proposal Review.', '',
      'Sign in and pick a date: {pageLink}', '',
      'Reviews are in person. Come ready to present your project and answer questions.', '', ADULT_IN_PERSON]),
    t('Book: Eagle Board of Review', 'B', ['scout', 'pageLink', 'unit', 'verifiedDate', 'scheduleLink', 'committeeEmail'], 'Next step: book your Eagle Board of Review ({scout})', [
      'Council has verified the Eagle application for {scout}. Congratulations!', '',
      'Please sign in and pick a date for your Eagle Board of Review: {pageLink}', '',
      'Your unit is notified when you book, so they can arrange the Unit Board Members. If your unit would like to hold ' +
      'the board on its own meeting night, have them email the committee.']),
    t('Status + page link', 'B', ['scout', 'status', 'booking', 'pageLink'], 'Your Eagle Project status ({scout})', [
      'Here is where {scout}\'s Eagle Project stands: {status}.', '', '{booking}', '',
      'Sign in to see your page, check your booking or send an update: {pageLink}'], 'group', 'review')
  ];

  Object.keys(TYPES).forEach(function (code) {
    if (code === 'EBoR') return;   // one email to the Scout and the unit together (below)
    var label = TYPES[code];
    var online = code === 'Intake';
    LIST.push(t('Booked: ' + label, 'A', ['scout', 'type', 'when', 'where', 'with', 'meetLink', 'pageLink'],
      '{type} booked: {scout}, {when}', [
        'Your {type} is booked.', '', '- When: {when}', online ? '- With: {with}' : '- Where: {where}', online ? '- Join: {meetLink}' : '', '',
        'A calendar invitation is on its way.', '', online ? ADULT : (code === 'EBoR' ? 'Wear your Field uniform and bring your Scout handbook.' : ADULT_IN_PERSON), '',
        'To cancel or change (up to 24 hours before): {pageLink}'].filter(function (l, i, a) { return !(l === '' && a[i - 1] === ''); })));
    LIST.push(t('Moved: ' + label, 'B', ['scout', 'type', 'when', 'where', 'pageLink'], '{type} changed: {scout}, now {when}', [
      'The {type} for {scout} has a new date, time or place.', '', '- When: {when}', '- Where: {where}', '',
      'The calendar invitation has been updated. Your page: {pageLink}']));
    LIST.push(t('Cancelled: ' + label, 'A', ['scout', 'type', 'when', 'pageLink'], '{type} cancelled: {scout}, {when}', [
      'The {type} on {when} for {scout} was cancelled. Pick a new time here: {pageLink}']));
  });

  // Follow-Up / Consult (Jim W., 2026-11-11): a committee-made meeting with a Scout outside the normal steps. Always made
  // by a member (Mode Review: the Outbox), never booked or changed by the Scout: no cancel link, replies go to the committee.
  var FOLLOWUP = 'Follow-Up / Consult';
  var FOLLOWUP_ADULT = 'Youth protection: a parent/guardian or another adult 21 or older must be with the Scout for the whole meeting.';
  LIST.push(t('Booked: ' + FOLLOWUP, 'B', ['scout', 'type', 'when', 'where', 'with', 'meetLink', 'pageLink'], '{type} booked: {scout}, {when}', [
    'A {type} is booked for {scout}.', '', '- When: {when}', '- Where: {where}', '- With: {with}', '- Join: {meetLink}', '',
    'A calendar invitation is on its way.', '', FOLLOWUP_ADULT, '', 'Need to change it? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Moved: ' + FOLLOWUP, 'B', ['scout', 'type', 'when', 'where', 'pageLink'], '{type} changed: {scout}, now {when}', [
    'The {type} for {scout} has a new date, time or place.', '', '- When: {when}', '- Where: {where}', '',
    'The calendar invitation has been updated. Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Cancelled: ' + FOLLOWUP, 'B', ['scout', 'type', 'when', 'pageLink'], '{type} cancelled: {scout}, {when}', [
    'The {type} on {when} for {scout} was cancelled. Questions? Reply to this email.'], 'group', 'review'));

  // EBoR (Jim W., 2026-10-29): Booked / Moved / Cancelled go To the Scout AND the unit contacts in ONE email, Cc the
  // parent/guardian and the committee. It used to be two emails (4.1.a-c to the family, 4.1.d-g to the unit), and the
  // committee got both. {boardLink} is empty when the unit is under review (the committee fills the board) or has no
  // contacts, so that paragraph drops out. Moved: {change} / {changeText} say what changed (Booking.changeWords);
  // {was} (old time) and {wasWhere} (old place) are filled only for the part that changed.
  var EBOR_VARS = ['scout', 'unit', 'type', 'when', 'was', 'where', 'wasWhere', 'change', 'changeText', 'pageLink', 'boardLink', 'committeeEmail'];
  var EBOR_HELLO = 'Hello {scout} and {unit} leaders,';
  var EBOR_ASK = 'Questions? Email the committee at {committeeEmail}.';
  LIST.push(t('Booked: Eagle Board of Review', 'A', EBOR_VARS, 'Eagle Board of Review booked: {scout} ({unit}), {when}', [
    EBOR_HELLO, '', '{scout}\'s Eagle Board of Review is booked.', '', '- When: {when}', '- Where: {where}', '',
    '{scout}: wear your field uniform and bring your Scout Handbook. A calendar invitation is on its way. ' +
    'To cancel or change (up to 24 hours before): {pageLink}', '',
    'Unit leaders: please arrange your Unit Board Members (usually 2 to 4 adults from your unit committee) and enter their names, ' +
    'emails and phone numbers here, signing in with your own email address: {boardLink}. They will receive the calendar invitation and the agenda.', '',
    'Questions, or would you like to hold the board on your own meeting or Court of Honor night? Email the committee at {committeeEmail}.']));
  LIST.push(t('Moved: Eagle Board of Review', 'A', EBOR_VARS, 'Eagle Board of Review {change}: {scout} ({unit}), {when}', [
    EBOR_HELLO, '', '{scout}\'s Eagle Board of Review has a {changeText}.', '', '- When: {when}', '- Where: {where}',
    '- Previous time: {was}', '- Previous place: {wasWhere}', '',
    'The calendar invitation has been updated for everyone on it, including Unit Board Members. {scout}\'s page: {pageLink}', '', EBOR_ASK]));
  LIST.push(t('Cancelled: Eagle Board of Review', 'A', EBOR_VARS, 'Eagle Board of Review cancelled: {scout} ({unit}), {when}', [
    EBOR_HELLO, '', 'The Eagle Board of Review for {scout} on {when} was cancelled. Everyone on the calendar invitation will get a cancellation notice.', '',
    '{scout}: pick a new date here: {pageLink}', '',
    'Unit leaders: no action needed for now. When a new date is booked, we\'ll email you again.', '', EBOR_ASK]));

  // Proposal Review outcomes (committee Review page, 2026-10-23). Always a draft in the Outbox; the approval email
  // carries the signed Proposal, so the member sends it from their own email with the PDF attached.
  LIST.push(t('Proposal approved', 'B', ['scout', 'date', 'signedBy', 'file', 'note'], 'Eagle Project Proposal approved: {scout}', [
    'Congratulations! The Coyote Creek District Advancement Committee approved the Eagle Scout Service Project Proposal for {scout} on {date}.', '',
    'The signed Proposal is attached ({file}). Keep it in your Eagle Scout Service Project Workbook: the whole workbook goes in with your Eagle Scout Rank Application.', '',
    'Next steps:',
    '- Work with your project coach on the Project Plan, then carry out the project.',
    '- Write the Project Report when the project is done, and get the final signatures.',
    '- When all requirements are complete, submit your Eagle Scout Rank Application to Council and copy the committee.', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  // EBoR reminder (Jim W., 2026-11-02): ONE email To the Scout, the district reps on the slot and the Unit Board
  // Members, Cc the parent/guardian and the committee. It used to be two (4.3.a to the Scout, 4.3.b to the board; the
  // same split 4.1.a ended on 10/29). New ID 4.3.c so an old 4.3.a tab (Scout-only wording, Cc none) can't be used for it.
  // Drafted eborReminderDays before the board into the Outbox (Mode: Review); a member adds details, sends or schedules it.
  LIST.push(t('EBoR reminder', 'C', ['scout', 'firstName', 'unitName', 'when', 'where', 'board', 'dayOfContact'],
    'Reminder: Eagle Board of Review for {scout} ({unitName}), {when}', [
      'Hello {firstName} and Board Members,', '',
      'A reminder of the Eagle Scout Board of Review for {scout} ({unitName}):', '',
      '- When: {when}', '- Where: {where}', '- Board: {board}', '',
      '{firstName}, how to prepare:',
      '- Wear your field uniform (Class A), as complete and neat as you can.',
      '- Bring your Eagle Scout Service Project Workbook and your Scout handbook.',
      '- Arrive 10 to 15 minutes early.',
      '- Be ready to talk about your project, what you learned as a leader, your time in Scouting and your plans.', '',
      'Board Members: please arrive 10 to 15 minutes early. If you can no longer attend, reply right away so a replacement can be found.', '',
      'Running late? {dayOfContact}', '',
      'Questions? Reply to this email.'], 'group', 'review'));
  // Unit, nudge and acknowledgement emails (2026-10-24): drafted into the Outbox (Mode: Review).
  LIST.push(t('Unit Board Members missing', 'C', ['scout', 'unitName', 'when', 'where', 'pageLink'],
    'Unit Board Members needed: Eagle Board of Review for {scout}, {when}', [
      'Hello,', '',
      'The Eagle Scout Board of Review for {scout} ({unitName}) is coming up:', '', '- When: {when}', '- Where: {where}', '',
      'We do not have the unit\'s Board Members yet. Please enter them (name, email, phone) on the unit page so they get the ' +
      'calendar invitation: {pageLink}', '',
      'If the unit will not provide Board Members, reply to this email and the committee will fill the board.'], 'group', 'review'));
  LIST.push(t('Application submitted: acknowledgement', 'B', ['scout', 'firstName', 'pageLink'],
    'Eagle Scout Rank Application received: {scout}', [
      '{firstName},', '',
      'The committee has been told that your Eagle Scout Rank Application went to Council. Council verifies it (service ' +
      'record, merit badges, dates); this usually takes a few weeks. When Council has verified it, you will be invited to ' +
      'book your Eagle Scout Board of Review.', '',
      'Check your status any time: {pageLink}', '',
      'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Please book', 'C', ['scout', 'firstName', 'session', 'days', 'pageLink'],
    'Reminder: please book your {session} ({scout})', [
      '{firstName},', '',
      'You are ready for your {session}, but it has not been booked yet ({days} days so far).', '',
      'Sign in and pick a time: {pageLink}', '',
      'If none of the times work, or you are waiting on something, reply to this email and let us know.'], 'group', 'review'));
  // Open times (Jim W., 2026-10-31): ONE email To every Scout ready to book the type, Cc parents + committee, after a
  // member opens new sessions (committee schedule page). Drafted into the Outbox (Review) so the member checks it first.
  var OPEN_VARS = ['firstNames', 'type', 'times', 'pageLink'];
  function openTimes(type, how, extra) {
    return t('Open times: ' + type, 'B', OPEN_VARS, 'New {type} times open: please book', [
      '{firstNames},', '',
      'The committee just opened ' + how + ':', '{times}', '',
      'You are each ready for this step. First come, first served: book soon to get the time you want. The page always shows what is still open.', '',
      'Sign in and pick a time: {pageLink}', ''].concat(extra).concat(['',
      'If none of these times work for you, reply to this email and let us know.']), 'group', 'review');
  }
  LIST.push(openTimes('Pre-Review Call', 'new Pre-Review Call times (online, about 20 minutes)', [ADULT]));
  LIST.push(openTimes('Proposal Review', 'new Proposal Review times (in person)', ['Come ready to present your project and answer questions.', '', ADULT_IN_PERSON]));
  LIST.push(openTimes('Eagle Board of Review', 'new Eagle Board of Review times', [
    'Your unit is notified when you book, so they can arrange the Unit Board Members.']));
  LIST.push(t('Session briefing', 'C', ['scout', 'unitName', 'session', 'when', 'where', 'members', 'folderLink', 'logLink', 'notes', 'eagleNumber'],
    'Tomorrow: {session} for {scout} ({unitName}), {when}', [
      'You are on the {session} for {scout} ({unitName}):', '',
      '- When: {when}', '- Where: {where}', '- Members: {members}', '- Scout folder: {folderLink}', '- Log: {logLink}',
      '- If Eagle is awarded, announce: {eagleNumber}', '',
      'Notes: {notes}'], 'none', 'automatic'));
  // EBoR outcomes (dashboard row actions, 2026-10-23): always drafts in the Outbox.
  // "Eagle earned" in one step (2026-10-23). Wording from the committee's own letters (the committee chair, a committee member). Own signature
  // ({senderName}), so no standard sign-off appended.
  LIST.push({ key: 'New Eagle Scout', cls: 'B', vars: ['scout', 'firstName', 'unitName', 'date', 'photosLine', 'senderName', 'eagleNumberLine'],
    subject: '{unitName}\'s Newest Eagle Scout - {scout}', cc: 'group', mode: 'review', body: [
      '{firstName},', '',
      'On behalf of the Coyote Creek Advancement Committee and this Eagle Board of Review, congratulations on passing your Board of Review ' +
      'for the highest rank in Scouts BSA, the rank of Eagle.', '',
      '{eagleNumberLine}', '',
      'Your Eagle application has been sent to the National Council for final approval, accompanied by this Board\'s unanimous ' +
      'recommendation that you be awarded the rank of Eagle.', '',
      'Once final approval is obtained, you or your delegate will be notified to pick up your Eagle Award Packet, which will contain your ' +
      'Eagle Medal, Eagle Patch, and other items.', '',
      'Regardless of when this happens, the date that you achieved the rank of Eagle will always be your Board of Review date, which is {date}.', '',
      '{photosLine}', '',
      'Your Eagle Board of Review photos and Eagle Project will also be featured in the next issue of the Coyote Creek District Newsletter. ' +
      'If you have additional pictures of your Eagle project to include, please share them (Google Drive or email) at coyotecreeknews@gmail.com.', '',
      'Always remember "Once an Eagle, Always an Eagle," and that the Trail to Eagle never ends. The life lessons you learned on this trail ' +
      'will stay with you throughout your life!', '',
      'Congratulations!', '',
      'Yours in Scouting,', '{senderName}', 'District Advancement Committee', 'Coyote Creek District', '',
      'Next Steps:',
      '- After SVMBC is notified that BSA has approved your packet, SVMBC will contact you or someone from your unit to pick up your Eagle ' +
      'Certificate and Eagle presentation kit.',
      '- Decide if you want to join NESA (National Eagle Scout Association): https://nesa.org/why-join/ . NESA is $100 for a 5-year ' +
      'membership, or $500 for a Lifetime membership. Some troops subsidize this.',
      '- Buy your Eagle Knot from the Scout Shop, item #5011. The regular Eagle Knot has a tan border; the NESA Eagle Knot has a silver border.',
      '- Hold your Eagle Court of Honor!'] });
  LIST.push({ key: 'Council: Eagle paperwork', cls: 'B', vars: ['scout', 'unitName', 'date', 'senderName'],
    subject: '{scout} is an Eagle Scout {date}', cc: 'group', mode: 'review', body: [
      'Hello Eagle Services,', '',
      '{scout} ({unitName}) completed the Eagle Scout Board of Review on {date}. Attached are the signed Eagle Scout Rank Application ' +
      'and the Advancement Report.', '',
      'Please reply to confirm that you received them.', '',
      '{senderName}', 'Coyote Creek District Advancement Committee'] });
  LIST.push(t('EBoR paused', 'B', ['scout', 'date', 'note', 'pageLink'], 'Eagle Board of Review: next steps ({scout})', [
    'Thank you, {scout}, for meeting with the Eagle Scout Board of Review on {date}. The board has paused (adjourned) so that the following can be completed:', '',
    '{note}', '',
    'When it is done, reply to this email and the committee will help you set a date to reconvene the board.', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Eagle not awarded', 'B', ['scout', 'date', 'note'], 'Eagle Board of Review result ({scout})', [
    'Thank you, {scout}, for meeting with the Eagle Scout Board of Review on {date}. The board did not approve the Eagle Scout rank at this time.', '',
    '{note}', '',
    'A member of the committee will follow up with you and your unit leader about the reasons and your options, including the right to appeal ' +
    '(Guide to Advancement, section 8).', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Proposal incomplete', 'B', ['scout', 'date', 'note', 'pageLink'], 'Eagle Project Proposal: something is missing ({scout})', [
    'Thank you for the Eagle Project Proposal for {scout}. Before the committee can schedule a Pre-Review Call, please take care of the following:', '',
    '{note}', '',
    'When it is ready, sign in and send it as an update: {pageLink}', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Revisions before review', 'B', ['scout', 'date', 'note', 'pageLink'], 'Eagle Project Proposal: changes before your Proposal Review ({scout})', [
    'Thank you for going over the Eagle Project Proposal for {scout} with the committee. Before your in-person Proposal Review, please make these changes:', '',
    '{note}', '',
    'When the revised Proposal is ready, sign in and send it as an update: {pageLink}', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Revisions requested', 'B', ['scout', 'date', 'note', 'pageLink'], 'Eagle Project Proposal: revisions requested ({scout})', [
    'Thank you for presenting the Eagle Project Proposal for {scout}. Before the committee can approve it, please make these changes:', '',
    '{note}', '',
    'When the revised Proposal is ready (with any new signatures it needs), sign in and send it as an update: {pageLink}', '',
    'Questions? Reply to this email.'], 'group', 'review'));
  LIST.push(t('Proposal not approved', 'B', ['scout', 'date', 'note', 'pageLink'], 'Eagle Project Proposal not approved: {scout}', [
    'Thank you for presenting the Eagle Project Proposal for {scout}. The committee was not able to approve this project.', '',
    '{note}', '',
    'Please talk with your unit leader and project coach about a different project. When you have a new Proposal, sign in and send it ' +
    'as an update with the new project title, and the review starts again: {pageLink}', '',
    'Questions? Reply to this email.'], 'group', 'review'));

  // ---------- IDs and the catalog (Jim W., 2026-10-24) ----------
  // ID = <phase>.<source state>.<letter>: permanent, never reused. The Doc tab is found by its leading ID, so the
  // rest of the tab title can be reworded. Phases: 0 Sign-in, 1 Intake, 2 Proposal review, 3 Project underway,
  // 4 EBoR, 5 Eagle, 6 Committee / misc.
  var PHASES = { 0: 'Sign-in', 1: 'Intake', 2: 'Proposal review', 3: 'Project underway', 4: 'EBoR', 5: 'Eagle', 6: 'Committee / misc' };
  var SF = 'Scout; Cc parent/guardian', UC = 'unit contacts (Key 3 Unit Leader + Committee Chair + Unit Contacts)';
  // key -> [id, from, to / event, trigger, recipients]
  var META = {
    'Sign-in link': ['0.1.a', 'any', 'sign-in', 'Someone asks for a sign-in link (/signin)', 'the address typed in'],
    'Start your Proposal': ['0.1.b', 'any', 'intake form', 'Sign-in asked for by an address not on file (email-first intake)', 'the address typed in'],
    'Confirm your submission': ['1.1.a', 'Intake form', 'Intake Queue (unconfirmed)', 'First-time Proposal form submitted (/intake); also re-sent on sign-in', 'Scout email, parent email (one each)'],
    'Proposal received': ['1.2.a', 'Intake Queue', 'Proposal Received', 'Proposal submitted from a proven email (or a legacy confirmation link clicked): new Scout row', SF],
    'Received, held (possible duplicate)': ['1.2.b', 'Intake Queue', 'Intake Queue (held)', 'Submitted; matches an existing Scout (email, BSA ID, or name + unit)', SF],
    'Files added to existing record': ['1.2.c', 'Intake Queue', '(existing row)', 'Submitted from an address on the matching record', SF],
    'Book: Pre-Review Call': ['1.3.a', 'Proposal Received / Incomplete', 'Intake Review: To Book', 'Row action "Complete", sheet Action move, Resend booking link', SF],
    'Proposal incomplete': ['1.3.b', 'Proposal Received / Incomplete', 'Proposal Incomplete', 'Row action "Incomplete: ask for changes" (with note)', SF],
    'Booked: Pre-Review Call': ['1.4.a', 'Intake Review: To Book', 'Intake Review: Booked', 'Scout books online, or create-and-book', SF],
    'Moved: Pre-Review Call': ['1.4.b', 'Intake Review: Booked', '(same)', 'Booked slot moved on the schedule', SF],
    'Cancelled: Pre-Review Call': ['1.4.c', 'Intake Review: Booked', 'Intake Review: To Book', 'Booking cancelled (Scout or committee)', SF],
    'Update received': ['1.5.a', 'any Proposal stage', '(same; new files waiting)', 'Scout sends an update (/update)', SF],
    'Book: Proposal Review': ['2.1.a', 'Intake Review: Booked / Revisions Requested for Review', 'In-Person Review: To Book', 'Row action "Ready for in-person review", Resend booking info', SF],
    'Revisions before review': ['2.1.b', 'Intake Review: Booked / Revisions Requested for Review', 'Revisions Requested for Review', 'Row action "Changes needed before review" (with note)', SF],
    'Booked: Proposal Review': ['2.2.a', 'In-Person Review: To Book', 'In-Person Review: Booked', 'Scout books online, or create-and-book (not shadow)', SF],
    'Moved: Proposal Review': ['2.2.b', 'In-Person Review: Booked', '(same)', 'Booked slot moved on the schedule', SF],
    'Cancelled: Proposal Review': ['2.2.c', 'In-Person Review: Booked', 'In-Person Review: To Book', 'Booking cancelled', SF],
    'Proposal approved': ['2.3.a', 'In-Person Review: Booked / Proposal Revisions Requested', 'Proposal Approved', 'Review outcome: Approved (signed Proposal attached)', SF],
    'Revisions requested': ['2.3.b', 'In-Person Review: Booked / Proposal Revisions Requested', 'Proposal Revisions Requested', 'Review outcome: Revisions requested (with note)', SF],
    'Proposal not approved': ['2.3.c', 'any Proposal stage before approval', 'Proposal Not Approved', 'Review outcome or row action "Not approved" (with note)', SF],
    'Book: Eagle Board of Review': ['3.2.a', 'Application Submitted / Proposal Approved', 'Application Verified', 'Row action "Application verified" (or resend); fills "Emailed to set up EBoR" when sent', SF + ', ' + UC],
    'Booked: Eagle Board of Review': ['4.1.a', 'Application Verified / EBoR Paused', 'EBoR Booked', 'EBoR booked (online, create-and-book; not shadow)', 'Scout + ' + UC + '; Cc parent/guardian'],
    'Moved: Eagle Board of Review': ['4.1.b', 'EBoR Booked', '(same)', 'Booked slot moved (committee schedule page or the schedule sheet)', 'Scout + ' + UC + '; Cc parent/guardian'],
    'Cancelled: Eagle Board of Review': ['4.1.c', 'EBoR Booked', 'Application Verified', 'Booking cancelled', 'Scout + ' + UC + '; Cc parent/guardian'],
    'EBoR reminder': ['4.3.c', 'EBoR Booked', '(same)', 'Settings → eborReminderDays (3) before the board: drafted into the Outbox; send now or Send later', 'Scout + district reps on the slot + Unit Board Members; Cc parent/guardian + committee'],
    'Unit Board Members missing': ['4.1.h', 'EBoR Booked', '(same)', 'Hourly: EBoR within 7 days and no Unit Board Members (unit not under review): drafted into the Outbox', UC + '; Cc committee'],
    'Application submitted: acknowledgement': ['3.1.a', 'Proposal Approved', 'Application Submitted', 'Row action "Application submitted": drafted into the Outbox', SF],
    'Open times: Pre-Review Call': ['1.4.d', 'Intake Review: To Book', '(same)', 'Committee page: new sessions opened, "Email the Scouts ready to book": drafted into the Outbox', 'all Scouts ready to book; Cc their parents/guardians + committee'],
    'Open times: Proposal Review': ['2.2.d', 'In-Person Review: To Book', '(same)', 'Same as 1.4.d', 'all Scouts ready to book; Cc their parents/guardians + committee'],
    'Open times: Eagle Board of Review': ['4.1.i', 'Application Verified', '(same)', 'Same as 1.4.d', 'all Scouts ready to book; Cc their parents/guardians + committee'],
    'Please book': ['6.2.c', 'any To Book stage (online booking)', '(same)', 'Hourly: Settings → pleaseBookDays in a To Book stage (default 7 + 14 days; EBoR 7): drafted into the Outbox', SF],
    'Session briefing': ['6.2.b', 'any Booked stage', '(same)', 'Hourly: the day before (within 24 h), sent automatically (a Follow-Up / Consult too)', 'committee members on the slot'],
    'EBoR paused': ['4.2.a', 'EBoR Booked', 'EBoR Paused', 'Row action "EBoR paused" (with note)', SF],
    'Eagle not awarded': ['4.2.b', 'EBoR Booked / EBoR Paused', 'Eagle Not Awarded', 'Row action "Eagle not awarded" (with reasons)', SF],
    'New Eagle Scout': ['5.1.a', 'EBoR Booked', 'Eagle Earned', 'Row action "Eagle earned" (photos attached)', 'Scout; Cc parent/guardian, ' + UC + ', the board, others to invite'],
    'Council: Eagle paperwork': ['5.1.b', 'EBoR Booked / Eagle Earned', 'Eagle Earned', '"Eagle earned" or "Send signed paperwork to Council" (scans attached); fills the sent date', 'Council Eagle Services (Settings → councilEaglesEmail); Cc ' + UC],
    'Booked: Follow-Up / Consult': ['6.2.d', 'any stage but Eagle Earned', '(same)', 'Committee page: Follow-Up / Consult created and booked (row action "Schedule a follow-up / consult…" or New session); the tracking row does not move', SF],
    'Moved: Follow-Up / Consult': ['6.2.e', 'any stage but Eagle Earned', '(same)', 'Booked Follow-Up / Consult moved (committee page or the schedule sheet)', SF],
    'Cancelled: Follow-Up / Consult': ['6.2.f', 'any stage but Eagle Earned', '(same)', 'Follow-Up / Consult cancelled (the schedule row is removed: a follow-up is never open for booking)', SF],
    'Status + page link': ['6.1.a', 'any', '(same)', 'Sheet Action "✉ Email status + page link"', SF]
  };
  LIST.forEach(function (x) {
    var m = META[x.key];
    if (!m) throw new Error('TemplateCatalog: no ID for "' + x.key + '"');
    x.id = m[0]; x.from = m[1]; x.to = m[2]; x.trigger = m[3]; x.recipients = m[4];
  });
  // Planned emails (catalog only; a tab is created when the email is built) and emails built into the code (no tab).
  var OTHER = [
    { id: '4.1.d', key: 'Unit: EBoR booked', status: 'Retired 2026-10-29: merged into 4.1.a (one email to Scout + unit)', from: 'Application Verified', to: 'EBoR Booked', trigger: '-', recipients: UC },
    { id: '4.1.e', key: 'Unit: EBoR booked (unit under review)', status: 'Retired 2026-10-29: merged into 4.1.a', from: 'Application Verified', to: 'EBoR Booked', trigger: '-', recipients: UC },
    { id: '4.1.f', key: 'Unit: EBoR moved', status: 'Retired 2026-10-29: merged into 4.1.b', from: 'EBoR Booked', to: '(same)', trigger: '-', recipients: UC },
    { id: '4.1.g', key: 'Unit: EBoR cancelled', status: 'Retired 2026-10-29: merged into 4.1.c', from: 'EBoR Booked', to: 'Application Verified', trigger: '-', recipients: UC },
    { id: '4.3.a', key: 'EBoR reminder: Scout', status: 'Retired 2026-11-02: merged into 4.3.c (one email to Scout + board)', from: 'EBoR Booked', to: '(same)', trigger: '-', recipients: SF },
    { id: '4.3.b', key: 'EBoR reminder: board', status: 'Retired 2026-11-02: merged into 4.3.c', from: 'EBoR Booked', to: '(same)', trigger: '-', recipients: 'district reps + Unit Board Members' },
    { id: '1.2.d', key: 'Unconfirmed submission reminder', status: 'Planned', from: 'Intake Queue (unconfirmed)', to: '(same)', trigger: 'Not confirmed after 3 days (purge at 14)', recipients: 'the unconfirmed addresses' },
    { id: '6.2.a', key: 'Session reminder (Pre-Review Call / Proposal Review)', status: 'Not planned (no no-show problem; the EBoR reminder is 4.3.c)', from: 'any Booked stage', to: '(same)', trigger: '-', recipients: SF },
    { id: '6.3.a', key: 'Age alert', status: 'Planned', from: 'any stage before Eagle', to: '(same)', trigger: '90 / 60 / 30 days before the 18th birthday', recipients: 'committee (digest section); Scout + parent at 60 days?' },
    { id: '6.3.b', key: 'Digest section: Scouts waiting to book / open slots', status: 'Built in (no template)', from: '-', to: '-', trigger: 'Digest: Awaiting action list', recipients: 'committee' },
    { id: '6.3.c', key: 'Digest section: next week\'s sessions', status: 'Built in (no template)', from: '-', to: '-', trigger: 'Digest: next 7 days', recipients: 'committee' },
    { id: '6.9.a', key: 'Committee digest', status: 'Built in (no template)', from: '-', to: '-', trigger: 'Settings → digestHours, when something changed', recipients: 'digestTo, else the committee group' },
    { id: '6.9.b', key: 'Committee alerts (intake held, EBoR guests added, …)', status: 'Built in (no template)', from: '-', to: '-', trigger: 'System events', recipients: 'committee group' },
    { id: '6.9.c', key: 'Admin alerts', status: 'Built in (no template)', from: '-', to: '-', trigger: 'Problems (template, calendar, unknown initials, …)', recipients: 'adminEmail' },
    { id: '6.9.d', key: 'Calendar invitations / updates', status: 'Built in (Google Calendar)', from: 'any Booked stage', to: '-', trigger: 'Bookings, members added/removed, moves', recipients: 'Scout, parent, members on the slot; EBoR: + board, unit' },
    { id: '6.9.e', key: 'Health check (digest or trigger silent)', status: 'Built in (no template)', from: '-', to: '-', trigger: 'No Digest Log row for 2 days, trigger missing', recipients: 'adminEmail' }
  ];

  var ID_RE = /^\s*(\d+\.\d+\.[a-z]+)\b/;
  /** "2.3.a Proposal approved" -> "2.3.a"; no leading ID -> ''. */
  function idOf(title) { var m = ID_RE.exec(String(title || '')); return m ? m[1] : ''; }
  /** The tab title the tool creates: "2.3.a Proposal approved". */
  function tabTitle(x) { return x.id + ' ' + x.key; }
  function phaseOf(id) { return PHASES[String(id).split('.')[0]] || ''; }
  /** Sort "1.10.a" after "1.2.b". */
  function cmpId(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    return (+x[0] - +y[0]) || (+x[1] - +y[1]) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  }

  var BY_KEY = {}, BY_ID = {};
  LIST.forEach(function (x) { BY_KEY[x.key] = x; BY_ID[x.id] = x; });

  /** By key ("Proposal approved"), by ID ("2.3.a") or by a tab title ("2.3.a Approved, signed"). */
  function get(key) { return BY_KEY[key] || BY_ID[key] || BY_ID[idOf(key)] || null; }

  /**
   * The tab for a template among the Doc's tab titles: the one with its ID (any wording after it), else the old
   * title without an ID (before the tabs were numbered). tabs: {title: anything}. -> title or ''.
   */
  function findTab(titles, key) {
    var x = BY_KEY[key];
    var list = Object.keys(titles || {});
    if (x) { for (var i = 0; i < list.length; i++) if (idOf(list[i]) === x.id) return list[i]; }
    return Object.prototype.hasOwnProperty.call(titles || {}, key) ? key : '';
  }

  /**
   * Catalog rows (built templates + planned + built-in), sorted by ID.
   * tabInfo(key) -> {mode, title, tabId} | null (the Doc's state; mode 'automatic'|'review'|'off').
   */
  function catalogRows(tabInfo) {
    var rows = LIST.map(function (x) {
      var t = tabInfo ? tabInfo(x.key) : null;
      var status = !t ? 'Template tab missing' : t.mode === 'off' ? 'Off (inactive)' : t.mode === 'review' ? 'Review (Outbox)' : 'Automatic';
      return { id: x.id, name: x.key, phase: phaseOf(x.id), from: x.from, to: x.to, trigger: x.trigger, recipients: x.recipients,
        cc: x.cc === 'none' ? 'none' : 'committee group', status: status, tabId: t ? t.tabId : '', tabTitle: t ? t.title : '' };
    }).concat(OTHER.map(function (o) {
      return { id: o.id, name: o.key, phase: phaseOf(o.id), from: o.from, to: o.to, trigger: o.trigger, recipients: o.recipients, cc: '',
        status: o.status, tabId: '', tabTitle: '' };
    }));
    return rows.sort(function (a, b) { return cmpId(a.id, b.id); });
  }

  /** The tab text for a new Doc (header + body lines). */
  function seedLines(x) {
    return ['Subject: ' + x.subject, 'Mode: ' + x.mode.charAt(0).toUpperCase() + x.mode.slice(1), 'Cc: ' + x.cc, '----']
      .concat(x.body.filter(function (l) { return l !== null; }));
  }

  var PLACEHOLDER_HELP = [
    ['{scout}', 'Scout\'s name'], ['{unit}', 'Unit (e.g. T719)'], ['{type}', 'Pre-Review Call / Proposal Review / Eagle Board of Review / Follow-Up / Consult'],
    ['{when}', 'Date and time, e.g. Wed 10/28 7:00 PM'], ['{where}', 'Place and address (in person)'], ['{with}', 'Committee member(s) (Pre-Review Call)'],
    ['{meetLink}', 'Google Meet link (Pre-Review Call)'], ['{pageLink}', 'Sign-in page of the Eagle Project site'],
    ['{link}', 'The one-time link (sign-in / confirm)'], ['{minutes}', 'Minutes the sign-in link works'], ['{days}', 'Days the confirm link works'], ['{status}', 'Stage text (Settings → Scout status)'],
    ['{booking}', 'The current booking, if any'], ['{entries}', 'Everything typed on the form (list)'], ['{files}', 'Files received (list)'],
    ['{changes}', 'Information changed (list)'], ['{committeeEmail}', 'The committee group address'],
    ['{date}', 'Date of the committee\'s decision (Review page)'], ['{signedBy}', 'Initials of who signed, e.g. AB&CD'],
    ['{file}', 'Name of the signed Proposal file'], ['{verifiedDate}', 'Date Council verified the Eagle application'],
    ['{scheduleLink}', 'Where to sign up for an EBoR today (Settings → eborSignupUrl)'],
    ['{board}', 'Who is on the EBoR (district + unit)'], ['{dayOfContact}', 'Running-late contact (Settings → dayOfContact; line left out when blank)'],
    ['{firstName}', 'Scout\'s first name'], ['{unitName}', 'Unit written out, e.g. Troop 2019'],
    ['{photosLine}', '"Photos from your Board of Review are attached." (empty without photos)'], ['{senderName}', 'Committee member who records it'], ['{note}', 'The note typed on the Review page']
  ];

  function howTo() {
    return [
      'How to edit these emails',
      '',
      'Each tab is one email. Its title starts with the email\'s ID (e.g. 2.3.a): the tool finds the tab by that ID, so keep the ID ' +
      'and reword the rest of the title freely. Don\'t add tabs (the developer adds them when an email is built). ' +
      'The "Catalog" tab links to the list of every email: when it is sent, to whom, and whether it is on.',
      'At the top of each tab:',
      '- Subject: the subject line (placeholders allowed)',
      '- Mode: Automatic (send at once), Review (committee checks it first, in the Outbox; until the Outbox exists this sends like Automatic), or Off (never send)',
      '- Cc: group (copy the committee group) or none',
      'Then a line with four dashes ---- and the email text below it.',
      '',
      'Formatting that works: bold, italic, underline, text colour, highlight, links, bulleted and numbered lists, Heading 1-3. Tables and pictures are ignored.',
      'Placeholders in {braces} are filled in for each email. A misspelled placeholder stops that email from using this tab (the built-in wording is sent instead and the admin is told).',
      'A line whose placeholders are all empty is left out (e.g. "Where:" for an online call). A line that is only {files}, {entries} or {changes} becomes a bulleted list.',
      'Changes take effect within about 5 minutes. Use Suggesting mode or comments to propose wording; version history shows every change.',
      '',
      'Placeholders:'
    ].concat(PLACEHOLDER_HELP.filter(function (p) { return p[1]; }).map(function (p) { return '- ' + p[0] + '  ' + p[1]; }));
  }

  /**
   * Lines -> what to insert into an empty Doc tab with the Docs API (body starts at index 1):
   * { text, bullets: [[start, end]], grey: [[start, end]] (Subject/Mode/Cc/---- lines), heading: [start, end] | null }.
   * "- " lines become bullets (the "- " is removed). Indexes count UTF-16 units, like JavaScript strings.
   */
  function fillPlan(lines, firstIsHeading) {
    var text = '', bullets = [], grey = [], heading = null, at = 1;
    lines.forEach(function (line, i) {
      var m = /^\s*- (.*)$/.exec(line);
      var t = m ? m[1] : line;
      var start = at, end = at + t.length + 1;               // + the newline
      if (m) bullets.push([start, end]);
      if (!m && /^(Subject|Mode|Cc):|^-{3,}$/.test(t)) grey.push([start, end - 1]);
      if (i === 0 && firstIsHeading) heading = [start, end];
      text += t + '\n';
      at = end;
    });
    return { text: text, bullets: bullets, grey: grey.filter(function (r) { return r[1] > r[0]; }), heading: heading };
  }

  return { PHASES: PHASES, OTHER: OTHER, idOf: idOf, tabTitle: tabTitle, phaseOf: phaseOf, cmpId: cmpId, findTab: findTab,
    catalogRows: catalogRows, MAP_TITLE: 'Catalog (map of every email)', fillPlan: fillPlan, LIST: LIST, TYPES: TYPES, get: get, seedLines: seedLines, howTo: howTo, HOWTO_TITLE: 'How to edit' };
})();

if (typeof module !== 'undefined') module.exports = TemplateCatalog;
