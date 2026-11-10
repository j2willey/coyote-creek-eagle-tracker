// @ts-check
/**
 * Browser & Node PDF engine for the Review page's Sign & Flatten Workshop (Jim W., 2026-11-09).
 *
 * Responsibilities:
 * 1. Inspect a PDF with `pdf.js` to extract per-page text and AcroForm widget names/values, then run
 *    `analyzeWorkbookPages` from `./pdfPlan.js`.
 * 2. Transparently decrypt official BSA workbooks (2023a and 2026) that use PDF 2.0 / ISO 32000-2 empty-user-password
 *    permissions encryption (`/V 5 /R 6 /CFM /AESV3`) so `pdf-lib` can load, edit, and save them as standard vector PDFs.
 * 3. Fill Council/District Printed Name & Date AcroForm fields where present (or draw vector text with `drawText`),
 *    stamp the high-DPI PNG signature onto our Proposal Approval page, and flatten form fields ONLY on the Proposal
 *    pages (`0..proposalEndPageIndex`), leaving Project Plan, Fundraising Application, and Project Report fields
 *    completely untouched and fillable.
 */

import {
  analyzeWorkbookPages,
  canSignPage,
  fitTextFontSize,
  fitSignatureDimensions,
  defaultSignPlacement
} from './pdfPlan.js';

/**
 * @typedef {import('./pdfPlan.js').WorkbookAnalysis} WorkbookAnalysis
 * @typedef {import('./pdfPlan.js').SignPlacement} SignPlacement
 * @typedef {import('./pdfPlan.js').BoxPlacement} BoxPlacement
 */

// ---------------------------------------------------------------------------
// Pure-JS synchronous AES-128 / AES-256 CBC decryptor + WebCrypto key derivation
// ---------------------------------------------------------------------------

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const RCON = new Uint8Array(11);
const MUL9 = new Uint8Array(256);
const MUL11 = new Uint8Array(256);
const MUL13 = new Uint8Array(256);
const MUL14 = new Uint8Array(256);

(function initAesTables() {
  const p = new Uint8Array(256);
  const q = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    p[i] = x;
    q[x] = i;
    x = (x ^ (x << 1) ^ (x & 0x80 ? 0x11b : 0)) & 0xff;
  }
  p[255] = 1;
  const rotl8 = (/** @type {number} */ v, /** @type {number} */ s) => ((v << s) | (v >>> (8 - s))) & 0xff;
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
  for (let i = 1; i < 256; i++) {
    const inv = p[255 - q[i]];
    const s = (inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63) & 0xff;
    SBOX[i] = s;
    INV_SBOX[s] = i;
  }
  let r = 1;
  for (let i = 1; i <= 10; i++) {
    RCON[i] = r;
    r = ((r << 1) ^ (r & 0x80 ? 0x11b : 0)) & 0xff;
  }
  const xtime = (/** @type {number} */ v) => ((v << 1) ^ (v & 0x80 ? 0x11b : 0)) & 0xff;
  for (let i = 0; i < 256; i++) {
    const x2 = xtime(i);
    const x4 = xtime(x2);
    const x8 = xtime(x4);
    MUL9[i] = x8 ^ i;
    MUL11[i] = x8 ^ x2 ^ i;
    MUL13[i] = x8 ^ x4 ^ i;
    MUL14[i] = x8 ^ x4 ^ x2;
  }
})();

/**
 * Expand a 16-byte or 32-byte AES key into round keys.
 * @param {Uint8Array} key
 * @returns {{ w: Uint8Array, nr: number }}
 */
function expandKey(key) {
  const nk = key.length >>> 2;
  const nr = nk + 6;
  const wLen = 16 * (nr + 1);
  const w = new Uint8Array(wLen);
  w.set(key);
  const kBytes = nk * 4;
  let rconIdx = 1;
  for (let j = kBytes; j < wLen; ) {
    let t0 = w[j - 4], t1 = w[j - 3], t2 = w[j - 2], t3 = w[j - 1];
    if (j % kBytes === 0) {
      const u = t0;
      t0 = SBOX[t1] ^ RCON[rconIdx++];
      t1 = SBOX[t2];
      t2 = SBOX[t3];
      t3 = SBOX[u];
    } else if (nk === 8 && j % kBytes === 16) {
      t0 = SBOX[t0];
      t1 = SBOX[t1];
      t2 = SBOX[t2];
      t3 = SBOX[t3];
    }
    w[j] = w[j - kBytes] ^ t0; j++;
    w[j] = w[j - kBytes] ^ t1; j++;
    w[j] = w[j - kBytes] ^ t2; j++;
    w[j] = w[j - kBytes] ^ t3; j++;
  }
  return { w, nr };
}

