/**
 * Outbox (email-review-design.md, step 2): emails a committee member caused, from a template set to
 * "Mode: Review", wait here until a member sends, sends from their own email, or discards them.
 * Pure helpers; the adapter is outboxActions.js.
 */
var Outbox = (function () {
  var STATUS = { PENDING: 'Pending', SCHEDULED: 'Scheduled', SENT: 'Sent', SENT_BY_MEMBER: 'Sent by member', DISCARDED: 'Discarded' };
  var HEADERS = ['Id', 'Created', 'Created by', 'Record ID', 'Scout', 'Template', 'Status', 'To', 'Cc', 'Subject', 'Html', 'Text',
    'Done', 'Done by', 'Note', 'Attachments', 'On sent', 'Event at', 'Send at', 'Scheduled by'];

  function str(v) { return v == null ? '' : String(v); }

  function makeId(nowMs, randomFn) {
    var r = (randomFn || Math.random)().toString(36).slice(2, 6).toUpperCase();
    return 'OB-' + nowMs.toString(36).toUpperCase() + '-' + r;
  }

  /** "a@x.org, b@y.org; c@z.org" or an array -> { list, bad } */
  function addresses(v) {
    var parts = Array.isArray(v) ? v : str(v).split(/[,;\s]+/);
    var list = [], bad = [];
    parts.map(function (p) { return str(p).trim(); }).filter(Boolean).forEach(function (a) {
      if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(a)) { if (list.indexOf(a.toLowerCase()) < 0) list.push(a.toLowerCase()); }
      else bad.push(a);
    });
    return { list: list, bad: bad };
  }

  function decode(s) {
    return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  /** Email HTML -> readable plain text (paragraphs, line breaks, list bullets, links as "text (url)"). */
  function htmlToText(html) {
    var t = str(html);
    t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, href, inner) {
      var label = inner.replace(/<[^>]+>/g, '');
      return decode(label).trim() === decode(href).trim() ? label : label + ' (' + href + ')';
    });
    t = t.replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '').replace(/<\/(div|p|ul|ol|h[1-6])>/gi, '\n').replace(/<(div|p|ul|ol|h[1-6])[^>]*>/gi, '\n');
    t = decode(t.replace(/<[^>]+>/g, ''));
    return t.split('\n').map(function (l) { return l.replace(/[ \t]+$/g, ''); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Remove anything active from member-edited HTML (scripts, event handlers, javascript: links). */
  function clean(html) {
    return str(html)
      .replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(script|iframe|object|embed|form|input|button)[^>]*\/?>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  }

  /** A log line for the Scout's Life to Eagle Log. */
  function logLine(dateText, who, template, outcome) {
    return dateText + ' [' + (who || 'committee') + '] "' + template + '" email ' + outcome;
  }

  function esc(t) { return str(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** Plain text (built-in wording) -> simple HTML: escaped, links clickable, line breaks kept. */
  function textToHtml(text) {
    return esc(text).replace(/https?:\/\/[^\s<]+/g, function (u) { return '<a href="' + u + '">' + u + '</a>'; })
      .split('\n').join('<br>');
  }

  /** Attachments cell (JSON [{id, name}]) -> list; anything unreadable -> []. */
  function parseAttachments(cell) {
    try {
      var a = JSON.parse(str(cell) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return x && x.id; }).map(function (x) { return { id: str(x.id), name: str(x.name) }; }) : [];
    } catch (e) { return []; }
  }

  /**
   * A member attaches a file to a waiting email on the Outbox (the committee chair, 2026-11-02: e.g. a denial letter from the
   * Council Advancement Chair). list: parseAttachments(). -> new list; the same Drive file is listed once.
   */
  function withAttachment(list, a) {
    var out = (list || []).slice();
    if (a && str(a.id) && !out.some(function (x) { return x.id === str(a.id); })) out.push({ id: str(a.id), name: str(a.name) });
    return out;
  }
  /** Take one file off a waiting email (the Drive file itself stays: it may be the Scout's signed Proposal). */
  function withoutAttachment(list, index) {
    var i = Number(index);
    return (list || []).filter(function (x, k) { return k !== i; });
  }
  // All attachments of one email, as files on disk. Gmail's 25 MB counts the ENCODED message (base64: +33%), so
  // about 18 MB of files is the real limit (2026-11-02; it was 24 MB, which would fail at Send).
  var MAX_ATTACH_BYTES = 18 * 1024 * 1024;

  /**
   * Google Groups reject a message over 8 MB (Jim W., 2026-11-04: an EBoR email's copy to the committee group
   * bounced; everyone else got it). Like Gmail's 25 MB, it counts the encoded message: attachments grow by about a
   * third (base64). fileBytes: total attachment bytes; to, cc: address lists (text or arrays); groups: extra group
   * addresses (the committee group). -> {level: 'over' | 'near' | '', mb (estimated message size), groups: [in To/Cc]}
   */
  var GROUP_LIMIT = 8 * 1000 * 1000;
  function groupSize(fileBytes, to, cc, groups) {
    var list = [].concat(addresses(to).list, addresses(cc).list).map(function (e) { return e.toLowerCase(); });
    var known = (groups || []).map(function (g) { return str(g).toLowerCase(); }).filter(Boolean);
    var hit = list.filter(function (e, i) { return list.indexOf(e) === i && (known.indexOf(e) >= 0 || /@googlegroups\.com$/.test(e)); });
    var est = Math.round((Number(fileBytes) || 0) * 4 / 3 + 60 * 1000);          // base64 + body and headers
    var level = !hit.length || !(Number(fileBytes) > 0) ? '' : est > GROUP_LIMIT ? 'over' : est > GROUP_LIMIT * 0.8 ? 'near' : '';
    return { level: level, mb: Math.round(est / 100000) / 10, groups: hit };
  }

  var HOUR = 3600 * 1000, DAY = 24 * HOUR;

  /**
   * "Send later" choices for an email about a session at eventMs (e.g. an EBoR reminder): 2 days / 1 day before,
   * at the session's time of day, only those still at least 10 minutes away. -> [{label, at}]
   */
  function scheduleChoices(eventMs, nowMs) {
    if (!(eventMs > 0)) return [];
    return [{ label: '2 days before', at: eventMs - 2 * DAY }, { label: '1 day before', at: eventMs - DAY }]
      .filter(function (c) { return c.at >= nowMs + 10 * 60 * 1000; });
  }

  /** A requested send time: refuse the past and anything after the session. -> '' or the problem. */
  function scheduleProblem(atMs, nowMs, eventMs) {
    if (!(atMs > 0)) return 'Pick a date and time.';
    if (atMs < nowMs + 5 * 60 * 1000) return 'Pick a time at least 5 minutes from now.';
    if (eventMs > 0 && atMs > eventMs) return 'That is after the session itself.';
    return '';
  }

  /** rows: Outbox tab rows. -> rows whose scheduled time has come. */
  function due(rows, nowMs) {
    return (rows || []).filter(function (r) {
      if (str(r['Status']) !== STATUS.SCHEDULED) return false;
      var t = r['Send at'] instanceof Date ? r['Send at'].getTime() : Date.parse(str(r['Send at']));
      return t > 0 && t <= nowMs;
    });
  }

  /**
   * Reply-To for an Outbox email (Jim W., 2026-10-25; a toggle, KISS): 'group' (the committee group) or 'me' (the member
   * who sends or schedules it). The group is on Cc anyway, so Reply all keeps everyone in the loop (two-deep).
   * Blank mode: 'me' when files are attached (Council's "please rescan" reaches the sender), else 'group'.
   */
  function replyMode(mode, hasAttachments) {
    var m = String(mode || '').trim().toLowerCase();
    return ['group', 'me'].indexOf(m) >= 0 ? m : (hasAttachments ? 'me' : 'group');
  }
  function replyTo(mode, member, group) {
    var e = String(mode === 'me' ? member : group || '').trim();
    return /@/.test(e) ? e : '';
  }

  return { replyMode: replyMode, replyTo: replyTo, scheduleChoices: scheduleChoices, scheduleProblem: scheduleProblem, due: due, textToHtml: textToHtml, parseAttachments: parseAttachments, withAttachment: withAttachment, withoutAttachment: withoutAttachment, groupSize: groupSize, GROUP_LIMIT: GROUP_LIMIT, MAX_ATTACH_BYTES: MAX_ATTACH_BYTES, STATUS: STATUS, HEADERS: HEADERS, makeId: makeId, addresses: addresses, htmlToText: htmlToText, clean: clean, logLine: logLine };
})();

if (typeof module !== 'undefined') module.exports = Outbox;
