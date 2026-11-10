/**
 * Email templates from a Google Doc, one tab per email (email-review-design.md, step 1).
 * Rules in lib/templates.js, the list of emails and their starting wording in lib/templateCatalog.js.
 *
 * Settings → templatesDocId blank = every email uses the built-in wording (exactly as before).
 * Set = the tab named like the email is used (HTML + plain text). A missing tab, a broken tab
 * (unknown placeholder, no "----") or any read error falls back to the built-in wording, and the
 * admin is told (at most every 6 hours per tab).
 * Mode: Off on a tab = that email is not sent. Mode: Review = Outbox (step 2); until then it sends.
 */

/** Tab title -> paragraphs (JSON-safe), cached ~5 minutes. null when no Doc is set. */
function templateTabs_() {
  var id = String(getSettings_().templatesDocId || '').trim();
  if (!id) return null;
  if (templateTabs_._memo) return templateTabs_._memo;
  templateTabs_._memo = cached_('c:templates', function () { return readTemplateDoc_(id); });
  return templateTabs_._memo;
}

function readTemplateDoc_(id) {
  var doc = DocumentApp.openById(id);
  var out = {};
  var walk = function (tabs) {
    tabs.forEach(function (tab) {
      var title = String(tab.getTitle() || '').trim();
      if (title && title !== TemplateCatalog.HOWTO_TITLE) out[title] = docParas_(tab.asDocumentTab().getBody());
      walk(tab.getChildTabs());
    });
  };
  walk(doc.getTabs());
  return out;
}

var ORDERED_GLYPHS_ = null;
var HEADINGS_ = null;

/** Body → [{ runs, list, heading }] (lib/templates.js paragraph shape). */
function docParas_(body) {
  if (!ORDERED_GLYPHS_) {
    ORDERED_GLYPHS_ = [DocumentApp.GlyphType.NUMBER, DocumentApp.GlyphType.LATIN_UPPER, DocumentApp.GlyphType.LATIN_LOWER,
      DocumentApp.GlyphType.ROMAN_UPPER, DocumentApp.GlyphType.ROMAN_LOWER];
    HEADINGS_ = {};
    HEADINGS_[DocumentApp.ParagraphHeading.HEADING1] = 1; HEADINGS_[DocumentApp.ParagraphHeading.TITLE] = 1;
    HEADINGS_[DocumentApp.ParagraphHeading.HEADING2] = 2; HEADINGS_[DocumentApp.ParagraphHeading.SUBTITLE] = 2;
    HEADINGS_[DocumentApp.ParagraphHeading.HEADING3] = 3;
  }
  var out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    var type = el.getType();
    if (type !== DocumentApp.ElementType.PARAGRAPH && type !== DocumentApp.ElementType.LIST_ITEM) continue;   // tables, images: ignored
    var p = type === DocumentApp.ElementType.PARAGRAPH ? el.asParagraph() : el.asListItem();
    var text = p.editAsText();
    var s = text.getText();
    var runs = [];
    if (s.length) {
      var idx = text.getTextAttributeIndices();
      for (var k = 0; k < idx.length; k++) {
        var a = idx[k], b = k + 1 < idx.length ? idx[k + 1] : s.length;
        if (b <= a) continue;
        runs.push({ text: s.slice(a, b), bold: !!text.isBold(a), italic: !!text.isItalic(a), underline: !!text.isUnderline(a),
          color: text.getForegroundColor(a) || '', bg: text.getBackgroundColor(a) || '', link: text.getLinkUrl(a) || '' });
      }
    }
    var para = { runs: runs, list: null, heading: 0 };
    if (type === DocumentApp.ElementType.LIST_ITEM) {
      para.list = { ordered: ORDERED_GLYPHS_.indexOf(p.getGlyphType()) >= 0, level: p.getNestingLevel() || 0, id: String(p.getListId() || '') };
    } else {
      para.heading = HEADINGS_[p.getHeading()] || 0;
    }
    out.push(para);
  }
  return out;
}