/**
 * Synchronous AES-CBC raw decryption (no padding removal).
 * @param {Uint8Array} key
 * @param {Uint8Array} iv
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function aesCbcDecryptRaw(key, iv, data) {
  const { w, nr } = expandKey(key);
  const out = new Uint8Array(data.length);
  const s = new Uint8Array(16);
  const t = new Uint8Array(16);
  let prev = iv;
  for (let off = 0; off + 16 <= data.length; off += 16) {
    let kOff = nr * 16;
    for (let i = 0; i < 16; i++) s[i] = data[off + i] ^ w[kOff + i];
    for (let round = nr - 1; round >= 1; round--) {
      kOff = round * 16;
      t[0]  = INV_SBOX[s[0]]  ^ w[kOff + 0];
      t[1]  = INV_SBOX[s[13]] ^ w[kOff + 1];
      t[2]  = INV_SBOX[s[10]] ^ w[kOff + 2];
      t[3]  = INV_SBOX[s[7]]  ^ w[kOff + 3];
      t[4]  = INV_SBOX[s[4]]  ^ w[kOff + 4];
      t[5]  = INV_SBOX[s[1]]  ^ w[kOff + 5];
      t[6]  = INV_SBOX[s[14]] ^ w[kOff + 6];
      t[7]  = INV_SBOX[s[11]] ^ w[kOff + 7];
      t[8]  = INV_SBOX[s[8]]  ^ w[kOff + 8];
      t[9]  = INV_SBOX[s[5]]  ^ w[kOff + 9];
      t[10] = INV_SBOX[s[2]]  ^ w[kOff + 10];
      t[11] = INV_SBOX[s[15]] ^ w[kOff + 11];
      t[12] = INV_SBOX[s[12]] ^ w[kOff + 12];
      t[13] = INV_SBOX[s[9]]  ^ w[kOff + 13];
      t[14] = INV_SBOX[s[6]]  ^ w[kOff + 14];
      t[15] = INV_SBOX[s[3]]  ^ w[kOff + 15];
      for (let c = 0; c < 16; c += 4) {
        const a0 = t[c], a1 = t[c + 1], a2 = t[c + 2], a3 = t[c + 3];
        s[c]     = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3];
        s[c + 1] = MUL9[a0]  ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3];
        s[c + 2] = MUL13[a0] ^ MUL9[a1]  ^ MUL14[a2] ^ MUL11[a3];
        s[c + 3] = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2]  ^ MUL14[a3];
      }
    }
    out[off + 0]  = INV_SBOX[s[0]]  ^ w[0]  ^ prev[0];
    out[off + 1]  = INV_SBOX[s[13]] ^ w[1]  ^ prev[1];
    out[off + 2]  = INV_SBOX[s[10]] ^ w[2]  ^ prev[2];
    out[off + 3]  = INV_SBOX[s[7]]  ^ w[3]  ^ prev[3];
    out[off + 4]  = INV_SBOX[s[4]]  ^ w[4]  ^ prev[4];
    out[off + 5]  = INV_SBOX[s[1]]  ^ w[5]  ^ prev[5];
    out[off + 6]  = INV_SBOX[s[14]] ^ w[6]  ^ prev[6];
    out[off + 7]  = INV_SBOX[s[11]] ^ w[7]  ^ prev[7];
    out[off + 8]  = INV_SBOX[s[8]]  ^ w[8]  ^ prev[8];
    out[off + 9]  = INV_SBOX[s[5]]  ^ w[9]  ^ prev[9];
    out[off + 10] = INV_SBOX[s[2]]  ^ w[10] ^ prev[10];
    out[off + 11] = INV_SBOX[s[15]] ^ w[11] ^ prev[11];
    out[off + 12] = INV_SBOX[s[12]] ^ w[12] ^ prev[12];
    out[off + 13] = INV_SBOX[s[9]]  ^ w[13] ^ prev[13];
    out[off + 14] = INV_SBOX[s[6]]  ^ w[14] ^ prev[14];
    out[off + 15] = INV_SBOX[s[3]]  ^ w[15] ^ prev[15];
    prev = data.subarray(off, off + 16);
  }
  return out;
}

/**
 * Decrypt AES-256-CBC data where the first 16 bytes are the IV and PKCS#7 padding is stripped.
 * @param {Uint8Array} key
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function aes256CbcDecryptPkcs7(key, data) {
  if (!data || data.length < 16 || data.length % 16 !== 0) return data;
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  if (body.length === 0) return new Uint8Array(0);
  const raw = aesCbcDecryptRaw(key, iv, body);
  const pad = raw[raw.length - 1];
  if (pad >= 1 && pad <= 16 && pad <= raw.length) {
    return raw.subarray(0, raw.length - pad);
  }
  return raw;
}

const bufSrc = (/** @type {Uint8Array} */ u8) => /** @type {BufferSource} */ (/** @type {unknown} */ (u8));

