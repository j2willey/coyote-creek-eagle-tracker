/**
 * Digest: the committee's activity email (instead of a cc on every change).
 *
 * Pure. The adapter (digest.js) reads the Activity tab, asks dueSlot() whether
 * a scheduled slot has come up, builds the email with build(), and writes one
 * Digest Log row per slot, also when nothing changed, so a quiet week can be
 * told apart from a broken trigger.
 *
 * Schedule (Settings → digestHours), Pacific time:
 *   "6 PM"          daily at 6 PM
 *   "6 AM, 6 PM"    twice a day
 *   "18" / "6, 18"  24-hour numbers work too
 *   blank / "off"   no digest
 * An hourly trigger checks; a slot missed (script down, quota) is caught up on
 * the next run, and the email still covers everything since the last digest.
 */
var Digest = (function () {
  function str(v) { return String(v == null ? '' : v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** "6 AM, 6 PM" → { hours: [6, 18] } | { hours: [] } (off) | { error } */
  function parseHours(raw) {
    if (typeof raw === 'number') raw = String(raw);
    var s = str(raw).toLowerCase();
    if (!s || s === 'off' || s === 'none' || s === 'no') return { hours: [] };
    var parts = s.replace(/\s+(am|pm)\b/g, '$1').split(/[\s,;]+/).filter(Boolean);
    var hours = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d{1,2})(?::00)?(am|pm)?$/.exec(parts[i]);
      if (!m) return { error: 'digestHours: cannot read "' + parts[i] + '" (use e.g. "6 PM" or "6 AM, 6 PM")' };
      var h = Number(m[1]);
      if (m[2]) {
        if (h < 1 || h > 12) return { error: 'digestHours: "' + parts[i] + '" is not a time' };
        h = (h % 12) + (m[2] === 'pm' ? 12 : 0);
      }
      if (h > 23) return { error: 'digestHours: ' + h + ' is not an hour (0-23). If you typed "6,18", the sheet may have read it as 618: write "6 AM, 6 PM".' };
      if (hours.indexOf(h) < 0) hours.push(h);
    }
    return { hours: hours.sort(function (a, b) { return a - b; }) };
  }

  function hourLabel(h) {
    var ap = h < 12 ? 'AM' : 'PM';
    var x = h % 12 === 0 ? 12 : h % 12;
    return x + ' ' + ap;
  }

  function scheduleLabel(hours) {
    if (!hours || !hours.length) return 'off';
    return 'daily at ' + hours.map(hourLabel).join(' and ');
  }

  /** "2026-10-18" → "2026-10-17" */
  function prevDate(ymd) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) - 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /**
   * Latest scheduled slot at or before now, if it hasn't been done yet.
   * now: { date: 'yyyy-MM-dd', hour: 0-23 } in the script's time zone.
   * lastSlot: 'yyyy-MM-dd HH' of the last slot handled ('' = never).
   * Returns the slot key or null.
   */
  function dueSlot(now, hours, lastSlot) {
    if (!hours || !hours.length) return null;
    var latest = null;
    var today = hours.filter(function (h) { return h <= now.hour; });
    if (today.length) latest = now.date + ' ' + pad(today[today.length - 1]);
    else latest = prevDate(now.date) + ' ' + pad(hours[hours.length - 1]);
    if (!lastSlot || latest > str(lastSlot)) return latest;
    return null;
  }

  /** Lines not worth a digest entry (bulk bookkeeping). */
  function isNoise(line) {
    return /\[Log started\]/.test(str(line));
  }

  /** Activity rows ({ When: Date, ... }) with sinceMs < When <= untilMs, oldest first. */
  function select(rows, sinceMs, untilMs) {
    return (rows || []).filter(function (r) {
      var t = r.When instanceof Date ? r.When.getTime() : new Date(r.When).getTime();
      // EBoR paperwork demo runs (Record ID "DEMO") stay on the Activity tab but never reach the digest.
      return !isNaN(t) && t > sinceMs && t <= untilMs && str(r.Entry) && !isNoise(r.Entry) && str(r['Record ID']) !== 'DEMO';
    }).sort(function (a, b) { return new Date(a.When) - new Date(b.When); });
  }

  /** Drop the leading "10/18 " the log lines carry (the digest shows the time instead). */
  function stripDate(line) {
    return str(line).replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+/, '');
  }

  /**
   * events: selected Activity rows. fmt(date) → display time (adapter supplies, script time zone).
   * opts: { sinceLabel, sheetUrl, scheduleLabel }
   * Returns { subject, body, count, scouts }.
   */
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function build(events, fmt, opts) {
    opts = opts || {};
    var groups = [], byKey = {};
    events.forEach(function (e) {
      var key = str(e['Record ID']) || str(e.Scout) || '(no Scout)';
      if (!byKey[key]) {
        // opts.nameFor(recordId, name): the name as the committee knows it now (Preferred Name, 2026-11-04)
        var nm = opts.nameFor ? str(opts.nameFor(str(e['Record ID']), str(e.Scout))) || str(e.Scout) : str(e.Scout);
        byKey[key] = { title: nm + (str(e.Unit) ? ' (' + str(e.Unit) + ')' : ''), lines: [], items: [] };
        groups.push(byKey[key]);
      }
      var when = fmt(new Date(e.When));
      var what = stripDate(e.Entry) + (str(e.By) && str(e.Entry).indexOf(str(e.By)) < 0 ? ' (by ' + str(e.By) + ')' : '');
      byKey[key].lines.push('  ' + when + '  ' + what);
      byKey[key].items.push({ when: when, what: what });
    });
    var n = events.length;
    var age = function (d) { return d === 0 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
    // "Awaiting action" (Jim W., 2026-10-24): repeated in every digest until done, most urgent first.
    var groupsA = opts.awaiting || [];
    if (!opts.awaiting) {     // older callers: files waiting + Council overdue only
      if ((opts.waiting || []).length) groupsA.push({ title: 'New files to check', items: opts.waiting.map(function (w) { return w.title + ', waiting ' + age(w.days); }) });
      if ((opts.council || []).length) groupsA.push({ title: 'EBoR paperwork not yet acknowledged by Council', items: opts.council.map(function (w) { return w.title + ', sent ' + (w.days ? age(w.days) + ' ago' : 'today'); }) });
    }
    var upcoming = opts.upcoming || [];     // [{when, what}] sessions in the next 7 days
    var waitingN = groupsA.reduce(function (t, g) { return t + g.items.length; }, 0);
    var subject = 'Eagle Tracker digest: ' + (n ? n + ' change' + (n === 1 ? '' : 's') +
      ' (' + groups.length + ' Scout' + (groups.length === 1 ? '' : 's') + ')' : 'no changes') +
      (opts.awaiting && waitingN ? ', ' + waitingN + ' awaiting action' : '');
    var body = [];
    if (groupsA.length) {
      if (opts.awaiting) body.push('AWAITING ACTION', '');
      groupsA.forEach(function (g) {
        body.push(g.title + ' (' + g.items.length + '):');
        g.items.forEach(function (it) { body.push('  - ' + it); });
        body.push('');
      });
    }
    if (upcoming.length) {
      body.push('Next 7 days (' + upcoming.length + '):');
      upcoming.forEach(function (u) { body.push('  ' + u.when + '  ' + u.what); });
      body.push('');
    }
    if (n) {
      body.push('Here is everything that has happened since the last digest' +
        (opts.sinceLabel ? ' (' + opts.sinceLabel + ')' : '') + ':', '');
      groups.forEach(function (g) { body.push(g.title || '(no Scout)'); body = body.concat(g.lines); body.push(''); });
    } else body.push('Nothing changed since the last digest' + (opts.sinceLabel ? ' (' + opts.sinceLabel + ')' : '') + '.', '');
    var quiet = opts.awaiting ? 'No email when nothing changed and nothing is waiting.' : 'No email when nothing changed.';
    body.push('---');
    if (opts.sheetUrl) body.push('Tracking sheet (Activity tab has the full list): ' + opts.sheetUrl);
    if (opts.pageUrl) body.push('Committee page: ' + opts.pageUrl);
    if (opts.scheduleLabel) body.push('Digest schedule: ' + opts.scheduleLabel + ' (Settings → digestHours). ' + quiet);
    // HTML version: the reader's mail app wraps lines to the screen; line breaks only where they mean something.
    var html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1d1d1b">'];
    if (groupsA.length) {
      if (opts.awaiting) html.push('<p style="margin:0 0 8px;font-size:12px;letter-spacing:.06em;color:#a86a00"><b>AWAITING ACTION</b></p>');
      groupsA.forEach(function (g) {
        html.push('<p style="margin:0 0 4px"><b style="color:#a86a00">' + esc(g.title) + ' (' + g.items.length + ')</b></p>' +
          '<ul style="margin:0 0 14px;padding-left:20px">' + g.items.map(function (it) { return '<li style="margin:0 0 3px">' + esc(it) + '</li>'; }).join('') + '</ul>');
      });
    }
    if (upcoming.length) {
      html.push('<p style="margin:0 0 4px"><b>Next 7 days (' + upcoming.length + ')</b></p><ul style="margin:0 0 14px;padding-left:20px">' +
        upcoming.map(function (u) { return '<li style="margin:0 0 3px"><span style="color:#6b6b66;white-space:nowrap">' + esc(u.when) + '</span>&nbsp; ' + esc(u.what) + '</li>'; }).join('') + '</ul>');
    }
    if (!n) html.push('<p style="margin:0 0 14px">Nothing changed since the last digest' + (opts.sinceLabel ? ' (' + esc(opts.sinceLabel) + ')' : '') + '.</p>');
    else
    html.push(
      '<p style="margin:0 0 14px">Here is everything that has happened since the last digest' +
        (opts.sinceLabel ? ' (' + esc(opts.sinceLabel) + ')' : '') + ':</p>');
    groups.forEach(function (g) {
      html.push('<p style="margin:0 0 4px"><b>' + esc(g.title || '(no Scout)') + '</b></p>' +
        '<ul style="margin:0 0 14px;padding-left:20px">' + g.items.map(function (it) {
          return '<li style="margin:0 0 3px"><span style="color:#6b6b66;white-space:nowrap">' + esc(it.when) + '</span>&nbsp; ' + esc(it.what) + '</li>';
        }).join('') + '</ul>');
    });
    var foot = [];
    if (opts.sheetUrl) foot.push('<a href="' + esc(opts.sheetUrl) + '">Tracking sheet</a> (the Activity tab has the full list)');
    if (opts.pageUrl) foot.push('<a href="' + esc(opts.pageUrl) + '">Committee page</a>');
    if (opts.scheduleLabel) foot.push('Digest schedule: ' + esc(opts.scheduleLabel) + ' (Settings → digestHours). ' + esc(quiet));
    if (foot.length) html.push('<p style="margin:16px 0 0;font-size:12px;color:#6b6b66">' + foot.join('<br>') + '</p>');
    html.push('</div>');
    return { subject: subject, body: body.join('\n'), html: html.join(''), count: n, scouts: groups.length };
  }

  /**
   * Who gets the digest: digestTo, else the Committee Group. In test mode mail
   * goes to testRecipient anyway, so fall back to it rather than fail.
   */
  function recipients(settings) {
    var s = settings || {};
    var to = str(s.digestTo) || str(s.committeeGroupEmail);
    if (!to && s.testMode !== false) to = str(s.testRecipient);
    return to;
  }

  return {
    recipients: recipients,
    parseHours: parseHours, scheduleLabel: scheduleLabel, hourLabel: hourLabel, dueSlot: dueSlot,
    isNoise: isNoise, select: select, stripDate: stripDate, build: build, prevDate: prevDate
  };
})();

if (typeof module !== 'undefined') module.exports = Digest;