/**
 * Send msg ({to, cc, subject, body, kind, committee, by, recordId, scout, outbox, attachments}) using the template tab `key`
 * when there is one. committee: true when a committee member caused it (then "Mode: Review" queues it in the Outbox).
 * outbox: true = always a draft in the Outbox, whatever the tab's mode (except Off). attachments: [{id, name}] Drive files.
 * msg.subject/body = the built-in wording (fallback). vars: placeholder values.
 * Returns what sendMail_ returns, or { send: false, reason: 'template off' }.
 */
/** Set by the "Email…" action (emailActions.js): every email made while set is drafted into the Outbox, by that member. */
var FORCE_OUTBOX_ = null;

function mailFromTemplate_(key, vars, msg) {
  if (FORCE_OUTBOX_ && msg.kind !== 'signin') msg = Object.assign({}, msg, { outbox: true, committee: true, by: FORCE_OUTBOX_.by || msg.by });
  var tabs = null;
  try { tabs = templateTabs_(); } catch (e) { templateProblem_(key, 'Could not read the template Doc: ' + e.message); }
  var paras = tabs && tabs[TemplateCatalog.findTab(tabs, key)];      // by the tab's leading ID (e.g. "2.3.a ..."), else the old title
  if (!paras) {
    var x0 = TemplateCatalog.get(key);
    if (tabs) templateProblem_(key, 'No tab "' + (x0 ? TemplateCatalog.tabTitle(x0) : key) + '" in the template Doc (Admin → Templates: create Doc / add missing tabs).');
    return msg.outbox ? queueBuiltIn_(key, msg) : sendMail_(msg);
  }
  var tab = Templates.parseTab(paras);
  if (tab.mode === 'off') { console.log('Template "' + key + '" is Off: not sent'); return { send: false, reason: 'template off' }; }
  var r = Templates.render(tab, vars || {});
  if (r.errors.length) {
    templateProblem_(key, r.errors.join(' ') + ' The built-in wording was ' + (msg.outbox ? 'used' : 'sent') + ' instead.');
    return msg.outbox ? queueBuiltIn_(key, msg) : sendMail_(msg);
  }
  var out = { to: msg.to, cc: msg.cc, bcc: msg.bcc, kind: msg.kind, subject: r.subject || msg.subject, body: r.text, htmlBody: r.html };
  var group = getSettings_().committeeGroupEmail || '';
  // Cc line of the tab: none = only the addresses that always go (msg.keepCc: the parent/guardian); group = add the group.
  if (tab.cc === 'none') out.cc = MailPlan.merge(msg.keepCc);
  else if (tab.cc === 'group' && msg.kind !== 'signin' && group) out.cc = MailPlan.merge(out.cc, group);
  // A committee member caused it and the tab says Review (or the caller always wants a draft, msg.outbox):
  // wait in the Outbox (committee page) instead of sending.
  if ((tab.mode === 'review' || msg.outbox) && msg.committee && msg.kind !== 'signin') {
    var id = queueOutbox_(key, out, msg);
    return { send: false, queued: true, id: id, reason: 'waiting in the Outbox' };
  }
  return sendMail_(out);
}

/** msg.outbox with no usable template tab: queue the built-in wording (plain text shown as HTML). */
function queueBuiltIn_(key, msg) {
  var group = getSettings_().committeeGroupEmail || '';
  var out = { to: msg.to, cc: msg.cc ? msg.cc : MailPlan.merge(msg.keepCc, group), subject: msg.subject, body: msg.body, htmlBody: Outbox.textToHtml(msg.body) };
  var id = queueOutbox_(key, out, msg);
  return { send: false, queued: true, id: id, reason: 'waiting in the Outbox' };
}