/**
 * ISO 32000-2 Algorithm 2.B (Revision 6) hash for an empty password (`""`).
 * @param {Uint8Array} salt8
 * @returns {Promise<Uint8Array>}
 */
export async function computePdf20HashEmptyPasswordAsync(salt8) {
  const subtle = globalThis.crypto.subtle;
  let k = new Uint8Array(await subtle.digest('SHA-256', bufSrc(salt8)));
  let lastByte = 0;
  let i = 0;
  while (i < 64 || lastByte > i - 32) {
    const k1 = new Uint8Array(k.length * 64);
    for (let j = 0; j < 64; j++) k1.set(k, j * k.length);
    const aesKey = await subtle.importKey('raw', bufSrc(k.subarray(0, 16)), { name: 'AES-CBC' }, false, ['encrypt']);
    const encBuf = await subtle.encrypt({ name: 'AES-CBC', iv: bufSrc(k.subarray(16, 32)) }, aesKey, bufSrc(k1));
    const e = new Uint8Array(encBuf, 0, k1.length);
    lastByte = e[e.length - 1];
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    const rem = sum % 3;
    const alg = rem === 0 ? 'SHA-256' : rem === 1 ? 'SHA-384' : 'SHA-512';
    k = new Uint8Array(await subtle.digest(alg, bufSrc(e)));
    i++;
  }
  return k.subarray(0, 32);
}

/**
 * Parse a PDF literal string `(...)` (starting right after the opening `(`) into raw bytes.
 * @param {string} raw
 * @returns {Uint8Array}
 */
function parsePdfLiteralBytes(raw) {
  /** @type {number[]} */
  const out = [];
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x28) { depth++; out.push(c); }
    else if (c === 0x29) { if (depth === 0) break; depth--; out.push(c); }
    else if (c === 0x5c) {
      i++;
      if (i >= raw.length) break;
      const n = raw.charCodeAt(i);
      if (n === 0x6e) out.push(0x0a);
      else if (n === 0x72) out.push(0x0d);
      else if (n === 0x74) out.push(0x09);
      else if (n === 0x62) out.push(0x08);
      else if (n === 0x66) out.push(0x0c);
      else if (n === 0x28 || n === 0x29 || n === 0x5c) out.push(n);
      else if (n === 0x0d) { if (raw.charCodeAt(i + 1) === 0x0a) i++; }
      else if (n === 0x0a) { /* line continuation */ }
      else if (n >= 0x30 && n <= 0x37) {
        let oct = n - 0x30;
        for (let k = 0; k < 2; k++) {
          const d = raw.charCodeAt(i + 1);
          if (d >= 0x30 && d <= 0x37) { oct = (oct << 3) + (d - 0x30); i++; }
          else break;
        }
        out.push(oct & 0xff);
      } else out.push(n);
    } else out.push(c);
  }
  return new Uint8Array(out);
}

const UNSUPPORTED_ENCRYPT_MSG =
  "This PDF is protected in a way the Workshop can't open. Use download, sign and upload instead.";
const UNSAFE_FLATTEN_MSG =
  "This Proposal has form text the Workshop can't flatten safely. Use download, sign and upload instead.";

/**
 * Parse a dictionary string entry (`/Key (...)` or `/Key <hex>`, with or without whitespace after `/Key`) into raw bytes.
 * @param {string} dictStr
 * @param {string} keyName
 * @returns {Uint8Array | null}
 */
