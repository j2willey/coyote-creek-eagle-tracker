/**
 * Council Eagle application emails -> the Scout's folder (rules in lib/councilApp.js). Runs in the hourly trigger
 * (digestHourly) as cc-advancement, whose inbox gets the Formsite emails; also Admin menu → "Council applications:
 * file new emails now". Off until Settings → councilAppFrom has a date (only emails from that day on are filed).
 * Each email is done once: Gmail labels "Eagle Tracker/Filed", "…/No match" (files in the intake folder → "Council
 * applications (no match)") or "…/Error" (admin emailed; remove the label to retry). Filed and No match are archived
 * (out of the inbox, still under their label); Error stays in the inbox. No committee email (Jim W.,
 * 2026-11-03): every email gets a row on the Council Applications tab; loose matches ("Check") and "No match" are
 * listed in the digest's Awaiting action until a member ticks Checked. Matched ones show in the digest's changes.
 */
var COUNCIL_LABELS = { done: 'Eagle Tracker/Filed', nomatch: 'Eagle Tracker/No match', error: 'Eagle Tracker/Error' };

function runCouncilApps_() {
  var s = getSettings_();
  var raw = s.councilAppFrom;                                 // text "2026-11-03", or a date if Sheets converted it
  var from = raw instanceof Date ? Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(raw || '').trim();
  var m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!m0) return { off: true, filed: 0, nomatch: 0, errors: 0 };
  var since = new Date(+m0[1], +m0[2] - 1, +m0[3]).getTime();
  var q = CouncilApp.QUERY + ' after:' + m0[1] + '/' + m0[2] + '/' + m0[3] + ' ' +
    Object.keys(COUNCIL_LABELS).map(function (k) { return '-label:"' + COUNCIL_LABELS[k] + '"'; }).join(' ');
  ensureCouncilTab_();
  var label = function (k) { return GmailApp.getUserLabelByName(COUNCIL_LABELS[k]) || GmailApp.createLabel(COUNCIL_LABELS[k]); };
  var out = { filed: 0, nomatch: 0, errors: 0 };
  GmailApp.search(q, 0, 10).forEach(function (thread) {
    var outcome = '';
    thread.getMessages().forEach(function (msg) {
      if (!CouncilApp.isMatch(msg.getFrom(), msg.getSubject()) || msg.getDate().getTime() < since) return;
      try {
        var r = fileCouncilApp_(msg);
        outcome = outcome === 'error' ? outcome : r.matched ? 'done' : 'nomatch';
      } catch (e) {
        outcome = 'error';
        console.error('Council application: ' + (e && e.stack || e));
        notifyAdmin_('Council application email not filed', msg.getSubject() + ': ' + (e.userMessage || e.message) +
          '\n\nThe email has the Gmail label "' + COUNCIL_LABELS.error + '". Remove the label to try again.\n' + thread.getPermalink());
      }
    });
    if (!outcome) return;
    thread.addLabel(label(outcome));
    // Out of the inbox once handled (Jim W., 2026-11-04): Filed / No match live under their Eagle Tracker label
    // (the tab, the digest and the dashboard tag track what needs a look). Errors stay in the inbox to be noticed.
    if (outcome !== 'error') { try { thread.moveToArchive(); } catch (e) { console.warn('archive: ' + e); } }
    out[outcome === 'done' ? 'filed' : outcome === 'nomatch' ? 'nomatch' : 'errors']++;
  });
  return out;
}

