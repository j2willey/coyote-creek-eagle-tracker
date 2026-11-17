/**
 * Perf (2026-11-17): request timings, to decide on any backend move with numbers (backend decision note: "measure
 * first"). Every request adds a server sample (handler ms); pages report the round trip of their previous request
 * (fetch to answer), so round trip − server ms ≈ Apps Script start-up + network. Samples sit in the script cache per
 * hour and the hourly trigger writes one summary row per action to the "Timings" tab. Concurrent requests can drop a
 * sample (cache read-modify-write): fine for medians. Pure.
 */
var Perf = (function () {
  var HEADERS = ['Hour', 'Action', 'Calls', 'Server p50 ms', 'Server p90 ms', 'Server max ms', 'Round trips', 'Round trip p50 ms',
    'Round trip p90 ms', 'Start-up + network p50 ms'];
  var MAX_CHARS = 90000;                         // script cache values hold 100 KB

  function str(v) { return v == null ? '' : String(v).trim(); }
  function clean(a) { return str(a).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); }
  function num(v) { var n = Math.round(Number(v)); return isFinite(n) && n >= 0 && n < 600000 ? n : null; }

  /** Cache key for an hour: 'perf:2026111709' (the script's time zone, formatted by the caller). */
  function key(hourStamp) { return 'perf:' + hourStamp; }

  /** One sample as text: "S|action|serverMs" or "R|action|roundTripMs|serverMs". '' when unusable. */
  function encodeServer(action, ms) { var a = clean(action), m = num(ms); return a && m !== null ? 'S|' + a + '|' + m : ''; }
  function encodeReport(p) {
    if (!p || typeof p !== 'object') return '';
    var a = clean(p.a), r = num(p.r), s = num(p.s);
    return a && r !== null ? 'R|' + a + '|' + r + '|' + (s === null ? '' : s) : '';
  }
  /** Append samples to the cached text, dropping the oldest when it grows too long. */
  function append(text, samples) {
    var add = (samples || []).filter(Boolean).join(';');
    if (!add) return str(text);
    var all = (str(text) ? str(text) + ';' : '') + add;
    while (all.length > MAX_CHARS) all = all.slice(all.indexOf(';') + 1);
    return all;
  }

  function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : ''; }
  function asc(list) { return list.slice().sort(function (a, b) { return a - b; }); }

  /** Cached text -> one row per action (HEADERS keys), busiest first. */
  function summarize(text, hourLabel) {
    var by = {};
    str(text).split(';').forEach(function (t) {
      var p = t.split('|');
      if (p.length < 3) return;
      var x = by[p[1]] = by[p[1]] || { s: [], r: [], o: [] };
      if (p[0] === 'S' && num(p[2]) !== null) x.s.push(num(p[2]));
      if (p[0] === 'R' && num(p[2]) !== null) { x.r.push(num(p[2])); if (num(p[3]) !== null && p[3] !== '') x.o.push(Math.max(0, num(p[2]) - num(p[3]))); }
    });
    return Object.keys(by).map(function (a) {
      var x = by[a], s = asc(x.s), r = asc(x.r), o = asc(x.o);
      return { 'Hour': hourLabel, 'Action': a, 'Calls': s.length, 'Server p50 ms': pct(s, 0.5), 'Server p90 ms': pct(s, 0.9),
        'Server max ms': s.length ? s[s.length - 1] : '', 'Round trips': r.length, 'Round trip p50 ms': pct(r, 0.5),
        'Round trip p90 ms': pct(r, 0.9), 'Start-up + network p50 ms': pct(o, 0.5) };
    }).filter(function (row) { return row['Calls'] || row['Round trips']; })
      .sort(function (a, b) { return b['Calls'] - a['Calls'] || (a['Action'] < b['Action'] ? -1 : 1); });
  }

  return { HEADERS: HEADERS, key: key, encodeServer: encodeServer, encodeReport: encodeReport, append: append, summarize: summarize };
})();

if (typeof module !== 'undefined') module.exports = Perf;
