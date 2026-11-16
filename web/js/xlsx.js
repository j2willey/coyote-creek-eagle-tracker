// Read an .xlsx file in the browser: the first worksheet as a 2D array of strings (Key 3 import on the Units page,
// 2026-11-16). An .xlsx is a zip of XML parts; the browser unzips it (DecompressionStream) and only the rows go to the
// server. Why here and not in Apps Script: an export can mark a million blank rows as formatted (the District
// Executive's file: 145 rows, a 60 MB worksheet), and Apps Script blobs stop at 50 MB. No library: the npm build of
// SheetJS is old and has known issues. Values come back as stored (numbers as written, no date formatting).
function unescape(s) {
  return String(s).replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
    var l = e.toLowerCase();
    if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'"; if (l === 'amp') return '&';
    return String.fromCharCode(l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
  });
}
/** Every <t>…</t> inside a fragment, joined (rich-text runs; phonetic runs <rPh> left out). */
function text(frag) {
  var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g, m;
  frag = String(frag).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  while ((m = re.exec(frag))) out += m[1] ? unescape(m[1]) : '';
  return out;
}
export function sharedStrings(xml) {
  var out = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, m;
  while ((m = re.exec(String(xml || '')))) out.push(m[1] ? text(m[1]) : '');
  return out;
}
function attr(tag, name) {
  var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? unescape(m[1]) : '';
}
/** "AB12" -> 27 (0-based column); '' -> -1. */
export function colIndex(ref) {
  var m = /^([A-Z]+)/i.exec(String(ref || ''));
  if (!m) return -1;
  var n = 0;
  m[1].toUpperCase().split('').forEach(function (ch) { n = n * 26 + (ch.charCodeAt(0) - 64); });
  return n - 1;
}
/**
 * sheet XML + shared strings -> rows (2D array of strings, padded to the widest), EMPTY ROWS LEFT OUT. An export can
 * mark a million blank rows as formatted (the District Executive's file: 145 rows, a 60 MB sheet), so only rows
 * with a value are kept, in sheet order.
 */
export function sheetRows(xml, shared) {
  var rows = [], width = 0, rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, m;
  xml = String(xml || '');
  while ((m = rowRe.exec(xml))) {
    var body = m[1];
    if (!body || body.indexOf('<c') < 0) continue;     // <row …/> or a row with no cells
    var row = [], cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c, next = 0;
    while ((c = cRe.exec(body))) {
      var ca = c[1], inner = c[2] || '', t = attr(ca, 't'), at = colIndex(attr(ca, 'r'));
      if (at < 0) at = next;
      var v = /<v>([\s\S]*?)<\/v>/.exec(inner), val = '';
      if (t === 's') val = v ? (shared[parseInt(v[1], 10)] || '') : '';
      else if (t === 'inlineStr') val = text((/<is>([\s\S]*?)<\/is>/.exec(inner) || [])[1] || '');
      else if (t === 'b') val = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
      else val = v ? unescape(v[1]) : '';
      row[at] = val;
      next = at + 1;
    }
    var any = false;
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ''; else if (String(row[i]).trim()) any = true; }
    if (!any) continue;                                   // cells, but all blank (styled only)
    rows.push(row);
    width = Math.max(width, row.length);
  }
  for (var r = 0; r < rows.length; r++) while (rows[r].length < width) rows[r].push('');
  return rows;
}
/** Path of the workbook's first sheet ('xl/worksheets/sheet1.xml'), from workbook.xml + workbook.xml.rels. */
export function firstSheetPath(workbookXml, relsXml) {
  var s = /<sheet\b[^>]*>/.exec(String(workbookXml || ''));
  var rid = s ? (attr(s[0], 'r:id') || attr(s[0], 'id')) : '';
  var rel = rid ? new RegExp('<Relationship\\b[^>]*\\sId="' + rid + '"[^>]*>').exec(String(relsXml || '')) : null;
  var target = rel ? attr(rel[0], 'Target') : '';
  if (!target) return 'xl/worksheets/sheet1.xml';
  target = target.replace(/^\/+/, '');
  return /^xl\//.test(target) ? target : 'xl/' + target;
}
/** parts: {zip entry name: XML text}. -> {rows} or {error} */
export function read(parts) {
  parts = parts || {};
  var path = firstSheetPath(parts['xl/workbook.xml'], parts['xl/_rels/workbook.xml.rels']);
  var sheet = parts[path];
  if (!sheet) return { error: 'This does not look like an Excel (.xlsx) file: no worksheet inside.', rows: [] };
  return { rows: sheetRows(sheet, sharedStrings(parts['xl/sharedStrings.xml'])) };
}

/** The zip entries read() needs. */
export function wanted(name) { return /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name); }

/** Zip bytes -> {entry name: text} for the entries `keep(name)` accepts (stored or deflated; no zip64). */
export async function unzip(bytes, keep = () => true) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = u8.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('This file is not an Excel (.xlsx) file. Save it as .xlsx or CSV and try again.');
  const n = dv.getUint16(eocd + 10, true), out = {};
  let p = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!keep(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    if (method === 0) { out[name] = utf8.decode(raw); continue; }
    if (method !== 8) throw new Error('This .xlsx uses a compression the page can\'t read. Save it again from Excel or Google Sheets.');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    out[name] = await new Response(stream).text();
  }
  return out;
}

/** The first worksheet of an .xlsx (ArrayBuffer or bytes) -> rows (2D array of strings, empty rows left out). */
export async function xlsxRows(bytes) {
  const x = read(await unzip(bytes, wanted));
  if (x.error) throw new Error(x.error);
  return x.rows;
}