function parsePdfDictStringEntry(dictStr, keyName) {
  const re = new RegExp(`\\/${keyName}(?![A-Za-z0-9_])\\s*([(<])`, 'g');
  const m = re.exec(dictStr);
  if (!m) return null;
  const delim = m[1];
  const startIdx = m.index + m[0].length;
  if (delim === '(') {
    return parsePdfLiteralBytes(dictStr.slice(startIdx));
  }
  const endIdx = dictStr.indexOf('>', startIdx);
  if (endIdx < 0) return null;
  let hex = dictStr.slice(startIdx, endIdx).replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]*$/.test(hex)) return null;
  if (hex.length % 2 === 1) hex += '0';
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Extract the 32-byte AES-256 file encryption key from a PDF that uses `/V 5` (`AESV3`) standard encryption with an
 * empty user password. Returns `null` if the PDF has no `/Encrypt` entry; throws a plain user-facing message if the
 * PDF is encrypted in an unsupported way or requires a non-empty password.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ encryptObjNum: number, fileKey: Uint8Array } | null>}
 */
export async function extractEncryptKeyAsync(bytes) {
  let str = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + chunk));
    let part = '';
    for (let j = 0; j < sub.length; j++) part += String.fromCharCode(sub[j]);
    str += part;
  }
  const encMatches = [...str.matchAll(/\/Encrypt\s+(\d+)\s+\d+\s+R/g)];
  if (!encMatches.length) {
    if (/\/Encrypt\s*<</.test(str)) {
      throw new Error(UNSUPPORTED_ENCRYPT_MSG);
    }
    return null;
  }
  const encryptObjNum = Number(encMatches[encMatches.length - 1][1]);
  const objRegex = new RegExp(`\\b${encryptObjNum}\\s+\\d+\\s+obj[\\s\\S]*?endobj`, 'g');
  const objMatches = [...str.matchAll(objRegex)];
  if (!objMatches.length) {
    throw new Error(UNSUPPORTED_ENCRYPT_MSG);
  }
  const dictStr = objMatches[objMatches.length - 1][0];
  if (!/\/V\s+5\b/.test(dictStr)) {
    throw new Error(UNSUPPORTED_ENCRYPT_MSG);
  }
  const rMatch = dictStr.match(/\/R\s+(\d+)/);
  const revision = rMatch ? Number(rMatch[1]) : 6;
  if (revision !== 5 && revision !== 6) {
    throw new Error(UNSUPPORTED_ENCRYPT_MSG);
  }
  const uBytes = parsePdfDictStringEntry(dictStr, 'U');
  const ueBytes = parsePdfDictStringEntry(dictStr, 'UE');
  if (!uBytes || uBytes.length < 48 || !ueBytes || ueBytes.length < 32) {
    throw new Error(UNSUPPORTED_ENCRYPT_MSG);
  }

  const userValidationSalt = uBytes.subarray(32, 40);
  const userKeySalt = uBytes.subarray(40, 48);
  const subtle = globalThis.crypto.subtle;
  const valKey = revision === 6
    ? await computePdf20HashEmptyPasswordAsync(userValidationSalt)
    : new Uint8Array(await subtle.digest('SHA-256', bufSrc(userValidationSalt)));
  for (let i = 0; i < 32; i++) {
    if (valKey[i] !== uBytes[i]) {
      throw new Error(UNSUPPORTED_ENCRYPT_MSG);
    }
  }
  const intKey = revision === 6
    ? await computePdf20HashEmptyPasswordAsync(userKeySalt)
    : new Uint8Array(await subtle.digest('SHA-256', bufSrc(userKeySalt)));
  const fileKey = aesCbcDecryptRaw(intKey, new Uint8Array(16), ueBytes.subarray(0, 32));
  return { encryptObjNum, fileKey };
}

/**
 * Recursively decrypt a parsed top-level `pdf-lib` object in place using the 32-byte `fileKey`.
 * @param {any} PDFLib
 * @param {any} obj
 * @param {Uint8Array} fileKey
 */