/** One Formsite email. -> {matched, recordId?, files} */
function fileCouncilApp_(msg) {
  var html = msg.getBody();
  var atts = msg.getAttachments({ includeInlineImages: false });
  var p = CouncilApp.parse(html);
  var tz = Session.getScriptTimeZone();
  var heading = 'Council Eagle application (Formsite #' + p.ref + '), received ' + Utilities.formatDate(msg.getDate(), tz, 'EEE M/d/yyyy h:mm a');
  var emailPdf = function (name) {
    return Utilities.newBlob(CouncilApp.emailHtml(html, heading), 'text/html', 'email.html').getAs('application/pdf').setName(name);
  };
  var hit = CouncilApp.matchRecord(Records.all(['scout_name', 'unit', 'scout_email', 'parent_email', 'preferred_name']), p, Units.code);
  var rec = hit.recordId ? Records.get(hit.recordId) : null;

  if (!rec) {
    var s = getSettings_();
    if (!s.intakeFolderId) throw new Error('Settings → intakeFolderId is empty: run Admin → Setup / repair tabs');
    var who = (p.certName || [p.first, p.last].join(' ')).trim() + (p.unit ? ' (' + p.unit + ')' : '');
    var box = childFolder_(childFolder_(DriveApp.getFolderById(s.intakeFolderId), 'Council applications (no match)'), '#' + p.ref + ' ' + who);
    atts.forEach(function (a) { box.createFile(a.copyBlob().setName(CouncilApp.originalName(a.getName()) || a.getName())); });
    var nl = CouncilApp.plan(p, atts.map(function (a) { return a.getName(); }), who, '', Intake.namePart, Intake.unitPart).links;
    var nf = fetchCouncilLinks_(box, nl.map(function (l) { return Object.assign({}, l, { name: l.original || l.name }); }));
    box.createFile(emailPdf('FormsiteEmail #' + p.ref + '.pdf'));
    councilRow_(msg, p, { 'Match': 'No match', 'How': hit.error, 'Files': atts.length + nf.filed.length, 'Not attached': nf.failed.join('; '), 'Folder': box.getUrl() });
    return { matched: false, files: atts.length + nf.filed.length };
  }

  var folder = folderForRecord_(rec, true);
  var top = listFolder_(folder);
  var old = CouncilApp.toArchive(top);                       // a resubmission: the earlier one goes to Archive/
  if (old.length) {
    var archive = childFolder_(folder, ScoutFiles.ARCHIVE);
    top.forEach(function (f) { if (old.indexOf(f.id) >= 0) f.file.moveTo(archive); });
  }
  var pl = CouncilApp.plan(p, atts.map(function (a) { return a.getName(); }), rec.fields.scout_name, rec.fields.unit, Intake.namePart, Intake.unitPart);
  pl.files.forEach(function (f) { folder.createFile(atts[f.index].copyBlob().setName(f.name)); });
  var got = fetchCouncilLinks_(folder, pl.links);           // big files: Formsite sends links, not attachments
  var notHere = pl.missing.concat(got.failed);
  var nFiles = pl.files.length + got.filed.length;
  folder.createFile(emailPdf(pl.emailName));
  // Promote ONLY a close match in Proposal Approved, through the "Application submitted…" row action (date = the email's;
  // fills Application Submitted, moves the row, logs it, drafts 3.1.a into the Outbox like a member's click).
  var dec = CouncilApp.decide(hit, rec.section);
  var stage = SettingsModel.sectionLabel(getSettings_(), rec.section), moved = '';
  if (dec.promote) {
    try {
      var ymd = Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd');
      var req = { kind: 'app_submitted', recordId: rec.recordId, date: ymd };
      rowExecute_({ email: 'Eagle Tracker', me: { initials: 'Council', name: 'Eagle Tracker' } }, rowCheck_(req), req, []);
      moved = 'moved to Application Submitted (' + Utilities.formatDate(msg.getDate(), tz, 'M/d') + ')';
    } catch (e) {
      dec = { match: 'Stage?', promote: false };
      stage += ' (not moved: ' + (e.userMessage || e.message) + ')';
    }
  }
  councilRow_(msg, p, { 'Match': dec.match, 'Scout': rec.fields.scout_name + ' (' + rec.fields.unit + ')', 'Stage': stage,
    'Record ID': rec.recordId, 'How': hit.how, 'Files': nFiles, 'Not attached': notHere.join('; '), 'Folder': folder.getUrl() });
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [Council] Eagle application submitted on Formsite (#' + p.ref + '): ' +
    (hit.close ? '' : 'CHECK the match (' + hit.how + ', form says ' + [p.first, p.middle, p.last].filter(String).join(' ') +
      (p.unit ? ', ' + p.unit : '') + '); ') +
    nFiles + ' file' + (nFiles === 1 ? '' : 's') + ' filed' + (got.filed.length ? ' (' + got.filed.length + ' from Formsite links)' : '') +
    (old.length ? '; the earlier submission moved to Archive/' : '') + (moved ? '; ' + moved : '') +
    (dec.match === 'Stage?' ? '; NOT moved: the Scout is in ' + stage + ', not Proposal Approved (check it)' : '') +
    (notHere.length ? '. NOT filed (get from Formsite): ' + notHere.join('; ') : ''));
  return { matched: true, recordId: rec.recordId, files: nFiles };
}