/** Tell the admin about a template problem at most every 6 hours per tab. */
function templateProblem_(key, what) {
  console.warn('Template "' + key + '": ' + what);
  try {
    var c = CacheService.getScriptCache();
    if (c.get('tplerr:' + key)) return;
    c.put('tplerr:' + key, '1', 6 * 3600);
  } catch (e) {}
  notifyAdmin_('Email template problem: ' + key, what + '\n\nTemplate Doc: https://docs.google.com/document/d/' +
    getSettings_().templatesDocId + '/edit');
}

/** Self-check line. */
function templatesStatus_() {
  var s = getSettings_();
  if (!String(s.templatesDocId || '').trim()) return 'Email templates: built-in wording (Settings → templatesDocId is blank).';
  uncache_('c:templates');
  templateTabs_._memo = null;
  var tabs;
  try { tabs = templateTabs_(); } catch (e) { return 'Email templates: CANNOT READ the Doc (' + e.message + ').'; }
  var probs = [];
  TemplateCatalog.LIST.forEach(function (x) {
    var title = TemplateCatalog.findTab(tabs, x.key);
    if (!title) { probs.push('missing tab "' + TemplateCatalog.tabTitle(x) + '"'); return; }
    if (!TemplateCatalog.idOf(title)) probs.push('"' + title + '" has no ID yet (Admin → Templates: number the tabs)');
    var vars = {};
    x.vars.forEach(function (v) { vars[v] = 'x'; });
    var r = Templates.render(Templates.parseTab(tabs[title]), vars);
    if (r.errors.length) probs.push('"' + x.key + '": ' + r.errors.join(' '));
  });
  return 'Email templates: Doc with ' + Object.keys(tabs).length + ' tabs' + (probs.length ? '. PROBLEMS: ' + probs.join('; ') : ', all OK.');
}

/**
 * Admin → "Templates: create Doc / add missing tabs". Creates "Eagle Tracker email templates" next to this
 * spreadsheet (as the account that runs it) with a How-to tab and one tab per email (today's wording),
 * adds tabs that are missing, and fills tabs that are still EMPTY. Never changes a tab someone wrote in.
 */
function menuTemplatesDoc() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var res = ensureTemplateDoc_();
    ui.alert((res.created ? 'Created the template Doc' : 'Template Doc checked') + ': ' + res.added + ' tab(s) added, ' + res.filled +
      ' empty tab(s) filled with the current wording.\n\n' + res.url +
      '\n\nShare it with the committee (edit or suggest). Emails use it from now on (changes show within about 5 minutes).');
  } catch (e) { ui.alert('Templates: ' + e.message); }
}

