// Dashboard sorting (browser only; the sheet never changes). Rows keep their stage; sorting happens inside each stage.
// Default = sheet order, which is the order of arrival in the stage (rows land at the TOP of a section, so the
// sheet shows the newest arrival first). Ties keep sheet order; empty values always go last.

/** Sort keys offered on the column headers. */
export const SORTS = {
  arrival: 'Candidate',      // sheet order (newest arrival first) / reversed (oldest arrival first)
  unit: 'Unit',
  age: 'Age',
  approved: 'Approved',
  ebor: 'EBoR',
  session: 'Session'
};

// Booked stages list the soonest session first by default (Jim W., 2026-11-04); every other stage keeps sheet order
// (newest arrival on top). A click on a column heading overrides both.
export const BY_SESSION = ['intake_booked', 'review_booked'];

/** Rows of one stage in the order the dashboard shows them. */
export function stageRows(rows, groupKey, key = 'arrival', dir = 1) {
  if (key === 'arrival' && dir === 1 && BY_SESSION.includes(groupKey)) return sortRows(rows, 'session', 1);
  return sortRows(rows, key, dir);
}

/** "T251" -> ['T', 251]; "C 917" -> ['C', 917]; anything else -> [text, NaN]. */
export function unitKey(u) {
  const m = /^([A-Za-z]*)\s*0*(\d+)/.exec(String(u || '').trim());
  return m ? [m[1].toUpperCase(), Number(m[2])] : [String(u || '').trim().toUpperCase(), NaN];
}

function cmpUnit(a, b) {
  const x = unitKey(a), y = unitKey(b);
  if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
  if (isNaN(x[1]) || isNaN(y[1])) return isNaN(x[1]) - isNaN(y[1]);
  return x[1] - y[1];
}

const empty = (v) => v === null || v === undefined || v === '';

/**
 * rows: one stage's rows in sheet order. key: a SORTS key; dir: 1 = ascending, -1 = descending.
 * arrival ascending = sheet order (newest first); descending = oldest arrival first.
 */
export function sortRows(rows, key = 'arrival', dir = 1) {
  const list = rows.map((r, i) => ({ r, i }));
  if (key === 'arrival') return (dir === 1 ? list : list.reverse()).map(x => x.r);
  const val = (r) => key === 'unit' ? r.unit : key === 'age' ? r.age : key === 'approved' ? r.approved : key === 'ebor' ? r.ebor : key === 'session' ? (r.session ? r.session.start : null) : null;
  list.sort((a, b) => {
    const va = val(a.r), vb = val(b.r);
    if (empty(va) || empty(vb)) return (empty(va) - empty(vb)) || a.i - b.i;   // empties last, whatever the direction
    const c = key === 'unit' ? cmpUnit(va, vb) : (key === 'age' || key === 'session') ? va - vb : (va < vb ? -1 : va > vb ? 1 : 0);
    return c * dir || a.i - b.i;
  });
  return list.map(x => x.r);
}
