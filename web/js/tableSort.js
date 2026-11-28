// Sorting for the Units page's sheet tables (Jim W., 2026-11-28; rows from lib/unitTables.js). Browser only: the sheet
// never changes. Each cell is read as a date (+ time), a time of day ("7:00 PM"), a weekday, a number, a unit (Unit
// column: T41 before T964) or text. Empty cells always go last; ties keep sheet order.
import { unitKey } from './boardSort.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const KIND = { date: 0, time: 1, day: 2, num: 3, unit: 4, text: 5 };

function clock(h, m, s, ap) {
  let hh = Number(h) % (ap ? 12 : 24);
  if (ap && /p/i.test(ap)) hh += 12;
  return hh * 3600 + Number(m) * 60 + Number(s || 0);
}

/** A cell -> [kind rank, value] for comparing; null when empty. */
export function cellKey(v, isUnit) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return null;
  if (isUnit) { const u = unitKey(t); return [KIND.unit, u[0], isNaN(u[1]) ? Infinity : u[1]]; }
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return [KIND.date, Date.UTC(y, m[1] - 1, m[2]) / 1000 + (m[4] ? clock(m[4], m[5], m[6], m[7]) : 0)];
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return [KIND.date, Date.UTC(m[1], m[2] - 1, m[3]) / 1000 + (m[4] ? clock(m[4], m[5], m[6]) : 0)];
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(t);
  if (m) return [KIND.time, clock(m[1], m[2], m[3], m[4])];
  const d = DAYS.findIndex(x => x.startsWith(t.toLowerCase().replace(/s$/, '')) && t.length >= 3);
  if (d >= 0) return [KIND.day, d];
  if (/^-?[\d,]*\.?\d+$/.test(t)) return [KIND.num, Number(t.replace(/,/g, ''))];
  return [KIND.text, t.toLowerCase()];
}

function cmpKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'string' && typeof b[i] === 'string') return a[i].localeCompare(b[i]);
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** "Troop 0999" / "T999" / "c 917" -> "t999" / "c917" (the server's Units.code, for finding the unit). */
export function unitCode(v) {
  const m = /^([a-z]*?)0*(\d{1,5})$/.exec(String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  if (!m) return '';
  const w = m[1];
  const t = !w ? '' : (w === 'c' || /crew$/.test(w)) ? 'c' : (w === 'p' || /pack$/.test(w)) ? 'p'
    : (w === 's' || /ship$/.test(w)) ? 's' : (w === 't' || w === 'troop') ? 't' : w;
  return t + m[2];
}

/** rows (arrays of cells) sorted by column col; dir 1 = ascending (earliest / A→Z / low first), -1 = descending. */
export function sortTable(rows, col, dir = 1, isUnit = false) {
  return rows.map((r, i) => ({ r, i, k: cellKey(r[col], isUnit) })).sort((a, b) => {
    if (!a.k || !b.k) return a.k === b.k ? a.i - b.i : a.k ? -1 : 1;     // empty last, both directions
    return dir * cmpKeys(a.k, b.k) || a.i - b.i;
  }).map(x => x.r);
}

/** Rows where any cell contains every word of the filter (case ignored). */
export function filterRows(rows, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter(r => { const s = r.join(' ').toLowerCase(); return words.every(w => s.includes(w)); });
}