function decryptPdfObjectInPlace(PDFLib, obj, fileKey) {
  if (!obj) return;
  const { PDFRawStream, PDFDict, PDFArray, PDFString, PDFHexString, PDFName } = PDFLib;
  if (obj instanceof PDFRawStream) {
    const type = obj.dict.lookup(PDFName.of('Type'));
    if (type === PDFName.of('XRef')) return;
    obj.contents = aes256CbcDecryptPkcs7(fileKey, obj.contents);
    decryptPdfObjectInPlace(PDFLib, obj.dict, fileKey);
  } else if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      if (k === PDFName.of('ID')) continue;
      decryptPdfObjectInPlace(PDFLib, v, fileKey);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      decryptPdfObjectInPlace(PDFLib, obj.get(i), fileKey);
    }
  } else if (obj instanceof PDFString) {
    const raw = new Uint8Array(obj.value.length);
    for (let i = 0; i < obj.value.length; i++) raw[i] = obj.value.charCodeAt(i) & 0xff;
    const dec = aes256CbcDecryptPkcs7(fileKey, raw);
    let s = '';
    for (let i = 0; i < dec.length; i++) s += String.fromCharCode(dec[i]);
    obj.value = s;
  } else if (obj instanceof PDFHexString) {
    const hex = obj.value.replace(/\s+/g, '');
    const raw = new Uint8Array(hex.length >>> 1);
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const dec = aes256CbcDecryptPkcs7(fileKey, raw);
    let h = '';
    for (let i = 0; i < dec.length; i++) h += dec[i].toString(16).padStart(2, '0');
    obj.value = h;
  }
}

/** @type {Promise<unknown>} */
let decryptLoadQueue = Promise.resolve();

/**
 * Run an async task exclusively so concurrent `loadPdfWithDecrypt` calls never interleave their `PDFParser.prototype`
 * hooks.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withDecryptLock(fn) {
  const next = decryptLoadQueue.then(fn, fn);
  decryptLoadQueue = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Load a PDF into `pdf-lib`, transparently decrypting empty-user-password `/V 5` (`AESV3`) encrypted PDFs (such as the
 * official 2023a and 2026 BSA workbooks) and stripping the `/Encrypt` trailer entry so the saved output is a normal
 * unencrypted PDF.
 * @param {any} PDFLib
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<any>}
 */
export async function loadPdfWithDecrypt(PDFLib, pdfBytes) {
  const u8 = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const info = await extractEncryptKeyAsync(u8);
  if (!info) {
    try {
      return await PDFLib.PDFDocument.load(u8);
    } catch (err) {
      if (err && /encrypt/i.test(String(err.message || err.name || err))) {
        throw new Error(UNSUPPORTED_ENCRYPT_MSG);
      }
      throw err;
    }
  }
  return withDecryptLock(async () => {
    const { PDFParser } = PDFLib;
    const origParseHeader = PDFParser.prototype.parseIndirectObjectHeader;
    const origParseObject = PDFParser.prototype.parseObject;
    let currentObjNum = -1;
    let parseDepth = 0;
    PDFParser.prototype.parseIndirectObjectHeader = function () {
      const ref = origParseHeader.call(this);
      currentObjNum = ref.objectNumber;
      return ref;
    };
    PDFParser.prototype.parseObject = function () {
      parseDepth++;
      try {
        const obj = origParseObject.call(this);
        if (parseDepth === 1 && currentObjNum !== info.encryptObjNum) {
          decryptPdfObjectInPlace(PDFLib, obj, info.fileKey);
        }
        return obj;
      } finally {
        parseDepth--;
      }
    };
    try {
      const doc = await PDFLib.PDFDocument.load(u8, { ignoreEncryption: true });
      delete doc.context.trailerInfo.Encrypt;
      return doc;
    } finally {
      PDFParser.prototype.parseIndirectObjectHeader = origParseHeader;
      PDFParser.prototype.parseObject = origParseObject;
    }
  });
}

/**
 * Extract a widget's normal appearance stream reference if present, returning `null` when the widget has no appearance
 * stream (e.g. an empty `Sig` widget).
 * @param {any} PDFLib
 * @param {any} field
 * @param {any} widget
 * @returns {any | null}
 */
function extractAppearanceRef(PDFLib, field, widget) {
  const { PDFDict, PDFCheckBox, PDFRadioGroup, PDFName, PDFRef } = PDFLib;
  let refOrDict;
  try {
    refOrDict = widget.getNormalAppearance();
  } catch {
    return null;
  }
  if (!refOrDict) return null;
  if (refOrDict instanceof PDFDict && (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)) {
    const asState = widget.dict.lookup(PDFName.of('AS'));
    const value = field.acroField.getValue();
    const ref = (asState && refOrDict.get(asState)) ?? refOrDict.get(value) ?? refOrDict.get(PDFName.of('Off'));
    if (ref instanceof PDFRef) refOrDict = ref;
  }
  return refOrDict instanceof PDFRef ? refOrDict : null;
}