function ensureCouncilTab_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CouncilApp.TAB);
  if (!sh) {
    sh = ss.insertSheet(CouncilApp.TAB);
    sh.getRange(1, 1, 1, CouncilApp.HEADERS.length).setValues([CouncilApp.HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return;
  }
  // Columns added later (e.g. Stage, 2026-11-04) go on the right.
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).trim(); });
  var missing = CouncilApp.HEADERS.filter(function (h) { return have.indexOf(h) < 0; });
  if (missing.length) sh.getRange(1, have.filter(String).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}

/** One row per Formsite email on the Council Applications tab; Checked is a checkbox (ticked when "Matched"). */
function councilRow_(msg, p, fields) {
  var row = Tabs.append(CouncilApp.TAB, Object.assign({ 'Received': msg.getDate(), 'Ref': p.ref,
    'Name on form': [p.first, p.middle, p.last].filter(String).join(' '), 'Unit on form': p.unit,
    'Email': msg.getThread().getPermalink() }, fields));
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(CouncilApp.TAB);
    var cell = sh.getRange(row, CouncilApp.HEADERS.indexOf('Checked') + 1);
    cell.insertCheckboxes();
    if (fields['Match'] === 'Matched') cell.check();
  } catch (e) { console.warn('Council Applications checkbox: ' + e); }
}

/** Digest → Awaiting action: loose matches and no-matches not yet Checked. */
function councilAppsToCheck_() {
  var rows;
  try { rows = Tabs.read(CouncilApp.TAB); } catch (e) { return []; }
  return CouncilApp.toCheck(rows, function (d) { return Utilities.formatDate(d, digestTz_(), 'M/d'); });
}

/** Admin menu: run it now (same rules as the hourly trigger). */
function menuCouncilApps() {
  var ui = SpreadsheetApp.getUi();
  if (!councilAccountOk_()) return;
  // A menu item runs as whoever clicks it, and GmailApp reads THAT person's inbox. Only the account that owns the
  // hourly trigger (cc-advancement, which gets the Formsite emails) may run it; triggers are listed per user.
  if (!digestTriggerInstalled_()) {
    ui.alert('Run this as the account that owns the hourly trigger (cc-advancement): the Formsite emails are in its inbox, ' +
      'and this menu reads the inbox of whoever clicks it. Switch to the cc-advancement profile, or let the hourly run do it.');
    return;
  }
  var r = runCouncilApps_();
  if (r.off) { ui.alert('Off: put a date (YYYY-MM-DD) in Settings → councilAppFrom. Only Formsite emails from that day on are filed.'); return; }
  ui.alert('Council application emails: ' + r.filed + ' filed, ' + r.nomatch + ' with no matching Scout, ' + r.errors + ' errors.');
}

/**
 * Files Formsite linked instead of attaching (big submissions): fetch each link into the folder under its planned
 * name. links: [{url, name, label, original}] -> {filed: [names], failed: ['label: file (why)']}. A name already in
 * the folder is skipped (counted as filed), so running it again is safe.
 */
