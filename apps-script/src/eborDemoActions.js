/**
 * Demo Scout for the EBoR paperwork page (Task 14b, Jim W., 2026-11-11). Lets a member show the committee the page with a
 * fictional Scout (lib/eborPaperwork.js DEMO, recordId 'DEMO'). Handled by explicit branches in eborPaperworkActions.js; this
 * path NEVER reads or writes the tracking tab, a Scout's folder link or Life to Eagle Log, and NEVER addresses Settings →
 * councilEaglesEmail: the only email is a [DEMO] Outbox draft To the member who ran it.
 *
 * Files: <scoutsFolderId>/<current year>/Demo Scout - T999 (test)/ . A blank Eagle Application from the Form Templates folder
 * is copied there as "Verified Eagle Application (demo).pdf" whenever the folder has no "verified" PDF.
 *
 * Router action added: eborPaperworkDemoReset {session} -> {message}   (signed demo files to the demo folder's Archive)
 */

/** The demo folder (create = make it and its year folder). null when it doesn't exist and create is false. */
function demoFolder_(create) {
  var s = getSettings_();
  var rootId = String(s.scoutsFolderId || '').trim();
  if (!rootId) throw userError_('Settings → scoutsFolderId is empty: the demo folder can\'t be made.');
  var cur;
  try { cur = DriveApp.getFolderById(rootId); }
  catch (e) { throw userError_('The Scouts folder could not be opened. Check Settings → scoutsFolderId.'); }
  var path = EborPaperwork.demoFolderPath(todayYmd_());
  for (var i = 0; i < path.length; i++) {
    if (create) { cur = childFolder_(cur, path[i]); continue; }
    var it = cur.getFoldersByName(path[i]);
    if (!it.hasNext()) return null;
    cur = it.next();
  }
  return cur;
}

/** If the demo folder has no "verified" PDF, copy the blank Eagle Application in as the demo's Verified one. */
function demoEnsureVerified_(folder) {
  if (EborPaperwork.pickVerified(paperworkFiles_(folder))) return;
  var blank = FormTemplates.pickApplication(formTemplateFiles_());
  if (!blank) throw userError_('The demo needs a blank Eagle Application: put a PDF with "Eagle Application" in its name in the Form Templates folder (Settings → formTemplatesFolderId).');
  DriveApp.getFileById(blank.id).makeCopy(EborPaperwork.DEMO.verifiedName, folder);
}

function actionEborPaperworkDemoScout_(req) {
  committeeMe_(req.session);
  var D = EborPaperwork.DEMO, s = getSettings_(), today = todayYmd_();
  var boardYmd = EborPaperwork.parts(req.boardYmd) ? String(req.boardYmd) : today;
  var folder = demoFolder_(true);
  demoEnsureVerified_(folder);
  var files = paperworkFiles_(folder);
  var verified = EborPaperwork.pickVerified(files);
  var committee = [];
  try { committee = committee_(); } catch (e) { /* suggestions only */ }
  var fill = EborPaperwork.reportFields(EborPaperwork.demoReportInput(boardYmd, s.districtName, s.advancementTitle));
  var names = EagleDone.fileNames(D.name, D.unit, boardYmd, Intake.namePart, Intake.unitPart);
  return {
    recordId: D.recordId, demo: true, name: D.name, unit: D.unit, stage: D.stage,
    boardYmd: boardYmd, boardTime: '',
    suggestions: { district: committee.map(function (m) { return String(m.name || ''); }).filter(String), unit: [] },
    requirement7: EborPaperwork.mmddyy(boardYmd),
    fields: fill.text, radio: fill.radio, problems: fill.problems,
    leader: { name: D.leaderName, hasAddress: true },
    folderUrl: 'https://drive.google.com/drive/folders/' + folder.getId(),
    verifiedId: verified ? verified.id : '',
    pdfs: EborPaperwork.pdfChoices(files),
    fileNames: { application: names.application, report: names.report },
    alreadySigned: EborPaperwork.signedIn(files),
    councilEmail: ''
  };
}

/** Save for the demo: both files into the demo folder (same filing code), a [DEMO] draft To the member only, one Activity line. */
function eborDemoFinish_(c, ctx, up) {
  var D = EborPaperwork.DEMO, by = c.me.initials || c.email;
  var folder = demoFolder_(true);
  var f = fileSignedPair_(folder, ctx, up, D.name, D.unit);
  var vars = { scout: D.name, firstName: D.preferred, unitName: EagleDone.unitName(D.unit), date: EagleDone.longDate(ctx.boardYmd),
    senderName: String(c.me.name || c.email) };
  var cp = reviewBuiltIn_(TemplateCatalog.get('Council: Eagle paperwork'), vars);
  var res = null, note = '';
  try {
    res = mailFromTemplate_('Council: Eagle paperwork', vars, {
      committee: true, outbox: true, by: c.email, recordId: '', scout: D.name, demo: true, demoTo: c.email,
      to: [c.email], cc: '', subject: cp.subject, body: cp.body, attachments: [f.filed.application, f.filed.report] });
  } catch (e) { console.error('ebor paperwork demo email: ' + (e && e.stack || e)); note = ' The [DEMO] email could not be drafted (' + e.message + ').'; }
  var queued = !!(res && res.queued);
  if (res && !queued) note = ' No [DEMO] email was drafted (' + (res.reason || 'template Off') + ').';
  try {
    Tabs.append(ACTIVITY_TAB, { 'When': new Date(), 'Scout': D.name, 'Unit': D.unit, 'Record ID': D.recordId, 'Entry': EborPaperwork.demoActivity(by), 'By': by });
  } catch (e) { console.warn('Demo activity not recorded: ' + e); }
  return { message: 'Demo: signed Eagle application and Advancement Report filed in the demo folder' +
    (f.toArchive.length ? ' (' + f.toArchive.length + ' earlier file(s) to Archive)' : '') + '.' +
    (queued ? ' A [DEMO] email, To you only, is ready in the Outbox. Nothing was sent to Council and no Scout record was touched.' : '') + note,
    outboxId: queued ? res.id : '' };
}

function actionEborPaperworkDemoReset_(req) {
  committeeMe_(req.session);
  var folder = demoFolder_(false);
  if (!folder) return { message: 'The demo is already fresh (no demo folder yet).' };
  var top = listFolder_(folder);
  var ids = EborPaperwork.demoResetPlan(top.map(function (x) { return { id: x.id, name: x.name }; }));
  if (!ids.length) return { message: 'The demo is already fresh (no signed files).' };
  var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
  top.forEach(function (x) { if (ids.indexOf(x.id) >= 0) x.file.moveTo(archive); });
  return { message: 'Demo reset: ' + ids.length + ' signed file(s) moved to the demo folder\'s Archive.' };
}