/**
 * Determine whether an AcroForm field has a non-empty value (`/V`) that must not be lost during flattening.
 * @param {any} PDFLib
 * @param {any} field
 * @returns {boolean}
 */
function fieldHasNonEmptyValue(PDFLib, field) {
  const { PDFTextField, PDFDropdown, PDFOptionList, PDFCheckBox, PDFRadioGroup, PDFName, PDFString, PDFHexString } = PDFLib;
  try {
    if (field instanceof PDFTextField) {
      const t = field.getText();
      return Boolean(t && String(t).trim().length > 0);
    }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const sel = field.getSelected();
      return Array.isArray(sel) && sel.some((/** @type {any} */ s) => String(s || '').trim().length > 0);
    }
    if (field instanceof PDFCheckBox) {
      return field.isChecked();
    }
    if (field instanceof PDFRadioGroup) {
      const v = field.getSelected();
      return Boolean(v && v !== 'Off');
    }
  } catch {
    return true;
  }
  const rawV = field.acroField && field.acroField.dict ? field.acroField.dict.lookup(PDFName.of('V')) : undefined;
  if (!rawV || rawV === PDFName.of('Off')) return false;
  if (rawV instanceof PDFString || rawV instanceof PDFHexString) {
    return rawV.decodeText().trim().length > 0;
  }
  return false;
}

/**
 * Flatten AcroForm widgets on pages `0..maxPageIndex` (inclusive) into static page content while keeping all widgets
 * and fields on pages `> maxPageIndex` intact and fillable.
 *
 * Never loses or misstates the Scout's text:
 * - If a field on `0..maxPageIndex` has a non-empty value and no normal appearance stream, generates one for that field
 *   only.
 * - If the AcroForm has `/NeedAppearances true`, regenerates appearances for valued text/choice fields on the Proposal
 *   pages (`0..maxPageIndex`) and clears `/NeedAppearances`.
 * - If a valued field cannot be rendered safely by `pdf-lib` (e.g. unsupported glyph encoding), throws a plain message.
 *
 * @param {any} PDFLib
 * @param {any} pdfDoc
 * @param {number} maxPageIndex
 * @param {any} [fallbackFont]
 */
export function flattenPagesUpTo(PDFLib, pdfDoc, maxPageIndex, fallbackFont) {
  const {
    pushGraphicsState,
    popGraphicsState,
    translate,
    drawObject,
    PDFName,
    PDFBool,
    PDFTextField,
    PDFDropdown,
    PDFOptionList,
    PDFSignature
  } = PDFLib;
  const pages = pdfDoc.getPages();
  const pageIndexByRef = new Map();
  pages.forEach((/** @type {any} */ p, /** @type {number} */ idx) => pageIndexByRef.set(p.ref, idx));
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const needAppearances = form.acroForm.dict.lookup(PDFName.of('NeedAppearances')) === PDFBool.True;
  let font = fallbackFont || null;
  const getFont = () => {
    if (!font) font = form.getDefaultFont();
    return font;
  };

  for (const field of fields) {
    if (field instanceof PDFSignature) continue;
    const widgets = field.acroField.getWidgets();
    const targetWidgets = widgets.filter((/** @type {any} */ w) => {
      try {
        const pg = form.findWidgetPage(w);
        const pIdx = pageIndexByRef.get(pg.ref);
        return pIdx !== undefined && pIdx <= maxPageIndex;
      } catch {
        return false;
      }
    });
    if (targetWidgets.length === 0) continue;

    const hasVal = fieldHasNonEmptyValue(PDFLib, field);
    if (!hasVal) continue;

    const isTextOrChoice =
      field instanceof PDFTextField ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList;
    const missingAnyAp = targetWidgets.some((/** @type {any} */ w) => !extractAppearanceRef(PDFLib, field, w));

    if (missingAnyAp || (needAppearances && isTextOrChoice)) {
      try {
        if (typeof field.defaultUpdateAppearances === 'function') {
          field.defaultUpdateAppearances(getFont());
        } else {
          throw new Error(UNSAFE_FLATTEN_MSG);
        }
      } catch {
        throw new Error(UNSAFE_FLATTEN_MSG);
      }
    }
  }

  if (needAppearances) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
  }

  for (const field of fields) {
    const widgets = field.acroField.getWidgets();
    let keptWidgets = 0;
    const kidsArray = field.acroField.normalizedEntries().Kids;
    const hasVal = !(field instanceof PDFSignature) && fieldHasNonEmptyValue(PDFLib, field);
    for (const widget of widgets) {
      let page;
      try {
        page = form.findWidgetPage(widget);
      } catch {
        keptWidgets++;
        continue;
      }
      const pIdx = pageIndexByRef.get(page.ref);
      if (pIdx === undefined || pIdx > maxPageIndex) {
        keptWidgets++;
        continue;
      }
      const appRef = extractAppearanceRef(PDFLib, field, widget);
      if (!appRef && hasVal) {
        throw new Error(UNSAFE_FLATTEN_MSG);
      }
      if (appRef) {
        const xObjectKey = page.node.newXObject('FlatWidget', appRef);
        const rect = widget.getRectangle();
        page.pushOperators(
          pushGraphicsState(),
          translate(rect.x, rect.y),
          drawObject(xObjectKey),
          popGraphicsState()
        );
      }
      const widgetRef = pdfDoc.context.getObjectRef(widget.dict);
      if (widgetRef) {
        page.node.removeAnnot(widgetRef);
        if (kidsArray) {
          const kIdx = kidsArray.indexOf(widgetRef);
          if (kIdx !== undefined && kIdx >= 0) kidsArray.remove(kIdx);
        }
      }
      page.node.removeAnnot(field.ref);
    }
    if (keptWidgets === 0) {
      form.acroForm.removeField(field.acroField);
      pdfDoc.context.delete(field.ref);
    }
  }
}