function fetchCouncilLinks_(folder, links) {
  var out = { filed: [], failed: [] };
  if (!links || !links.length) return out;
  var have = listFolder_(folder).map(function (f) { return f.name; });
  links.forEach(function (l) {
    if (have.indexOf(l.name) >= 0) { out.filed.push(l.name); return; }
    try {
      var r = UrlFetchApp.fetch(l.url, { muteHttpExceptions: true, followRedirects: true });
      var blob = r.getBlob();
      var why = CouncilApp.fetchProblem(r.getResponseCode(), blob.getContentType(), blob.getBytes().length);
      if (why) { out.failed.push(l.label + ': ' + l.original + ' (' + why + ')'); return; }
      folder.createFile(blob.setName(l.name));
      out.filed.push(l.name);
    } catch (e) { out.failed.push(l.label + ': ' + l.original + ' (' + (e.message || e) + ')'); }
  });
  return out;
}

/**
 * Admin menu → "Council applications: fetch linked files (earlier emails)". For rows on the Council Applications tab
 * with something in "Not attached" (filed before links were fetched, Jim W. 2026-11-09): find the email by its
 * Formsite reference, fetch the linked files into the Scout's folder, update the row and log it. Safe to run again.
 */
function menuCouncilFetchLinks() {
  var ui = SpreadsheetApp.getUi();
  if (!councilAccountOk_()) return;
  if (!digestTriggerInstalled_()) {
    ui.alert('Run this as the account that owns the hourly trigger (cc-advancement): the Formsite emails are in its inbox.');
    return;
  }
  var r = councilFetchLinks_();
  ui.alert('Council applications: ' + r.rows + ' row(s) with files not filed. ' + r.filed + ' file(s) fetched from Formsite links.' +
    (r.problems.length ? '\n\nStill not filed:\n' + r.problems.slice(0, 15).join('\n') : ''));
}

function councilFetchLinks_() {
  var out = { rows: 0, filed: 0, problems: [] };
  Tabs.read(CouncilApp.TAB).forEach(function (row) {
    if (!String(row['Not attached'] || '').trim() || !String(row['Ref'] || '').trim()) return;
    out.rows++;
    var ref = String(row['Ref']).trim();
    var msg = null;
    GmailApp.search(CouncilApp.QUERY + ' "' + ref + '"', 0, 5).forEach(function (t) {
      t.getMessages().forEach(function (m) { if (!msg && CouncilApp.isMatch(m.getFrom(), m.getSubject()) && CouncilApp.parse(m.getBody()).ref === ref) msg = m; });
    });
    if (!msg) { out.problems.push('#' + ref + ': email not found'); return; }
    var p = CouncilApp.parse(msg.getBody());
    var atts = msg.getAttachments({ includeInlineImages: false }).map(function (a) { return a.getName(); });
    var rec = String(row['Record ID'] || '').trim() ? Records.get(String(row['Record ID']).trim()) : null;
    var folder, links;
    if (rec) {
      folder = folderForRecord_(rec, true);
      links = CouncilApp.plan(p, atts, rec.fields.scout_name, rec.fields.unit, Intake.namePart, Intake.unitPart).links;
    } else {
      var m = /\/folders\/([A-Za-z0-9_-]+)/.exec(String(row['Folder'] || ''));
      if (!m) { out.problems.push('#' + ref + ': no folder'); return; }
      folder = DriveApp.getFolderById(m[1]);
      links = CouncilApp.plan(p, atts, 'x', '', Intake.namePart, Intake.unitPart).links
        .map(function (l) { return Object.assign({}, l, { name: l.original || l.name }); });
    }
    var got = fetchCouncilLinks_(folder, links);
    out.filed += got.filed.length;
    got.failed.forEach(function (f) { out.problems.push('#' + ref + ' ' + f); });
    Tabs.update(CouncilApp.TAB, row._row, { 'Files': (Number(row['Files']) || 0) + got.filed.length, 'Not attached': got.failed.join('; ') });
    if (rec && got.filed.length) {
      addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [Council] Formsite #' + ref + ': ' + got.filed.length +
        ' linked file(s) fetched into the folder' + (got.failed.length ? '; still NOT filed: ' + got.failed.join('; ') : ''));
    }
  });
  return out;
}
