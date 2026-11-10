/**
 * EagleCount (Jim W., 2026-11-01): "You are the 110th Eagle Scout of Troop 910!"
 *  - Unit Info → Eagles to Date: the unit's count, editable (sheet; unit page). Blank = unknown (never guessed);
 *    0 is a real count. "Eagle earned" adds 1 for EVERY unit the Scout is listed in (Units.codes).
 *  - Before the board: the number to announce = count + 1, plus one for each earlier pending board of the same unit
 *    (boards held the same evening are a best guess; the member can correct the email in the Outbox).
 *  - This calendar year: counted from the tracking tab (Eagle Earned, EBoR date this year), never stored.
 * Pure.
 */
var EagleCount = (function () {
  function U() { return typeof Units !== 'undefined' ? Units : require('./units.js'); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  var TYPE = { t: 'Troop', c: 'Crew', s: 'Ship', p: 'Pack' };

  /** Cell -> count, or null when blank / not a whole number. */
  function parseCount(v) {
    if (typeof v === 'number') return v >= 0 && Math.floor(v) === v ? v : null;
    var s = str(v).replace(/,/g, '');
    return /^\d{1,6}$/.test(s) ? Number(s) : null;
  }

  /** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 112 -> "112th", 101 -> "101st". */
  function ordinal(n) {
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  /** "t910" -> "Troop 910". */
  function unitWords(code) {
    var m = /^([a-z]*)(\d+)$/.exec(str(code));
    if (!m) return str(code).toUpperCase();
    return (TYPE[m[1]] ? TYPE[m[1]] + ' ' : m[1].toUpperCase()) + m[2];
  }

  /**
   * Numbers to announce for the Scouts whose boards are coming (EBoR Booked).
   * pending: [{recordId, unit (cell), start (ms; Infinity/NaN = no date)}]. counts: {code: n | null}.
   * -> {recordId: [{code, n, guess}]} (units with no count left out). guess = another pending board of that unit exists.
   */
  function forecast(pending, counts) {
    var list = (pending || []).map(function (p) { return { id: str(p.recordId), codes: U().codes(p.unit), start: isFinite(p.start) ? p.start : Infinity }; })
      .sort(function (a, b) { return a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var seen = {}, total = {};
    list.forEach(function (p) { p.codes.forEach(function (c) { total[c] = (total[c] || 0) + 1; }); });
    var out = {};
    list.forEach(function (p) {
      out[p.id] = [];
      p.codes.forEach(function (c) {
        var base = counts ? counts[c] : null;
        var i = seen[c] || 0;
        seen[c] = i + 1;
        if (base === null || base === undefined) return;
        out[p.id].push({ code: c, n: base + 1 + i, guess: total[c] > 1 });
      });
    });
    return out;
  }

  /** "110th Eagle Scout of Troop 910" / "12th Eagle Scout of Crew 967 and the 41st of Troop 911"; '' when none. */
  function phrase(nums) {
    var x = (nums || []).filter(function (v) { return v && v.n > 0; });
    if (!x.length) return '';
    var parts = x.map(function (v, i) { return (i ? 'the ' : '') + ordinal(v.n) + (i ? ' of ' : ' Eagle Scout of ') + unitWords(v.code); });
    return parts.length < 3 ? parts.join(' and ') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];   // three or more units
  }

  /** Congratulations email line: "You are the 110th Eagle Scout of Troop 910!" ('' = no count: the line drops out). */
  function emailLine(nums) { var p = phrase(nums); return p ? 'You are the ' + p + '!' : ''; }

  /** For the board: "110th Eagle Scout of Troop 910 (best guess: 2 Troop 910 boards pending)". */
  function announce(nums) {
    var p = phrase(nums);
    if (!p) return '';
    var g = (nums || []).filter(function (v) { return v.guess; });
    return p + (g.length ? ' (best guess: another ' + g.map(function (v) { return unitWords(v.code); }).join(' / ') + ' board is pending; check before announcing)' : '');
  }

  /** records: [{section, unit, ebor: 'YYYY-MM-DD'}]. -> {code: Eagles this calendar year} (every listed unit). */
  function yearCounts(records, year) {
    var out = {};
    (records || []).forEach(function (r) {
      if (r.section !== 'eagle_earned' || str(r.ebor).slice(0, 4) !== String(year)) return;
      U().codes(r.unit).forEach(function (c) { out[c] = (out[c] || 0) + 1; });
    });
    return out;
  }

  return { parseCount: parseCount, ordinal: ordinal, unitWords: unitWords, forecast: forecast, phrase: phrase, emailLine: emailLine,
    announce: announce, yearCounts: yearCounts };
})();

if (typeof module !== 'undefined') module.exports = EagleCount;