function ensureTemplateDoc_() {
  var s = getSettings_();
  var id = String(s.templatesDocId || '').trim();
  var created = false;
  if (!id) {
    var d = DocumentApp.create('Eagle Tracker email templates');
    id = d.getId();
    d.saveAndClose();
    try {
      var parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
      if (parents.hasNext()) DriveApp.getFileById(id).moveTo(parents.next());
    } catch (e) { console.warn('Template Doc not moved next to the sheet: ' + e); }
    setSetting_('templatesDocId', id);
    created = true;
  }
  // Existing tab titles (Docs API: tabs can only be added there).
  var meta = Docs.Documents.get(id, { includeTabsContent: true });
  var titles = [], firstId = '';
  var walk = function (tabs) {
    (tabs || []).forEach(function (t) {
      if (!firstId) firstId = t.tabProperties.tabId;
      titles.push(String(t.tabProperties.title || '').trim());
      walk(t.childTabs);
    });
  };
  walk(meta.tabs);
  var requests = [];
  if (created && firstId) {
    requests.push({ updateDocumentTabProperties: { tabProperties: { tabId: firstId, title: TemplateCatalog.HOWTO_TITLE }, fields: 'title' } });
  }
  var have = {};
  titles.forEach(function (t) { have[t] = 1; });
  var missing = TemplateCatalog.LIST.filter(function (x) { return !TemplateCatalog.findTab(have, x.key); });
  missing.forEach(function (x) { requests.push({ addDocumentTab: { tabProperties: { title: TemplateCatalog.tabTitle(x) } } }); });
  if (requests.length) Docs.Documents.batchUpdate({ requests: requests }, id);

  // Fill every template tab that is still empty (and a How-to tab with less than a few lines), via the Docs API.
  var tabsNow = [];
  var walk2 = function (tabs) { (tabs || []).forEach(function (t) { tabsNow.push(t); walk2(t.childTabs); }); };
  walk2(Docs.Documents.get(id, { includeTabsContent: true }).tabs);
  var inserts = [], styles = [], filled = 0;
  tabsNow.forEach(function (t) {
    var title = String(t.tabProperties.title || '').trim();
    var isHow = title === TemplateCatalog.HOWTO_TITLE;
    var x = TemplateCatalog.get(title);
    if (!x && !isHow) return;
    var info = tabText_(t);
    var lineCount = info.text.split('\n').filter(function (l) { return l.trim(); }).length;
    if (isHow ? lineCount >= 3 : lineCount > 0) return;            // someone wrote in it: leave it alone
    var plan = TemplateCatalog.fillPlan(isHow ? TemplateCatalog.howTo() : TemplateCatalog.seedLines(x), isHow);
    var tabId = t.tabProperties.tabId;
    if (info.end > 2) inserts.push({ deleteContentRange: { range: { startIndex: 1, endIndex: info.end - 1, tabId: tabId } } });
    inserts.push({ insertText: { location: { index: 1, tabId: tabId }, text: plan.text } });
    // New paragraphs inherit the style of the one they were typed into (e.g. an old heading): reset to normal text first.
    styles.push({ updateParagraphStyle: { range: { startIndex: 1, endIndex: 1 + plan.text.length, tabId: tabId },
      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } });
    plan.bullets.forEach(function (r) {
      styles.push({ createParagraphBullets: { range: { startIndex: r[0], endIndex: r[1], tabId: tabId }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
    });
    plan.grey.forEach(function (r) {
      styles.push({ updateTextStyle: { range: { startIndex: r[0], endIndex: r[1], tabId: tabId },
        textStyle: { foregroundColor: { color: { rgbColor: { red: 0.42, green: 0.42, blue: 0.4 } } } }, fields: 'foregroundColor' } });
    });
    if (plan.heading) styles.push({ updateParagraphStyle: { range: { startIndex: plan.heading[0], endIndex: plan.heading[1], tabId: tabId },
      paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } });
    filled++;
  });
  if (inserts.length) Docs.Documents.batchUpdate({ requests: inserts.concat(styles) }, id);
  uncache_('c:templates');
  return { created: created, added: missing.length, filled: filled, url: 'https://docs.google.com/document/d/' + id + '/edit' };
}

/** A tab's plain text and the end index of its body (Docs API structure). */
function tabText_(t) {
  var content = (t.documentTab && t.documentTab.body && t.documentTab.body.content) || [];
  var text = '', end = 1;
  content.forEach(function (el) {
    if (el.endIndex) end = Math.max(end, el.endIndex);
    if (el.paragraph) (el.paragraph.elements || []).forEach(function (pe) { if (pe.textRun) text += pe.textRun.content; });
  });
  return { text: text, end: end };
}

// ---------- IDs on the tabs, and the catalog (Jim W., 2026-10-24) ----------

/**
 * Docs API: every tab in document order. includeTabsContent must be true: with false the API returns the first
 * tab's text in the old body fields and NO tabs list at all (that made "number the tabs" find 0 tabs).
 */
function templateDocTabs_(id) {
  var out = [];
  var walk = function (tabs) { (tabs || []).forEach(function (t) { out.push(t); walk(t.childTabs); }); };
  walk(Docs.Documents.get(id, { includeTabsContent: true }).tabs);
  return out;
}

/**
 * Admin → "Templates: number the tabs". Renames "Proposal approved" to "2.3.a Proposal approved" (content untouched).
 * Tabs that already start with an ID are left alone; tabs the tool doesn't know are reported, not touched.
 */
function menuNumberTemplateTabs() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  var id = String(getSettings_().templatesDocId || '').trim();
  if (!id) { ui.alert('No template Doc yet (Admin → Templates: create Doc / add missing tabs).'); return; }
  var requests = [], renamed = [], unknown = [];
  templateDocTabs_(id).forEach(function (t) {
    var title = String(t.tabProperties.title || '').trim();
    if (title === TemplateCatalog.HOWTO_TITLE || title === TemplateCatalog.MAP_TITLE || TemplateCatalog.idOf(title)) return;
    var x = TemplateCatalog.get(title);
    if (!x) { unknown.push(title); return; }
    requests.push({ updateDocumentTabProperties: { tabProperties: { tabId: t.tabProperties.tabId, title: TemplateCatalog.tabTitle(x) }, fields: 'title' } });
    renamed.push(TemplateCatalog.tabTitle(x));
  });
  if (requests.length) Docs.Documents.batchUpdate({ requests: requests }, id);
  uncache_('c:templates');
  ui.alert('Numbered ' + renamed.length + ' tab(s).' + (unknown.length ? '\n\nNot used by the tool (leave or delete): ' + unknown.join(', ') : ''));
}

/**
 * Admin → "Templates: rebuild catalog". A Google Sheet next to the template Doc (Settings → templatesCatalogId),
 * generated from the code and the Doc: one row per email, sorted by ID, with a link that opens its tab.
 * Only "Committee notes" is typed by hand; it is kept across rebuilds (matched by ID).
 */
function menuTemplatesCatalog() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var r = rebuildTemplateCatalog_();
    ui.alert('Catalog rebuilt: ' + r.rows + ' emails.\n\n' + r.url + (r.mapAdded ? '\n\nAdded the "' + TemplateCatalog.MAP_TITLE + '" tab to the template Doc.' : '') +
      (r.moveNote ? '\n\n' + r.moveNote : ''));
  } catch (e) { ui.alert('Catalog: ' + e.message); }
}

