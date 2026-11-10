/**
 * Templates: email wording kept in a Google Doc, one tab per email (email-review-design.md).
 *
 * Pure. The adapter (templateMail.js) reads the Doc's tabs into "paragraph" objects:
 *   { runs: [{ text, bold, italic, underline, color, bg, link }], list: null | { ordered, level, id }, heading: 0-3 }
 * and asks render() for { subject, html, text }.
 *
 * A tab looks like:
 *   Subject: Next step: book your Pre-Review Call ({scout})
 *   Mode: Automatic          Automatic | Review | Off   (Review = Outbox, step 2; until then it sends like Automatic)
 *   Cc: group                group | none
 *   ----
 *   Body with formatting and {placeholders}.
 *
 * Rules:
 *  - {name} is replaced by the value; unknown names are errors (the email is not sent from the template).
 *  - A paragraph whose placeholders are ALL empty is left out (e.g. "Where: {where}" for an online call).
 *  - A paragraph that is only a list placeholder ({files}, {entries}, {changes}) becomes a bulleted list.
 *  - Values that are web addresses become links.
 */
var Templates = (function () {
  function str(v) { return v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var PH = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

  function paraText(p) { return (p.runs || []).map(function (r) { return str(r.text); }).join(''); }

  /** Header lines (Subject/Mode/Cc) above a "----" line. -> { subject, mode, cc, body: [paragraphs], errors } */
  function parseTab(paras) {
    var out = { subject: '', mode: 'automatic', cc: '', body: [], errors: [] };
    var list = paras || [];
    var sep = -1;
    for (var i = 0; i < list.length; i++) { if (/^\s*-{3,}\s*$/.test(paraText(list[i]))) { sep = i; break; } }
    if (sep < 0) { out.errors.push('No "----" line between the Subject/Mode/Cc lines and the email text.'); out.body = list; return out; }
    // Header lines; a soft line break (Shift+Enter) inside one paragraph counts as a new line.
    var lines = [];
    list.slice(0, sep).forEach(function (p) { lines = lines.concat(String(paraText(p)).split(/[\r\n\v\u2028]+/)); });
    lines.forEach(function (line) {
      var m = /^\s*(subject|mode|cc)\s*:\s*(.*)$/i.exec(line);
      if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'subject') out.subject = v;
      else if (k === 'mode') {
        var mv = v.toLowerCase().split(/\s/)[0];
        if (['automatic', 'review', 'off'].indexOf(mv) < 0) out.errors.push('Mode must be Automatic, Review or Off (found "' + v + '").');
        else out.mode = mv;
      } else if (k === 'cc') {
        var cv = v.toLowerCase().split(/\s/)[0];
        if (['group', 'none'].indexOf(cv) < 0) out.errors.push('Cc must be group or none (found "' + v + '").');
        else out.cc = cv;
      }
    });
    if (!out.subject) out.errors.push('No "Subject:" line.');
    out.body = list.slice(sep + 1);
    return out;
  }

  /** Placeholders used anywhere in the tab that vars don't define. */
  function unknownNames(tab, vars) {
    var bad = [];
    var check = function (t) { str(t).replace(PH, function (m, n) { if (!(n in vars) && bad.indexOf(n) < 0) bad.push(n); return m; }); };
    check(tab.subject);
    (tab.body || []).forEach(function (p) { check(paraText(p)); });
    return bad;
  }

  function isUrl(v) { return /^https?:\/\/\S+$/.test(str(v).trim()); }
  function valueText(v) { return Array.isArray(v) ? v.join(', ') : str(v); }
  function valueHtml(v) {
    if (Array.isArray(v)) return v.map(esc).join(', ');
    return isUrl(v) ? '<a href="' + esc(str(v).trim()) + '">' + esc(str(v).trim()) + '</a>' : esc(v).replace(/\n/g, '<br>');
  }

  /** Merge runs so no placeholder is split across two runs (the first run's style wins). */
  function joinSplit(runs) {
    var out = [];
    (runs || []).forEach(function (r) {
      var last = out[out.length - 1];
      if (last && /\{[A-Za-z0-9]*$/.test(last.text)) { last.text += str(r.text); return; }
      out.push({ text: str(r.text), bold: r.bold, italic: r.italic, underline: r.underline, color: r.color, bg: r.bg, link: r.link });
    });
    return out;
  }

  function fill(text, vars, asHtml) {
    if (!asHtml) return str(text).replace(PH, function (m, n) { return n in vars ? valueText(vars[n]) : m; });
    var parts = [], last = 0, t = str(text);
    t.replace(PH, function (m, n, at) {
      parts.push(esc(t.slice(last, at)));
      parts.push(n in vars ? valueHtml(vars[n]) : esc(m));
      last = at + m.length;
      return m;
    });
    parts.push(esc(t.slice(last)));
    return parts.join('');
  }

  function runHtml(r, vars) {
    var h = fill(r.text, vars, true);
    if (!h) return '';
    if (r.link) h = '<a href="' + esc(r.link) + '">' + h + '</a>';
    if (r.bold) h = '<b>' + h + '</b>';
    if (r.italic) h = '<i>' + h + '</i>';
    if (r.underline && !r.link) h = '<u>' + h + '</u>';
    var css = [];
    if (r.color && !/^#0{6}$/i.test(r.color)) css.push('color:' + r.color);
    if (r.bg) css.push('background-color:' + r.bg);
    if (css.length) h = '<span style="' + css.join(';') + '">' + h + '</span>';
    return h;
  }

  /** Placeholders in a paragraph all empty? (then the paragraph is left out) */
  function allEmpty(text, vars) {
    var names = [];
    str(text).replace(PH, function (m, n) { names.push(n); return m; });
    if (!names.length) return false;
    return names.every(function (n) { var v = vars[n]; return Array.isArray(v) ? !v.length : !str(v).trim(); });
  }

  /** "{files}" alone in a paragraph with an array value -> that array (rendered as a list). */
  function listValue(text, vars) {
    var m = /^\s*\{([A-Za-z][A-Za-z0-9]*)\}\s*$/.exec(str(text));
    return m && Array.isArray(vars[m[1]]) ? vars[m[1]] : null;
  }

  var HEAD = { 1: 'font-size:20px;font-weight:bold', 2: 'font-size:17px;font-weight:bold', 3: 'font-size:15px;font-weight:bold' };

  /**
   * tab: parseTab() result. vars: { name: string | string[] }.
   * -> { subject, html, text, errors }   (errors non-empty = don't use)
   */
  function render(tab, vars) {
    vars = vars || {};
    var errors = (tab.errors || []).slice();
    var bad = unknownNames(tab, vars);
    if (bad.length) errors.push('Unknown placeholder' + (bad.length > 1 ? 's' : '') + ': ' + bad.map(function (b) { return '{' + b + '}'; }).join(', '));
    var html = [], text = [];
    var open = [];                                          // list stack: [{ordered, level}]
    var closeTo = function (level) {
      while (open.length && open[open.length - 1].level >= level) html.push(open.pop().ordered ? '</ol>' : '</ul>');
    };
    var counters = {};
    (tab.body || []).forEach(function (p) {
      var raw = paraText(p);
      if (allEmpty(raw, vars)) return;
      var lv = listValue(raw, vars);
      if (p.list) {
        var level = p.list.level || 0;
        closeTo(level + 1);
        if (!open.length || open[open.length - 1].level < level) {
          open.push({ ordered: !!p.list.ordered, level: level });
          html.push(p.list.ordered ? '<ol style="margin:0 0 0 0;padding-left:24px">' : '<ul style="margin:0;padding-left:24px">');
        }
        var key = (p.list.id || '') + ':' + level;
        counters[key] = (counters[key] || 0) + 1;
        html.push('<li>' + joinSplit(p.runs).map(function (r) { return runHtml(r, vars); }).join('') + '</li>');
        text.push(new Array(level + 1).join('  ') + (p.list.ordered ? counters[key] + '. ' : '- ') + fill(raw, vars, false));
        return;
      }
      closeTo(0);
      if (lv) {
        html.push('<ul style="margin:0;padding-left:24px">' + lv.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
        lv.forEach(function (x) { text.push('  - ' + x); });
        return;
      }
      var inner = joinSplit(p.runs).map(function (r) { return runHtml(r, vars); }).join('');
      var style = HEAD[p.heading] ? ' style="' + HEAD[p.heading] + '"' : '';
      html.push('<div' + style + '>' + (inner || '<br>') + '</div>');
      text.push(fill(raw, vars, false));
    });
    closeTo(0);
    var t = text.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      subject: fill(tab.subject, vars, false).replace(/\s+/g, ' ').trim(),
      html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1d1d1b">' + html.join('') + '</div>',
      text: t,
      errors: errors
    };
  }

  /** Plain lines (seed text) -> paragraphs; "- " lines become bullets. For creating the Doc and for tests. */
  function linesToParas(lines) {
    return lines.map(function (l) {
      var m = /^(\s*)- (.*)$/.exec(l);
      if (m) return { runs: [{ text: m[2] }], list: { ordered: false, level: Math.floor(m[1].length / 2), id: 'seed' } };
      return { runs: [{ text: l }], list: null };
    });
  }

  return { parseTab: parseTab, render: render, unknownNames: unknownNames, paraText: paraText, linesToParas: linesToParas };
})();

if (typeof module !== 'undefined') module.exports = Templates;