/**
 * Inspect a PDF using `pdf.js` and run `analyzeWorkbookPages` to locate our Proposal Approval page(s) and forbidden
 * post-Proposal pages.
 * @param {any} pdfjsLib
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<{ pdfjsDoc: any, analysis: WorkbookAnalysis, pageSizes: Array<{ width: number, height: number }> }>}
 */
export async function inspectPdfWithPdfJs(pdfjsLib, pdfBytes) {
  const copy = new Uint8Array(pdfBytes.byteLength);
  copy.set(pdfBytes);
  const pdfjsDoc = await pdfjsLib.getDocument({ data: copy, verbosity: 0 }).promise;
  /** @type {import('./pdfPlan.js').PageDescriptorInput[]} */
  const descriptors = [];
  /** @type {Array<{ width: number, height: number }>} */
  const pageSizes = [];

  for (let p = 1; p <= pdfjsDoc.numPages; p++) {
    const page = await pdfjsDoc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pageSizes.push({ width: vp.width, height: vp.height });

    const tc = await page.getTextContent();
    const text = tc.items.map((/** @type {any} */ it) => it.str || '').join(' ').replace(/\s+/g, ' ').trim();
    const annots = await page.getAnnotations();
    /** @type {string[]} */
    const fields = [];
    /** @type {Record<string, string>} */
    const fieldValues = {};
    for (const a of annots) {
      if (a && a.subtype === 'Widget' && a.fieldName) {
        fields.push(String(a.fieldName));
        const val = a.fieldValue != null ? String(a.fieldValue).trim() : '';
        if (val) fieldValues[String(a.fieldName)] = val;
      }
    }
    descriptors.push({
      pageIndex: p - 1,
      text,
      fields,
      fieldValues
    });
  }

  const analysis = analyzeWorkbookPages(descriptors);
  return { pdfjsDoc, analysis, pageSizes };
}

/**
 * Check whether two box placements are at the same coordinates and dimensions (within 0.5 pt).
 * @param {BoxPlacement} a
 * @param {BoxPlacement} b
 * @returns {boolean}
 */
