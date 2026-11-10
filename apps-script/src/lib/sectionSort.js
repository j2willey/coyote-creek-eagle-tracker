/**
 * SectionSort (Jim W., 2026-10-24): EBoR Booked is kept in EBoR Date order on the tracking tab, the latest board at
 * the top and the next one at the bottom (right above EBoR Paused). Rows with no date yet go to the top. Pure.
 */
var SectionSort = (function () {
  function ms(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    var s = v == null ? '' : String(v).trim();
    if (!s) return null;
    var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (m) return Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  /**
   * rows [{key, date, blank}] in sheet order -> keys in the wanted order: no date first, then latest -> earliest;
   * empty rows (blank: true) last; otherwise stable.
   */
  function latestFirst(rows) {
    return (rows || []).map(function (r, i) { return { key: r.key, t: ms(r.date), i: i, blank: !!r.blank }; })
      .sort(function (a, b) {
        if (a.blank || b.blank) return (a.blank ? 1 : 0) - (b.blank ? 1 : 0) || a.i - b.i;
        if (a.t === null || b.t === null) return (a.t === null ? 0 : 1) - (b.t === null ? 0 : 1) || a.i - b.i;
        return b.t - a.t || a.i - b.i;
      }).map(function (x) { return x.key; });
  }

  /**
   * Row moves that turn `current` (keys in sheet order) into `wanted`: [{key, from, to}] 0-based offsets within the
   * section, applied one after another (each move like Sheet.moveRows: take the row out, insert it before `to`).
   */
  function moves(current, wanted) {
    var cur = current.slice(), out = [];
    for (var i = 0; i < wanted.length; i++) {
      var j = cur.indexOf(wanted[i]);
      if (j === i || j < 0) continue;
      out.push({ key: wanted[i], from: j, to: i });
      cur.splice(j, 1); cur.splice(i, 0, wanted[i]);
    }
    return out;
  }

  return { ms: ms, latestFirst: latestFirst, moves: moves };
})();

if (typeof module !== 'undefined') module.exports = SectionSort;
