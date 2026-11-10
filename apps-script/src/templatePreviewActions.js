/**
 * Email template preview (Admin page): render any catalog email from the template Doc (read fresh, not cached) or
 * the built-in wording, with sample values (lib/templateSamples.js); optionally send it ONLY to the member asking,
 * inside TEST banners, no Cc.
 *   templateList    {session}             -> {templates:[{id, key, phase, source, mode, cc, recipients}]}
 *   templatePreview {session, key, send}  -> {subject, html, text, source, mode, cc, recipients, problems, message?}
 */
function previewTabs_() {
  var id = String(getSettings_().templatesDocId || '').trim();
  if (!id) return {};
  try { return readTemplateDoc_(id); } catch (e) { return {}; }
}

function previewOne_(x, tabs) {
  var vars = TemplateSamples.vars(x);
  var title = TemplateCatalog.findTab(tabs, x.key);
  var out = { id: x.id, key: x.key, phase: TemplateCatalog.phaseOf(x.id), recipients: x.recipients || '', problems: [] };
  if (title && tabs[title]) {
    var tab = Templates.parseTab(tabs[title]);
    var r = Templates.render(tab, vars);
    out.source = 'Doc tab "' + title + '"';
    out.mode = tab.mode; out.cc = tab.cc || 'group';
    out.subject = r.subject || x.subject; out.text = r.text; out.html = r.html;
    out.problems = r.errors || [];
  } else {
    var p = reviewBuiltIn_(x, vars);
    out.source = 'built-in wording (no Doc tab)';
    out.mode = x.mode; out.cc = x.cc;
    out.subject = p.subject; out.text = p.body; out.html = Outbox.textToHtml(p.body);
    out.problems = ['No tab in the template Doc: Admin → Templates: create Doc / add missing tabs.'];
  }
  return out;
}

function actionTemplateList_(req) {
  committeeMe_(req.session);
  var tabs = previewTabs_();
  return { templates: TemplateCatalog.LIST.map(function (x) {
    var p = previewOne_(x, tabs);
    return { id: p.id, key: p.key, phase: p.phase, source: p.source, mode: p.mode, cc: p.cc, recipients: p.recipients, problems: p.problems.length };
  }).sort(function (a, b) { return TemplateCatalog.cmpId(a.id, b.id); }) };
}

function actionTemplatePreview_(req) {
  var c = committeeMe_(req.session);
  var x = TemplateCatalog.get(String(req.key || ''));
  if (!x) throw userError_('Unknown email: ' + req.key);
  var p = previewOne_(x, previewTabs_());
  if (req.send) {
    var w = TemplateSamples.wrap(p.subject, p.text, p.html, { id: p.id, key: p.key, source: p.source, mode: p.mode,
      cc: p.cc === 'group' ? 'committee group' : '', recipients: p.recipients, to: c.email });
    var res = sendMail_({ to: c.email, subject: w.subject, body: w.body, htmlBody: w.html });   // no Cc, ever
    p.message = res.send ? 'Test copy sent to ' + res.to.join(', ') + '.' : 'Not sent: ' + res.reason;
  }
  return p;
}