var CATALOG_HEADERS_ = ['ID', 'Email (template)', 'Phase', 'From stage', 'To stage / event', 'When it is sent', 'To', 'Cc', 'Status', 'Committee notes'];

function rebuildTemplateCatalog_() {
  var s = getSettings_();
  var docId = String(s.templatesDocId || '').trim();
  if (!docId) throw new Error('No template Doc yet (Admin → Templates: create Doc / add missing tabs).');
  // The Doc's tabs: title -> {tabId, mode}.
  uncache_('c:templates');
  templateTabs_._memo = null;
  var paras = templateTabs_() || {};
  var meta = {};
  templateDocTabs_(docId).forEach(function (t) { meta[String(t.tabProperties.title || '').trim()] = t.tabProperties.tabId; });
  var info = function (key) {
    var title = TemplateCatalog.findTab(paras, key);
    if (!title) return null;
    return { title: title, tabId: meta[title] || '', mode: Templates.parseTab(paras[title]).mode };
  };
  var rows = TemplateCatalog.catalogRows(info);

  // The sheet (created next to the Doc the first time).
  var ssId = String(s.templatesCatalogId || '').trim(), ss = null, moveNote = '';
  if (ssId) { try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Eagle Tracker email catalog');
    try {
      var parents = DriveApp.getFileById(docId).getParents();
      if (parents.hasNext()) DriveApp.getFileById(ss.getId()).moveTo(parents.next());
    } catch (e) { moveNote = 'Could not move it next to the template Doc (' + e.message + '): move it there by hand; the link keeps working.'; }
    setSetting_('templatesCatalogId', ss.getId());
  }
  var sh = ss.getSheets()[0];
  if (sh.getName() !== 'Catalog') sh.setName('Catalog');
  var notes = {};
  if (sh.getLastRow() > 1) {
    var old = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
    var hi = old[0].map(String), iId = hi.indexOf('ID'), iN = hi.indexOf('Committee notes');
    if (iId >= 0 && iN >= 0) old.slice(1).forEach(function (r) { if (String(r[iId])) notes[String(r[iId])] = r[iN]; });
  }
  var docUrl = 'https://docs.google.com/document/d/' + docId + '/edit';
  var values = rows.map(function (r) {
    var name = r.tabId ? '=HYPERLINK("' + docUrl + '?tab=' + r.tabId + '","' + String(r.name).replace(/"/g, '""') + '")' : r.name;
    return [r.id, name, r.phase, r.from, r.to, r.trigger, r.recipients, r.cc, r.status, notes[r.id] || ''];
  });
  sh.clear();
  sh.getRange(1, 1, 1, CATALOG_HEADERS_.length).setValues([CATALOG_HEADERS_]).setFontWeight('bold').setBackground('#e8eaed');
  if (values.length) sh.getRange(2, 1, values.length, CATALOG_HEADERS_.length).setValues(values);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  [60, 260, 120, 200, 200, 300, 220, 120, 140, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(2, 1, Math.max(values.length, 1), CATALOG_HEADERS_.length).setWrap(true).setVerticalAlignment('top');
  sh.getRange(1, 1).setNote('Generated by Eagle Tracker (Admin → Templates: rebuild catalog) from the code and the template Doc. ' +
    'Only "Committee notes" is kept across rebuilds. Click an email name to open its tab. Status comes from the tab\'s Mode line.');
  // Status colours.
  var st = sh.getRange(2, 9, Math.max(values.length, 1), 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('Off').setBackground('#f4cccc').setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('Planned').setFontColor('#80868b').setRanges([sh.getRange(2, 1, Math.max(values.length, 1), CATALOG_HEADERS_.length)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('Template tab missing').setBackground('#fce8b2').setRanges([st]).build()
  ]);
  var mapAdded = ensureCatalogTab_(docId, ss.getUrl());
  return { rows: values.length, url: ss.getUrl(), mapAdded: mapAdded, moveNote: moveNote };
}

/** The tab right after "How to edit": a link to the catalog sheet. Added once; its text is never overwritten. */
function ensureCatalogTab_(docId, url) {
  var tabs = templateDocTabs_(docId);
  var has = tabs.filter(function (t) { return String(t.tabProperties.title || '').trim() === TemplateCatalog.MAP_TITLE; })[0];
  var added = false;
  if (!has) {
    var req = { addDocumentTab: { tabProperties: { title: TemplateCatalog.MAP_TITLE, index: 1 } } };
    try { Docs.Documents.batchUpdate({ requests: [req] }, docId); }
    catch (e) { delete req.addDocumentTab.tabProperties.index; Docs.Documents.batchUpdate({ requests: [req] }, docId); }
    added = true;
    has = templateDocTabs_(docId).filter(function (t) { return String(t.tabProperties.title || '').trim() === TemplateCatalog.MAP_TITLE; })[0];
  }
  if (!has) return added;
  if (tabText_(has).text.trim()) return added;                       // someone wrote in it: leave it
  var tabId = has.tabProperties.tabId;
  var lead = 'Every email the tool sends, with its ID, when it is sent, to whom and whether it is on (Automatic / Review / Off), ' +
    'is listed in the email catalog. Click an email there to jump to its tab here.\n\n';
  var link = 'Open the email catalog';
  var tail = '\n\nThe catalog is generated (Admin → Templates: rebuild catalog); add your comments in its "Committee notes" column.\n';
  Docs.Documents.batchUpdate({ requests: [
    { insertText: { location: { index: 1, tabId: tabId }, text: lead + link + tail } },
    { updateTextStyle: { range: { startIndex: 1 + lead.length, endIndex: 1 + lead.length + link.length, tabId: tabId },
      textStyle: { link: { url: url }, bold: true }, fields: 'link,bold' } }
  ] }, docId);
  return added;
}
