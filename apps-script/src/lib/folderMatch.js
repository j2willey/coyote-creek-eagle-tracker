/**
 * FolderMatch (cutover): pair the existing per-Scout folders in 202x with
 * Candidate Records, so the tools use the real folders instead of making
 * new ones. Convention: "<Name> - <Unit>" (e.g. "Scout Nine - T109").
 *
 * Folder names drift (typos, middle names, "T-2163", missing unit), so
 * matching is scored and only a UNIQUE best match is accepted. Anything
 * else is reported for a person; nothing is guessed.
 */
var FolderMatch = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }

  function normName(s) {
    return str(s).normalize ? str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim() : str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normUnit(u) {
    var m = /^([a-z]*?)0*(\d{1,5})$/.exec(str(u).toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (!m) return '';
    var w = m[1];
    var t = !w ? '' : (w === 'c' || w === 'crew' || w === 'venturingcrew') ? 'c'
      : (w === 's' || /ship$/.test(w)) ? 's' : (w === 't' || w === 'troop') ? 't' : w;
    return t + m[2];
  }

  /** "Scout Nine - T109", "Scout Nine-T-2163", "Scout Nine T109", "Scout Nine" -> {name, unit}. */
  function parseFolderName(folder) {
    var f = str(folder).replace(/^_+/, '');
    var m = /^(.*?)\s*[-–—]\s*((?:troop|crew|ship|[tcs])?\s*[-#]?\s*\d{1,5})\s*$/i.exec(f) ||
            /^(.*?)[\s,]+((?:troop|crew|ship|[tcs])\s*[-#]?\s*\d{1,5})\s*$/i.exec(f);
    if (m && str(m[1])) return { name: str(m[1]), unit: str(m[2]) };
    return { name: f, unit: '' };
  }

  function lev(a, b) {
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }

  /**
   * Name similarity: 3 = same, 2 = one name's words all inside the other's
   * (middle names, hyphenated parts), 1 = small typo, 0 = different.
   */
  function nameScore(a, b) {
    var x = normName(a), y = normName(b);
    if (!x || !y) return 0;
    if (x === y) return 3;
    var tx = x.split(' '), ty = y.split(' ');
    var small = tx.length <= ty.length ? tx : ty, big = tx.length <= ty.length ? ty : tx;
    if (small.length >= 2 && small.every(function (t) { return big.indexOf(t) >= 0; })) return 2;
    if (x.replace(/ /g, '') === y.replace(/ /g, '')) return 2;
    if (Math.min(x.length, y.length) >= 6 && lev(x, y) <= 2) return 1;
    return 0;
  }

  var KIND = { 3: 'exact name', 2: 'name words', 1: 'name typo' };

  /**
   * folders: [{id, name}]; records: [{recordId, scout_name, unit}].
   * -> { folders: [{id, name, parsed, recordId, kind, note, candidates}], recordsWithoutFolder: [recordId] }
   * kind: 'exact name' | 'name words' | 'name typo' | 'ambiguous' | 'none'.
   */
  function match(folders, records) {
    var out = (folders || []).map(function (f) {
      var p = parseFolderName(f.name);
      var scored = (records || []).map(function (r) {
        var ns = nameScore(p.name, r.scout_name);
        if (!ns) return null;
        var fu = normUnit(p.unit), ru = normUnit(String(r.unit || '').split(/\s*[\/,;&+\n]+\s*|\s+(?=[A-Za-z]+\s*-?\s*\d)/)[0]);   // primary unit
        var unitEq = fu && ru && fu === ru;
        var unitConflict = fu && ru && fu !== ru;
        return { recordId: r.recordId, ns: ns, score: ns * 2 + (unitEq ? 1 : 0) - (unitConflict ? 1 : 0), unitConflict: unitConflict };
      }).filter(function (x) { return x && x.score >= 2; })
        .sort(function (a, b) { return b.score - a.score; });
      var res = { id: f.id, name: f.name, parsed: p, recordId: null, kind: 'none', note: '',
        candidates: scored.map(function (x) { return x.recordId; }) };
      if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) {
        res.recordId = scored[0].recordId;
        res.kind = KIND[scored[0].ns];
        if (scored[0].unitConflict) res.note = 'unit differs from the sheet';
      } else if (scored.length) {
        res.kind = 'ambiguous';
        res.note = 'several Scouts match equally';
      }
      return res;
    });
    // One folder per record: if two folders claim the same record, a person decides.
    var claims = {};
    out.forEach(function (r) { if (r.recordId) (claims[r.recordId] = claims[r.recordId] || []).push(r); });
    Object.keys(claims).forEach(function (id) {
      if (claims[id].length < 2) return;
      claims[id].forEach(function (r) {
        r.candidates = [id]; r.recordId = null; r.kind = 'ambiguous';
        r.note = 'more than one folder matches this Scout';
      });
    });
    var linked = {};
    out.forEach(function (r) { if (r.recordId) linked[r.recordId] = true; });
    var without = (records || []).map(function (r) { return r.recordId; }).filter(function (id) { return !linked[id]; });
    return { folders: out, recordsWithoutFolder: without };
  }

  return { parseFolderName: parseFolderName, normName: normName, normUnit: normUnit, nameScore: nameScore, match: match };
})();

if (typeof module !== 'undefined') module.exports = FolderMatch;