function sameBoxSizeAndPos(a, b) {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Apply the reviewer's signature PNG, printed name, and date to the selected Proposal Approval page, and flatten
 * form fields on all Proposal pages (`0..analysis.proposalEndPageIndex`).
 *
 * Enforces the hard guardrail:
 * - `canSignPage(analysis, pageIndex)` must succeed (never signs a Project Plan, Fundraising, or Project Report page).
 *
 * @param {any} PDFLib
 * @param {{
 *   pdfBytes: Uint8Array,
 *   analysis: WorkbookAnalysis,
 *   pageIndex: number,
 *   signerIndex?: number,
 *   signaturePngBytes: Uint8Array,
 *   printedName: string,
 *   dateStr: string,
 *   signatureScale?: number,
 *   textFontSize?: number,
 *   placement?: SignPlacement
 * }} opts
 * @returns {Promise<{ pdfBytes: Uint8Array }>}
 */
export async function applySignatureAndFlatten(PDFLib, opts) {
  const {
    pdfBytes,
    analysis,
    pageIndex,
    signerIndex = 0,
    signaturePngBytes,
    printedName,
    dateStr,
    signatureScale = 1,
    textFontSize = 0
  } = opts;

  const pageCheck = canSignPage(analysis, pageIndex);
  if (!pageCheck.ok) {
    throw new Error(pageCheck.reason);
  }
  if (!signaturePngBytes || !signaturePngBytes.byteLength) {
    throw new Error('Create or select your signature first.');
  }
  const cleanName = String(printedName || '').trim();
  const cleanDate = String(dateStr || '').trim();
  if (!cleanName) {
    throw new Error('Enter your printed name.');
  }
  if (!cleanDate) {
    throw new Error('Enter the approval date.');
  }

  const pdfDoc = await loadPdfWithDecrypt(PDFLib, pdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[pageIndex];
  if (!page) {
    throw new Error('Selected page does not exist in this PDF.');
  }

  const pageSize = page.getSize();
  const defPlacement = defaultSignPlacement(analysis.edition, signerIndex, pageSize);
  const placement = opts.placement || defPlacement;

  const { StandardFonts, rgb } = PDFLib;
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pngImage = await pdfDoc.embedPng(signaturePngBytes);
  const form = pdfDoc.getForm();
  const isFirstSigner = Number(signerIndex) === 0;
  const hasCustomFontSize = Number(textFontSize) > 0;

  // 1. Fill AcroForm fields first (Signer 1 default path) before flattening
  let filledNameField = false;
  if (
    isFirstSigner &&
    !hasCustomFontSize &&
    placement.printedName.fieldName &&
    sameBoxSizeAndPos(placement.printedName, defPlacement.printedName)
  ) {
    try {
      const tf = form.getTextField(placement.printedName.fieldName);
      if (tf) {
        tf.setText(cleanName);
        tf.defaultUpdateAppearances(helvetica);
        filledNameField = true;
      }
    } catch {
      filledNameField = false;
    }
  }

  let filledDateField = false;
  if (
    isFirstSigner &&
    !hasCustomFontSize &&
    placement.date.fieldName &&
    sameBoxSizeAndPos(placement.date, defPlacement.date)
  ) {
    try {
      const df = form.getTextField(placement.date.fieldName);
      if (df) {
        df.setText(cleanDate);
        df.defaultUpdateAppearances(helvetica);
        filledDateField = true;
      }
    } catch {
      filledDateField = false;
    }
  }

  // 2. Flatten ONLY the Proposal range (pages 0..proposalEndPageIndex), preserving post-Proposal fields.
  //    Flattening runs BEFORE drawText/drawImage so widget backgrounds or borders never paint over the committee's marks.
  const flattenEnd = Math.max(pageIndex, analysis.proposalEndPageIndex);
  flattenPagesUpTo(PDFLib, pdfDoc, flattenEnd, helvetica);

  // 3. Draw non-field Printed Name / Date and Signature PNG on top of the flattened page content
  if (!filledNameField) {
    const nb = placement.printedName;
    const fSize = fitTextFontSize(cleanName, nb.width, nb.height, hasCustomFontSize ? textFontSize : 0);
    page.drawText(cleanName, {
      x: nb.x + 2,
      y: nb.y + Math.max(2, (nb.height - fSize) / 2),
      size: fSize,
      font: helvetica,
      color: rgb(0.05, 0.05, 0.1)
    });
  }

  if (!filledDateField) {
    const db = placement.date;
    const fSize = fitTextFontSize(cleanDate, db.width, db.height, hasCustomFontSize ? textFontSize : 0);
    page.drawText(cleanDate, {
      x: db.x + 2,
      y: db.y + Math.max(2, (db.height - fSize) / 2),
      size: fSize,
      font: helvetica,
      color: rgb(0.05, 0.05, 0.1)
    });
  }

  const sb = placement.signature;
  const imgDims = pngImage.scale(1);
  const sigDraw = fitSignatureDimensions(imgDims.width, imgDims.height, sb, signatureScale);
  page.drawImage(pngImage, {
    x: sigDraw.x,
    y: sigDraw.y,
    width: sigDraw.width,
    height: sigDraw.height
  });

  const saved = await pdfDoc.save({ updateFieldAppearances: false });
  return {
    pdfBytes: saved instanceof Uint8Array ? saved : new Uint8Array(saved)
  };
}
