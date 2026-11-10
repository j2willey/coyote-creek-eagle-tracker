/**
 * ScoutLog: the Life to Eagle Log panel on the dashboard (click the Last note). Pure. Jim W., 2026-10-27.
 *
 * The log is a Google Doc per Scout, newest line at the top (notes.js). The panel adds one-line notes and, behind a
 * pencil, lets a member correct the whole text. Log lines look like "10/27 [JW] text": a new note gets the date and
 * the member's initials unless the member typed them.
 */
var ScoutLog = (function () {
  var NOTE_MAX = 1000;          // one line in the panel
  var TEXT_MAX = 200000;        // whole log (a Doc of a few hundred lines is ~50K)
  var DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?=\s|$)/;
  var TAG = /^\[[^\]\n]{1,20}\]/;

  function str(v) { return v == null ? '' : String(v); }

  /** One-line note -> log line, or '' if empty. "10/27 [JW] ..." added where missing; a typed date or [tag] is kept. */
  function noteLine(note, shortDate, initials) {
    var t = str(note).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    if (!t) return '';
    var tag = '[' + (str(initials).trim() || 'committee') + ']';
    var m = DATE.exec(t);
    var date = m ? m[0] : str(shortDate);
    var rest = (m ? t.slice(m[0].length) : t).trim();
    if (!TAG.test(rest)) rest = tag + (rest ? ' ' + rest : '');
    return date + ' ' + rest;
  }

  /** Edited history -> text to write: \n line ends, no trailing blanks or blank lines at the ends. */
  function cleanText(text) {
    return str(text).replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, ''); })
      .join('\n').replace(/^\n+|\n+$/g, '');
  }

  /** Two texts are the same log (ignoring line-end and trailing-space differences)? */
  function same(a, b) { return cleanText(a) === cleanText(b); }

  /** Newest note = first non-blank line (the Notes cell shows it). */
  function firstLine(text) {
    var ls = cleanText(text).split('\n');
    for (var i = 0; i < ls.length; i++) if (ls[i].trim()) return ls[i].trim();
    return '';
  }

  /** Problems with an edited history, [] when fine. */
  function editProblems(text) {
    var t = cleanText(text);
    if (!t) return ['The log can\'t be empty. To remove a line, delete only that line.'];
    if (t.length > TEXT_MAX) return ['The log is too long to save here (' + t.length + ' characters; the most is ' + TEXT_MAX + '). Edit it in the Google Doc.'];
    return [];
  }

  return { NOTE_MAX: NOTE_MAX, TEXT_MAX: TEXT_MAX, noteLine: noteLine, cleanText: cleanText, same: same, firstLine: firstLine, editProblems: editProblems };
})();

if (typeof module !== 'undefined') module.exports = ScoutLog;
