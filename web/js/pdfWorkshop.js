// @ts-check
/**
 * In-Browser PDF Sign & Flatten Workshop modal for `/committee/review` (Jim W., 2026-11-09).
 *
 * Lazy-loads `pdf-lib` and `pdf.js` from `cdn.jsdelivr.net` (and the 10 OFL Google Script Fonts stylesheet) only when
 * a committee member opens the Sign Workshop. Manages the member's signature in `localStorage` (Type in 10 script fonts
 * at 3x DPI, Draw on canvas, or Upload with white background made transparent), supports signature & text sizing.
 *
 * v2 (Task 9): the member PLACES the marks. The preview is a scrollable view of every page (rendered lazily with an
 * IntersectionObserver); the toolbar buttons (Signature, Printed name, Date) arm a click that drops the mark on a page
 * (or, on a detected approval page, drop it at the workbook's own box). Marks can be dragged, resized and removed.
 * Nothing is applied until "Sign & Attach PDF"; then the Proposal pages AND every marked page are flattened, never a
 * Project Plan / Fundraising / Project Report page.
 */

import {
  MAX_BYTES,
  PDFLIB_VERSION,
  PDFJS_VERSION,
  SIG_SCALE_MIN,
  SIG_SCALE_MAX,
  TEXT_FONT_MIN_PT,
  TEXT_FONT_MAX_PT,
  SCRIPT_FONTS,
  canPlaceOnPage,
  describeTargetPage,
  describePageRanges,
  approvalBanner,
  checkPlacement,
  flattenPageIndices,
  newItemAtPoint,
  defaultItem,
  fitTextFontSize,
  resizeBoxInPage,
  hasTransparentPixel,
  STAMP_OPAQUE_WARNING
} from './pdfPlan.js';

import { CDN_SCRIPTS } from './cdnIntegrity.js';

import {
  inspectPdfWithPdfJs,
  applyPlacedItemsAndFlatten
} from './pdfEngine.js';

/**
 * @typedef {import('./pdfPlan.js').WorkbookAnalysis} WorkbookAnalysis
 * @typedef {import('./pdfPlan.js').PlacedItem} PlacedItem
 * @typedef {import('./pdfPlan.js').ItemKind} ItemKind
 * @typedef {import('./pdfPlan.js').ScriptFontKey} ScriptFontKey
 *
 * @typedef {Object} SavedSignature
 * @property {'type' | 'draw' | 'upload'} mode
 * @property {string} typedText
 * @property {ScriptFontKey} fontKey
 * @property {string} pngDataUrl
 * @property {string} printedName
 * @property {number} signatureScale
 * @property {number} textFontSize
 * @property {boolean} [hasSaved]
 *
 * @typedef {Object} WorkshopOpenOptions
 * @property {Uint8Array} pdfBytes
 * @property {string} fileName
 * @property {string} [scoutName]
 * @property {string} [unit]
 * @property {string} [signerName]
 * @property {string} [signerInitials]
 * @property {string} [dateYmd]
 * @property {number} [signerIndex]
 * @property {string[]} [existingSignedBy]
 * @property {number} [maxBytes]
 * @property {StampApi} [stampApi]  stamps from the Drive folder (Task 9c); absent or `enabled: false` = no Stamp button
 *
 * @typedef {Object} StampApi
 * @property {() => Promise<{ enabled: boolean, stamps: Array<{ id: string, name: string, bytes: number }>, skipped?: Array<{ name: string, bytes: number }> }>} list
 * @property {(id: string) => Promise<{ name: string, mime: string, data: string }>} fetch
 *
 * @typedef {Object} StampData
 * @property {Uint8Array} bytes
 * @property {string} dataUrl
 * @property {number} aspect  width / height
 * @property {boolean} opaque  true when no pixel is transparent (a white-background stamp)
 *
 * @typedef {Object} WorkshopResult
 * @property {File} file
 * @property {string} printedName
 * @property {string} dateStr
 */

// URLs and their Subresource Integrity hashes live in cdnIntegrity.js. The pdf.js worker below cannot carry SRI
// (it is started as a Web Worker by pdf.js), nor can the Google Fonts stylesheet: a known, documented gap.
export const PDFLIB_CDN = CDN_SCRIPTS.pdfLib.url;
export const PDFJS_CDN = CDN_SCRIPTS.pdfJs.url;
export const PDFJS_WORKER_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
export const GOOGLE_SCRIPT_FONTS_URL =
  'https://fonts.googleapis.com/css2?' +
  SCRIPT_FONTS.map(f => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}`).join('&') +
  '&display=swap';

const SIG_STORAGE_KEY = 'ccacSignature_v1';
const STAMP_STORAGE_KEY = 'ccacStampId_v1';   // the last stamp chosen: its Drive file id only
/** Stamp images fetched this page session (id -> data), so reopening the Workshop does not fetch them again. */
const stampDataCache = /** @type {Map<string, StampData>} */ (new Map());
const VALID_FONT_KEYS = new Set(SCRIPT_FONTS.map(f => f.key));

/** @type {Promise<{ PDFLib: any, pdfjsLib: any }> | null} */
let libsPromise = null;

/**
 * Load an external classic `<script>` tag once.
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  const entry = Object.values(CDN_SCRIPTS).find(e => e.url === src);
  if (!entry) return Promise.reject(new Error(`No integrity hash is pinned for ${src}.`));
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.integrity = entry.integrity;
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load PDF library from ${src}.`));
    document.head.appendChild(s);
  });
}

/**
 * Inject the Google Fonts stylesheet for the 10 OFL script fonts on demand when the Workshop opens.
 */
export function ensureGoogleScriptFonts() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('ccacGoogleScriptFonts')) return;
  const link = document.createElement('link');
  link.id = 'ccacGoogleScriptFonts';
  link.rel = 'stylesheet';
  link.href = GOOGLE_SCRIPT_FONTS_URL;
  document.head.appendChild(link);
}

/**
 * Lazy-load `pdf-lib` and `pdf.js` from `cdn.jsdelivr.net`.
 * @returns {Promise<{ PDFLib: any, pdfjsLib: any }>}
 */
export function ensurePdfLibs() {
  if (!libsPromise) {
    libsPromise = (async () => {
      const win = /** @type {any} */ (window);
      if (!win.PDFLib) await loadScript(PDFLIB_CDN);
      if (!win.pdfjsLib) await loadScript(PDFJS_CDN);
      const PDFLib = win.PDFLib;
      const pdfjsLib = win.pdfjsLib;
      if (!PDFLib || !pdfjsLib) {
        throw new Error('PDF libraries failed to initialize in the browser.');
      }
      if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      }
      return { PDFLib, pdfjsLib };
    })().catch(err => {
      libsPromise = null;
      throw err;
    });
  }
  return libsPromise;
}

/**
 * Normalize a font key, mapping legacy `'script1' | 'script2' | 'script3'` or unknown keys to valid `SCRIPT_FONTS` keys.
 * @param {string} rawKey
 * @returns {ScriptFontKey}
 */
function normalizeFontKey(rawKey) {
  const k = String(rawKey || '').trim();
  if (VALID_FONT_KEYS.has(/** @type {ScriptFontKey} */ (k))) {
    return /** @type {ScriptFontKey} */ (k);
  }
  if (k === 'script2') return 'greatvibes';
  if (k === 'script3') return 'pinyon';
  return 'dancing';
}

/**
 * Look up a `SCRIPT_FONTS` entry by key.
 * @param {string} fontKey
 */
function getFontSpec(fontKey) {
  const norm = normalizeFontKey(fontKey);
  return SCRIPT_FONTS.find(f => f.key === norm) || SCRIPT_FONTS[0];
}

/**
 * Read saved signature state from `localStorage`.
 * `hasSaved` is `true` only when the member previously opted in to saving their signature in `localStorage`.
 * @param {string} fallbackName
 * @returns {SavedSignature}
 */
export function loadSavedSignature(fallbackName) {
  try {
    const raw = localStorage.getItem(SIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const rawScale = Number(parsed.signatureScale);
        const signatureScale = Number.isFinite(rawScale) && rawScale >= SIG_SCALE_MIN && rawScale <= SIG_SCALE_MAX
          ? Math.round(rawScale * 100) / 100
          : 1;
        const rawFontSize = Number(parsed.textFontSize);
        const textFontSize = Number.isFinite(rawFontSize) && rawFontSize >= TEXT_FONT_MIN_PT && rawFontSize <= TEXT_FONT_MAX_PT
          ? Math.round(rawFontSize * 2) / 2
          : 0;
        return {
          mode: parsed.mode === 'draw' || parsed.mode === 'upload' ? parsed.mode : 'type',
          typedText: String(parsed.typedText || fallbackName || ''),
          fontKey: normalizeFontKey(parsed.fontKey),
          pngDataUrl: String(parsed.pngDataUrl || ''),
          printedName: String(parsed.printedName || fallbackName || ''),
          signatureScale,
          textFontSize,
          hasSaved: true
        };
      }
    }
  } catch { /* ignore storage errors */ }
  return {
    mode: 'type',
    typedText: fallbackName || '',
    fontKey: 'dancing',
    pngDataUrl: '',
    printedName: fallbackName || '',
    signatureScale: 1,
    textFontSize: 0,
    hasSaved: false
  };
}

/**
 * Persist signature state to `localStorage`.
 * @param {SavedSignature} sig
 */
function saveSignatureToStorage(sig) {
  try {
    localStorage.setItem(SIG_STORAGE_KEY, JSON.stringify(sig));
  } catch { /* ignore quota/privacy errors */ }
}

/**
 * Render a typed signature in the chosen script font at ~3x DPI onto a transparent PNG data URL.
 * @param {string} text
 * @param {string} [fontKey]
 * @returns {string} PNG data URL (or '' if text is empty)
 */
export function renderTypedSignaturePng(text, fontKey = 'dancing') {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const spec = getFontSpec(fontKey);
  ctx.font = `48px "${spec.family}", "Segoe Script", "Brush Script MT", cursive`;
  ctx.fillStyle = '#0f296b';
  ctx.textBaseline = 'middle';

  const measured = ctx.measureText(clean).width;
  const maxW = canvas.width - 48;
  if (measured > maxW && measured > 0) {
    const ratio = maxW / measured;
    ctx.save();
    ctx.translate(24, canvas.height * 0.54);
    ctx.scale(ratio, ratio);
    ctx.fillText(clean, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(clean, 24, canvas.height * 0.54);
  }
  return canvas.toDataURL('image/png');
}

/**
 * Ensure the chosen Google Script webfont is loaded via `document.fonts.load(...)` before rendering the typed signature
 * to canvas, so the first draw uses the real webfont glyphs rather than a system fallback.
 * @param {string} text
 * @param {string} [fontKey]
 * @returns {Promise<string>}
 */
export async function renderTypedSignaturePngAsync(text, fontKey = 'dancing') {
  const spec = getFontSpec(fontKey);
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.load === 'function') {
    try {
      await document.fonts.load(`48px "${spec.family}"`);
    } catch { /* fallback font if offline */ }
  }
  return renderTypedSignaturePng(text, spec.key);
}

/**
 * Convert an uploaded signature image file into a transparent-background PNG data URL.
 * Pixels with near-white luminance (`> 240`) become transparent so paper backgrounds disappear cleanly.
 * @param {File} file
 * @returns {Promise<string>}
 */
function imageFileToTransparentPng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 720;
      const maxH = 220;
      const scale = Math.min(1, maxW / Math.max(1, img.width), maxH / Math.max(1, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 240) {
          d[i + 3] = 0;
        } else if (lum > 205) {
          d[i + 3] = Math.round(((240 - lum) / 35) * d[i + 3]);
        }
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

/**
 * Convert a `data:image/png;base64,...` URL into a `Uint8Array`.
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
function dataUrlToBytes(dataUrl) {
  const idx = String(dataUrl || '').indexOf(',');
  if (idx < 0) return new Uint8Array(0);
  const b64 = dataUrl.slice(idx + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode a fetched stamp (base64 PNG) and measure its aspect ratio and whether it has any transparency.
 * @param {string} base64
 * @returns {Promise<StampData>}
 */
function decodeStamp(base64) {
  const dataUrl = `data:image/png;base64,${base64}`;
  const bytes = dataUrlToBytes(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, img.naturalWidth);
      const h = Math.max(1, img.naturalHeight);
      let opaque = false;
      try {
        const scale = Math.min(1, 256 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          opaque = !hasTransparentPixel(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        }
      } catch { /* cannot read pixels: do not warn */ }
      resolve({ bytes, dataUrl, aspect: w / h, opaque });
    };
    img.onerror = () => reject(new Error('That stamp is not a readable PNG image.'));
    img.src = dataUrl;
  });
}

/**
 * Format `YYYY-MM-DD` as `MM/DD/YYYY` for the workbook's Date box if it matches `YYYY-MM-DD`.
 * @param {string} ymd
 * @returns {string}
 */
function formatDisplayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(ymd || '').trim();
}

/**
 * Open the Sign & Flatten Workshop modal.
 * Resolves with `{ file, printedName, dateStr }` when the user clicks "Sign & Attach PDF",
 * or `null` if the user cancels/closes the modal.
 *
 * @param {WorkshopOpenOptions} opts
 * @returns {Promise<WorkshopResult | null>}
 */
export async function openSignWorkshop(opts) {
  ensureGoogleScriptFonts();
  const { PDFLib, pdfjsLib } = await ensurePdfLibs();
  const { pdfjsDoc, analysis, pageSizes } = await inspectPdfWithPdfJs(pdfjsLib, opts.pdfBytes);

  const signerIndex = Number(opts.signerIndex) || 0;
  const maxBytes = Number(opts.maxBytes) || MAX_BYTES;
  const defaultName = String(opts.signerName || '').trim();
  const savedSig = loadSavedSignature(defaultName);
  if (savedSig.mode === 'type' && savedSig.typedText) {
    savedSig.pngDataUrl = await renderTypedSignaturePngAsync(savedSig.typedText, savedSig.fontKey);
  }

  // Opens scrolled to the default target: the LAST approval page, else the last scan, else nothing is preselected
  // (-1: the page the member scrolls to is the "current" one; no ordinary Proposal page is ever picked for them).
  const defaultTarget = analysis.defaultTargetPageIndex;
  let currentPageIndex = defaultTarget >= 0 ? defaultTarget : 0;
  const totalPages = analysis.pages.length;
  const pageSizeOf = (/** @type {number} */ i) => pageSizes[i] || { width: 612, height: 792 };

  /** @type {PlacedItem[]} */
  let items = [];
  let nextItemId = 1;
  const newItemId = () => `m${nextItemId++}`;
  /** @type {{ kind: ItemKind, stampId?: string } | null} */
  let armed = null;
  const stampApi = opts.stampApi || null;
  /** @type {Array<{ id: string, name: string, bytes: number }>} */
  let stampList = [];

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ws-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Sign & Flatten Proposal PDF');

    const modal = document.createElement('div');
    modal.className = 'ws-modal';
    backdrop.appendChild(modal);

    const editionLabel = analysis.edition === '2026'
      ? '2026 BSA Workbook'
      : analysis.edition === '2023a'
        ? '2023a BSA Workbook'
        : 'PDF Document';
    const flattenSummaryText = () => {
      const flat = flattenPageIndices(analysis, items);
      const rest = [];
      for (let i = 0; i < totalPages; i++) if (!flat.includes(i)) rest.push(i);
      return rest.length
        ? `Pages ${describePageRanges(flat)} (Proposal pages and pages you mark) will be flattened; pages ${describePageRanges(rest)} stay fillable for Plan & Report.`
        : `All ${totalPages} page(s) in this PDF will have their form fields flattened.`;
    };

    const fontOptionsHtml = SCRIPT_FONTS.map(
      f => `<option value="${f.key}" style="font-family: '${f.family}', cursive; font-size: 1.15rem;">${f.label}</option>`
    ).join('');

    modal.innerHTML = `
      <div class="ws-header">
        <div>
          <h2>Sign &amp; Flatten Proposal in Browser</h2>
          <p class="hint ws-subhead">
            <span class="tag signing">${editionLabel}</span>
            <span id="wsFlattenSummary">${flattenSummaryText()}</span>
          </p>
        </div>
        <button type="button" class="ws-close" aria-label="Close">✕</button>
      </div>
      <div class="ws-body">
        <div class="ws-preview-col">
          <div class="ws-banner warnbox" id="wsBanner" hidden></div>
          <div class="ws-toolbar" id="wsToolbar" role="toolbar" aria-label="Place marks on the page">
            <span class="hint">Place:</span>
            <button type="button" class="ws-place-btn" data-kind="signature">✍ Signature</button>
            <button type="button" class="ws-place-btn" data-kind="name">Printed name</button>
            <button type="button" class="ws-place-btn" data-kind="date">Date</button>
            <span class="ws-split" id="wsStampWrap" hidden>
              <button type="button" class="ws-place-btn" id="wsStampBtn" data-kind="stamp" title="Place the last stamp you used (or pick one)">🔖 Stamp</button><button type="button" class="ws-place-btn ws-split-more" id="wsStampMore" aria-haspopup="true" aria-label="Choose a stamp">▾</button>
            </span>
            <span class="hint" id="wsStampNote"></span>
            <div class="ws-stamp-menu" id="wsStampMenu" hidden></div>
          </div>
          <div class="ws-pagebar" id="wsPageBar"></div>
          <div class="ws-canvas-wrap" id="wsCanvasWrap">
            <div class="ws-doc" id="wsDoc"></div>
          </div>
          <div class="hint ws-drag-hint">
            <span>Click a Place button, then click on a page. Drag a mark to move it, drag its corner to resize, ✕ removes it. Nothing is applied until you click Sign &amp; Attach PDF.</span>
            <button type="button" class="ws-linkbtn" id="wsClearMarks">Remove all marks</button>
          </div>
        </div>
        <div class="ws-controls-col">
          <div class="ws-section" id="wsSecondBanner" hidden></div>

          <div class="ws-section">
            <div class="ws-sec-head">
              <strong>1. Your Signature</strong>
              <div class="ws-tabs" role="tablist">
                <button type="button" class="ws-tab" data-mode="type">Type (Script)</button>
                <button type="button" class="ws-tab" data-mode="draw">Draw</button>
                <button type="button" class="ws-tab" data-mode="upload">Upload Image</button>
              </div>
            </div>

            <div id="wsTabType" class="ws-tab-pane">
              <div class="ws-row">
                <div>
                  <label for="wsTypedSig">Typed signature</label>
                  <input type="text" id="wsTypedSig" autocomplete="off" placeholder="Your signature">
                </div>
                <div>
                  <label for="wsFontSelect">Script font (10 styles)</label>
                  <select id="wsFontSelect" class="ws-font-select">${fontOptionsHtml}</select>
                </div>
              </div>
              <div class="ws-sig-preview-box">
                <img id="wsTypePreviewImg" alt="Typed signature preview">
              </div>
            </div>

            <div id="wsTabDraw" class="ws-tab-pane" hidden>
              <canvas id="wsDrawPad" width="540" height="130" class="ws-draw-pad"></canvas>
              <div class="ws-pad-actions">
                <span class="hint">Sign above with mouse, stylus, or finger.</span>
                <button type="button" class="ws-linkbtn" id="wsClearPadBtn">Clear pad</button>
              </div>
            </div>

            <div id="wsTabUpload" class="ws-tab-pane" hidden>
              <input type="file" id="wsUploadSigInput" accept="image/png,image/jpeg,image/webp">
              <p class="hint">White paper backgrounds are automatically made transparent.</p>
              <div class="ws-sig-preview-box">
                <img id="wsUploadPreviewImg" alt="Uploaded signature preview">
              </div>
            </div>

            <div class="ws-size-row">
              <label for="wsSigScaleRange">Signature size</label>
              <div class="ws-size-controls">
                <button type="button" class="ws-step-btn" id="wsSigSmallerBtn" title="Smaller signature">−</button>
                <input type="range" id="wsSigScaleRange" min="${Math.round(SIG_SCALE_MIN * 100)}" max="${Math.round(SIG_SCALE_MAX * 100)}" step="5" value="100">
                <button type="button" class="ws-step-btn" id="wsSigLargerBtn" title="Larger signature">+</button>
                <span class="ws-size-val" id="wsSigScaleVal">100% (Fit)</span>
                <button type="button" class="ws-linkbtn" id="wsSigFitBtn">Fit</button>
              </div>
            </div>

            <label class="choice">
              <input type="checkbox" id="wsRememberSig">
              <span>Remember my signature &amp; font settings in this browser (<code>localStorage</code>)</span>
            </label>
          </div>

          <div class="ws-section">
            <strong>2. Printed Name &amp; Date</strong>
            <div class="ws-row">
              <div>
                <label for="wsPrintedName">Printed Name</label>
                <input type="text" id="wsPrintedName" autocomplete="off">
              </div>
              <div>
                <label for="wsDateStr">Date</label>
                <input type="text" id="wsDateStr" autocomplete="off" placeholder="MM/DD/YYYY">
              </div>
            </div>
            <div class="ws-size-row">
              <label for="wsTextSizeRange">Text font size</label>
              <div class="ws-size-controls">
                <button type="button" class="ws-step-btn" id="wsTextSmallerBtn" title="Smaller text">−</button>
                <input type="range" id="wsTextSizeRange" min="${TEXT_FONT_MIN_PT}" max="${TEXT_FONT_MAX_PT}" step="0.5" value="10">
                <button type="button" class="ws-step-btn" id="wsTextLargerBtn" title="Larger text">+</button>
                <span class="ws-size-val" id="wsTextSizeVal">Auto (fit field)</span>
                <button type="button" class="ws-linkbtn" id="wsTextAutoBtn">Auto</button>
              </div>
            </div>
          </div>

          <p id="wsStatusMsg" class="hint" role="status"></p>
          <div class="ws-footer-actions">
            <button type="button" class="primary" id="wsApplyBtn">Sign &amp; Attach PDF</button>
            <button type="button" id="wsCancelBtn">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const q = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (modal.querySelector(sel));
    const closeBtn = /** @type {HTMLButtonElement} */ (q('.ws-close'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (q('#wsCancelBtn'));
    const applyBtn = /** @type {HTMLButtonElement} */ (q('#wsApplyBtn'));
    const statusMsg = q('#wsStatusMsg');
    const pageBar = q('#wsPageBar');
    const banner = q('#wsBanner');
    const toolbar = q('#wsToolbar');
    const stampWrap = q('#wsStampWrap');
    const stampBtn = /** @type {HTMLButtonElement} */ (q('#wsStampBtn'));
    const stampMore = /** @type {HTMLButtonElement} */ (q('#wsStampMore'));
    const stampMenu = q('#wsStampMenu');
    const stampNote = q('#wsStampNote');
    const docWrap = q('#wsCanvasWrap');
    const docEl = q('#wsDoc');
    const flattenSummaryEl = q('#wsFlattenSummary');
    const clearMarksBtn = /** @type {HTMLButtonElement} */ (q('#wsClearMarks'));
    const secondBanner = q('#wsSecondBanner');
    const typedSigInput = /** @type {HTMLInputElement} */ (q('#wsTypedSig'));
    const fontSelect = /** @type {HTMLSelectElement} */ (q('#wsFontSelect'));
    const typePreviewImg = /** @type {HTMLImageElement} */ (q('#wsTypePreviewImg'));
    const drawPad = /** @type {HTMLCanvasElement} */ (q('#wsDrawPad'));
    const clearPadBtn = /** @type {HTMLButtonElement} */ (q('#wsClearPadBtn'));
    const uploadSigInput = /** @type {HTMLInputElement} */ (q('#wsUploadSigInput'));
    const uploadPreviewImg = /** @type {HTMLImageElement} */ (q('#wsUploadPreviewImg'));
    const sigScaleRange = /** @type {HTMLInputElement} */ (q('#wsSigScaleRange'));
    const sigSmallerBtn = /** @type {HTMLButtonElement} */ (q('#wsSigSmallerBtn'));
    const sigLargerBtn = /** @type {HTMLButtonElement} */ (q('#wsSigLargerBtn'));
    const sigScaleVal = q('#wsSigScaleVal');
    const sigFitBtn = /** @type {HTMLButtonElement} */ (q('#wsSigFitBtn'));
    const rememberSigCheck = /** @type {HTMLInputElement} */ (q('#wsRememberSig'));
    const printedNameInput = /** @type {HTMLInputElement} */ (q('#wsPrintedName'));
    const dateStrInput = /** @type {HTMLInputElement} */ (q('#wsDateStr'));
    const textSizeRange = /** @type {HTMLInputElement} */ (q('#wsTextSizeRange'));
    const textSmallerBtn = /** @type {HTMLButtonElement} */ (q('#wsTextSmallerBtn'));
    const textLargerBtn = /** @type {HTMLButtonElement} */ (q('#wsTextLargerBtn'));
    const textSizeVal = q('#wsTextSizeVal');
    const textAutoBtn = /** @type {HTMLButtonElement} */ (q('#wsTextAutoBtn'));

    if (signerIndex >= 1) {
      const prev = (opts.existingSignedBy && opts.existingSignedBy.length)
        ? opts.existingSignedBy.join(' & ')
        : 'first signer';
      secondBanner.hidden = false;
      secondBanner.className = 'warnbox';
      secondBanner.textContent = `Adding committee signature #${signerIndex + 1} (already signed by ${prev}). Your signature, printed name, and date are placed below the first signer's line so their marks are untouched.`;
    }

    printedNameInput.value = savedSig.printedName || defaultName;
    dateStrInput.value = formatDisplayDate(opts.dateYmd || '');
    typedSigInput.value = savedSig.typedText || defaultName;
    fontSelect.value = savedSig.fontKey;
    rememberSigCheck.checked = Boolean(savedSig.hasSaved);
    const applyFontSelectPreviewStyle = () => {
      const spec = getFontSpec(fontSelect.value);
      fontSelect.style.fontFamily = `"${spec.family}", cursive`;
    };
    applyFontSelectPreviewStyle();

    // Initialize signature scale and text font size controls
    let signatureScale = savedSig.signatureScale || 1;
    let textFontSize = savedSig.textFontSize || 0;

    function syncSizeControls() {
      const pct = Math.round(signatureScale * 100);
      sigScaleRange.value = String(pct);
      sigScaleVal.textContent = pct === 100 ? '100% (Fit)' : `${pct}%`;

      if (textFontSize <= 0) {
        textSizeRange.value = '10';
        textSizeVal.textContent = 'Auto (fit field)';
      } else {
        textSizeRange.value = String(textFontSize);
        textSizeVal.textContent = `${textFontSize} pt`;
      }
    }
    syncSizeControls();

    let closed = false;
    /** @type {IntersectionObserver | null} */
    let renderObserver = null;
    /** @type {IntersectionObserver | null} */
    let currentObserver = null;
    const onKeyDown = (/** @type {KeyboardEvent} */ ev) => {
      if (ev.key === 'Escape' && !stampMenu.hidden) {
        stampMenu.hidden = true;
        return;
      }
      if (ev.key === 'Escape' && armed) {
        ev.stopPropagation();
        disarm();
        updateValidationState();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    function cleanupAndResolve(/** @type {WorkshopResult | null} */ res) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onDocClick);
      if (renderObserver) renderObserver.disconnect();
      if (currentObserver) currentObserver.disconnect();
      backdrop.remove();
      try { void pdfjsDoc.destroy(); } catch { /* ignore */ }
      resolve(res);
    }

    closeBtn.onclick = () => cleanupAndResolve(null);
    cancelBtn.onclick = () => cleanupAndResolve(null);

    // 1. Banner, jump buttons and the toolbar
    const bannerText = approvalBanner(analysis);
    if (bannerText) {
      banner.hidden = false;
      banner.textContent = bannerText;
    }

    /** @type {HTMLButtonElement[]} */
    const jumpBtns = [];
    function renderPageBar() {
      pageBar.replaceChildren();
      jumpBtns.length = 0;
      const lbl = document.createElement('span');
      lbl.className = 'hint';
      lbl.textContent = defaultTarget >= 0
        ? `Opened at: ${describeTargetPage(analysis, defaultTarget)}. Jump to:`
        : 'Jump to page:';
      pageBar.appendChild(lbl);
      for (let i = 0; i < totalPages; i++) {
        const pg = analysis.pages[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ws-page-btn' +
          (pg.forbidden ? ' locked' : pg.role === 'approval' ? ' approval' : pg.scanCandidate ? ' scan' : '');
        btn.textContent = String(i + 1);
        btn.title = pg.forbidden
          ? `Page ${i + 1}: ${pg.notOursSection || 'Plan / Report'} (locked)`
          : pg.role === 'approval' ? `Page ${i + 1}: Proposal Approval`
            : pg.scanCandidate ? `Page ${i + 1}: looks like a scan` : `Page ${i + 1}`;
        btn.onclick = () => scrollToPage(i);
        pageBar.appendChild(btn);
        jumpBtns.push(btn);
      }
      refreshPageBar();
    }
    function refreshPageBar() {
      jumpBtns.forEach((b, i) => {
        b.classList.toggle('active', i === currentPageIndex);
        b.classList.toggle('marked', items.some(it => it.pageIndex === i));
      });
    }

    const placeBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (toolbar.querySelectorAll('.ws-place-btn'));
    function refreshToolbar() {
      placeBtns.forEach(b => b.classList.toggle('active', !!armed && b.dataset.kind === armed.kind));
      docEl.classList.toggle('armed', !!armed);
    }
    function arm(/** @type {ItemKind} */ kind) {
      armed = { kind };
      refreshToolbar();
      const what = kind === 'signature' ? 'your signature' : kind === 'name' ? 'your printed name' : 'the date';
      setStatus(`Click on the page where ${what} goes (Esc cancels).`, 'hint');
    }
    function disarm() {
      armed = null;
      refreshToolbar();
    }
    function setStatus(/** @type {string} */ msg, /** @type {string} */ cls) {
      statusMsg.textContent = msg;
      statusMsg.className = cls;
    }

    /**
     * A Place button: on a detected approval page the mark starts at the workbook's own box (unless that kind is
     * already there); anywhere else it waits for a click on the page.
     */
    function onPlaceButton(/** @type {ItemKind} */ kind) {
      if (armed && armed.kind === kind) {
        disarm();
        updateValidationState();
        return;
      }
      const cur = currentPageIndex;
      const detected = analysis.approvalPageIndices.includes(cur);
      if (detected && canPlaceOnPage(analysis, cur).ok && !items.some(it => it.kind === kind && it.pageIndex === cur)) {
        const it = defaultItem(kind, analysis.edition, signerIndex, cur, pageSizeOf(cur), newItemId());
        if (it) {
          disarm();
          items.push(it);
          itemsChanged([cur]);
          return;
        }
      }
      arm(kind);
    }
    placeBtns.forEach(b => {
      if (b.dataset.kind && b.dataset.kind !== 'stamp') b.onclick = () => onPlaceButton(/** @type {ItemKind} */ (b.dataset.kind));
    });

    // Stamps (Task 9c): a Drive folder of PNGs; the button places the last one used, the arrow lists them
    const stampLabel = (/** @type {string} */ name) => String(name || '').replace(/\.png$/i, '');
    async function loadStamp(/** @type {string} */ id) {
      let data = stampDataCache.get(id);
      if (!data) {
        if (!stampApi) throw new Error('Stamps are not available.');
        const r = await stampApi.fetch(id);
        data = await decodeStamp(r.data);
        stampDataCache.set(id, data);
      }
      return data;
    }
    function rememberedStampId() {
      try { return localStorage.getItem(STAMP_STORAGE_KEY) || ''; } catch { return ''; }
    }
    async function armStamp(/** @type {string} */ id) {
      stampMenu.hidden = true;
      try { localStorage.setItem(STAMP_STORAGE_KEY, id); } catch { /* ignore */ }
      const name = stampLabel((stampList.find(x => x.id === id) || { name: 'stamp' }).name);
      setStatus(`Loading ${name}…`, 'hint');
      try {
        const data = await loadStamp(id);
        armed = { kind: 'stamp', stampId: id };
        refreshToolbar();
        setStatus(
          (data.opaque ? `${name}: ${STAMP_OPAQUE_WARNING} ` : '') + `Click on the page where the stamp goes (Esc cancels).`,
          data.opaque ? 'hint err' : 'hint'
        );
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), 'hint err');
      }
    }
    async function openStampMenu() {
      if (!stampMenu.hidden) { stampMenu.hidden = true; return; }
      stampMenu.replaceChildren();
      const last = rememberedStampId();
      for (const st of stampList) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ws-stamp-row' + (st.id === last ? ' last' : '');
        const thumb = document.createElement('img');
        thumb.alt = '';
        const nameEl = document.createElement('span');
        nameEl.textContent = stampLabel(st.name);
        row.append(thumb, nameEl);
        row.onclick = () => void armStamp(st.id);
        stampMenu.appendChild(row);
        const cached = stampDataCache.get(st.id);
        if (cached) thumb.src = cached.dataUrl;
        else void loadStamp(st.id).then(d => { thumb.src = d.dataUrl; }).catch(() => { nameEl.textContent += ' (could not load)'; });
      }
      stampMenu.hidden = false;
    }
    stampBtn.onclick = () => {
      if (armed && armed.kind === 'stamp') { disarm(); updateValidationState(); return; }
      const last = rememberedStampId();
      if (last && stampList.some(x => x.id === last)) void armStamp(last); else void openStampMenu();
    };
    stampMore.onclick = () => void openStampMenu();
    const onDocClick = (/** @type {MouseEvent} */ ev) => {
      if (!stampMenu.hidden && !stampWrap.contains(/** @type {Node} */ (ev.target)) && !stampMenu.contains(/** @type {Node} */ (ev.target))) stampMenu.hidden = true;
    };
    document.addEventListener('click', onDocClick);
    async function initStamps() {
      if (!stampApi) return;
      try {
        const r = await stampApi.list();
        if (!r || !r.enabled) return;
        stampList = r.stamps || [];
        stampWrap.hidden = false;
        if (!stampList.length) {
          stampNote.textContent = 'No stamp PNGs in the stamps folder yet.';
          stampBtn.disabled = true;
          stampMore.disabled = true;
        } else if (r.skipped && r.skipped.length) {
          stampNote.textContent = `${r.skipped.length} stamp file(s) over 2 MB were skipped.`;
        }
      } catch (e) {
        stampNote.textContent = `Stamps unavailable: ${e instanceof Error ? e.message : String(e)}`;
        stampNote.className = 'hint err';
      }
    }
    clearMarksBtn.onclick = () => {
      const pagesTouched = [...new Set(items.map(it => it.pageIndex))];
      items = [];
      disarm();
      itemsChanged(pagesTouched);
    };

    // Called after items were added, moved in count or removed: redraw those pages, refresh the summary and checks.
    function itemsChanged(/** @type {number[]} */ pagesTouched) {
      for (const i of pagesTouched) renderPageItems(i);
      refreshPageBar();
      flattenSummaryEl.textContent = flattenSummaryText();
      updateValidationState();
    }

    // 2. Signature tabs (Type / Draw / Upload) & sizing
    const tabBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (modal.querySelectorAll('.ws-tab'));
    async function setSigMode(/** @type {'type' | 'draw' | 'upload'} */ mode) {
      savedSig.mode = mode;
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      q('#wsTabType').hidden = mode !== 'type';
      q('#wsTabDraw').hidden = mode !== 'draw';
      q('#wsTabUpload').hidden = mode !== 'upload';
      if (mode === 'type') {
        savedSig.pngDataUrl = await renderTypedSignaturePngAsync(typedSigInput.value, fontSelect.value);
        typePreviewImg.src = savedSig.pngDataUrl || '';
      }
      renderOverlayBoxes();
      updateValidationState();
    }
    tabBtns.forEach(b => {
      b.onclick = () => void setSigMode(/** @type {'type' | 'draw' | 'upload'} */ (b.dataset.mode || 'type'));
    });

    async function updateTypedSig() {
      savedSig.typedText = typedSigInput.value;
      savedSig.fontKey = normalizeFontKey(fontSelect.value);
      applyFontSelectPreviewStyle();
      savedSig.pngDataUrl = await renderTypedSignaturePngAsync(savedSig.typedText, savedSig.fontKey);
      typePreviewImg.src = savedSig.pngDataUrl || '';
      renderOverlayBoxes();
      updateValidationState();
    }
    typedSigInput.oninput = () => void updateTypedSig();
    fontSelect.onchange = () => void updateTypedSig();

    // Signature size controls
    function setSignatureScale(/** @type {number} */ nextScale) {
      signatureScale = Math.max(SIG_SCALE_MIN, Math.min(SIG_SCALE_MAX, Math.round(nextScale * 20) / 20));
      savedSig.signatureScale = signatureScale;
      syncSizeControls();
      renderOverlayBoxes();
    }
    sigScaleRange.oninput = () => setSignatureScale(Number(sigScaleRange.value) / 100);
    sigSmallerBtn.onclick = () => setSignatureScale(signatureScale - 0.1);
    sigLargerBtn.onclick = () => setSignatureScale(signatureScale + 0.1);
    sigFitBtn.onclick = () => setSignatureScale(1);

    // Text font size controls
    function setTextFontSize(/** @type {number} */ nextPt) {
      if (nextPt <= 0) {
        textFontSize = 0;
      } else {
        textFontSize = Math.max(TEXT_FONT_MIN_PT, Math.min(TEXT_FONT_MAX_PT, Math.round(nextPt * 2) / 2));
      }
      savedSig.textFontSize = textFontSize;
      syncSizeControls();
      renderOverlayBoxes();
    }
    textSizeRange.oninput = () => setTextFontSize(Number(textSizeRange.value));
    textSmallerBtn.onclick = () => setTextFontSize((textFontSize || 10) - 0.5);
    textLargerBtn.onclick = () => setTextFontSize((textFontSize || 10) + 0.5);
    textAutoBtn.onclick = () => setTextFontSize(0);

    // Draw pad setup
    const padCtx = drawPad.getContext('2d');
    let drawing = false;
    let hasDrawnStrokes = false;
    if (padCtx) {
      padCtx.strokeStyle = '#0f296b';
      padCtx.lineWidth = 3.2;
      padCtx.lineCap = 'round';
      padCtx.lineJoin = 'round';
    }
    function padCoords(/** @type {PointerEvent} */ ev) {
      const r = drawPad.getBoundingClientRect();
      return {
        x: ((ev.clientX - r.left) / Math.max(1, r.width)) * drawPad.width,
        y: ((ev.clientY - r.top) / Math.max(1, r.height)) * drawPad.height
      };
    }
    drawPad.addEventListener('pointerdown', ev => {
      if (!padCtx) return;
      drawing = true;
      hasDrawnStrokes = true;
      drawPad.setPointerCapture(ev.pointerId);
      const pt = padCoords(ev);
      padCtx.beginPath();
      padCtx.moveTo(pt.x, pt.y);
    });
    drawPad.addEventListener('pointermove', ev => {
      if (!drawing || !padCtx) return;
      const pt = padCoords(ev);
      padCtx.lineTo(pt.x, pt.y);
      padCtx.stroke();
    });
    const finishStroke = () => {
      if (!drawing) return;
      drawing = false;
      if (hasDrawnStrokes) {
        savedSig.pngDataUrl = drawPad.toDataURL('image/png');
        renderOverlayBoxes();
        updateValidationState();
      }
    };
    drawPad.addEventListener('pointerup', finishStroke);
    drawPad.addEventListener('pointercancel', finishStroke);
    clearPadBtn.onclick = () => {
      if (!padCtx) return;
      padCtx.clearRect(0, 0, drawPad.width, drawPad.height);
      hasDrawnStrokes = false;
      savedSig.pngDataUrl = '';
      renderOverlayBoxes();
      updateValidationState();
    };

    uploadSigInput.onchange = async () => {
      const f = uploadSigInput.files && uploadSigInput.files[0];
      if (!f) return;
      try {
        savedSig.pngDataUrl = await imageFileToTransparentPng(f);
        uploadPreviewImg.src = savedSig.pngDataUrl;
        renderOverlayBoxes();
        updateValidationState();
      } catch (e) {
        statusMsg.textContent = e instanceof Error ? e.message : String(e);
        statusMsg.className = 'hint err';
      }
    };

    printedNameInput.oninput = () => {
      savedSig.printedName = printedNameInput.value;
      renderOverlayBoxes();
      updateValidationState();
    };
    dateStrInput.oninput = () => {
      renderOverlayBoxes();
      updateValidationState();
    };

    // 3. The document: one fixed-size box per page; canvases are rendered lazily; marks live in a per-page overlay
    function computeScale() {
      const maxW = Math.max(...pageSizes.map(p => p.width), 612);
      const avail = (docWrap.clientWidth || 720) - 28;
      return Math.max(0.5, Math.min(1.3, avail / maxW));
    }
    const cssScale = computeScale();

    /** @type {Array<{ wrap: HTMLElement, canvas: HTMLCanvasElement, overlay: HTMLElement, rendered: boolean, rendering: boolean, want: boolean }>} */
    const pageEls = [];
    for (let i = 0; i < totalPages; i++) {
      const ps = pageSizeOf(i);
      const pg = analysis.pages[i];
      const wrap = document.createElement('div');
      wrap.className = 'ws-page' + (pg.forbidden ? ' locked' : '');
      wrap.dataset.page = String(i);
      wrap.style.width = `${Math.round(ps.width * cssScale)}px`;
      wrap.style.height = `${Math.round(ps.height * cssScale)}px`;
      const label = document.createElement('span');
      label.className = 'ws-page-label';
      label.textContent = pg.forbidden
        ? `Page ${i + 1} · ${pg.notOursSection || 'Plan / Report'} (locked)`
        : `Page ${i + 1}` + (pg.role === 'approval' ? ' · Proposal Approval' : pg.scanCandidate ? ' · scan?' : '');
      const canvas = document.createElement('canvas');
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const overlay = document.createElement('div');
      overlay.className = 'ws-overlay';
      wrap.append(canvas, overlay, label);
      docEl.appendChild(wrap);
      pageEls.push({ wrap, canvas, overlay, rendered: false, rendering: false, want: false });
      wrap.addEventListener('click', ev => onPageClick(i, ev));
    }

    function scrollToPage(/** @type {number} */ i) {
      const el = pageEls[i];
      if (!el) return;
      docWrap.scrollTop = Math.max(0, el.wrap.offsetTop - 8);
      setCurrentPage(i);
    }
    function setCurrentPage(/** @type {number} */ i) {
      if (i === currentPageIndex) return;
      currentPageIndex = i;
      refreshPageBar();
    }

    // Click-to-place: the point is converted from the click on the page box to PDF points (bottom-left origin).
    function onPageClick(/** @type {number} */ i, /** @type {MouseEvent} */ ev) {
      if (!armed) return;
      const target = /** @type {HTMLElement} */ (ev.target);
      if (target.closest && target.closest('.ws-place-box')) return;
      const chk = canPlaceOnPage(analysis, i);
      if (!chk.ok) {
        setStatus(chk.reason, 'hint err');
        return;
      }
      const ps = pageSizeOf(i);
      const r = pageEls[i].wrap.getBoundingClientRect();
      const point = {
        x: ((ev.clientX - r.left) / Math.max(1, r.width)) * ps.width,
        y: ps.height - ((ev.clientY - r.top) / Math.max(1, r.height)) * ps.height
      };
      const stampData = armed.stampId ? stampDataCache.get(armed.stampId) : undefined;
      items.push(newItemAtPoint(armed.kind, i, point, ps, { id: newItemId(), stampId: armed.stampId, aspect: stampData ? stampData.aspect : 0 }));
      disarm();
      itemsChanged([i]);
    }

    function renderOverlayBoxes() { renderAllItems(); }
    function renderAllItems() {
      const touched = new Set(items.map(it => it.pageIndex));
      pageEls.forEach((_, i) => { if (touched.has(i) || pageEls[i].overlay.childElementCount) renderPageItems(i); });
    }

    // Marks on one page: drag-to-move, bottom-right corner resize, ✕ to remove
    function renderPageItems(/** @type {number} */ pageIndex) {
      const pe = pageEls[pageIndex];
      if (!pe) return;
      const ps = pageSizeOf(pageIndex);
      pe.overlay.replaceChildren();
      const labels = /** @type {Record<ItemKind, string>} */ ({ signature: 'Signature', name: 'Printed Name', date: 'Date', stamp: 'Stamp' });

      for (const box of items.filter(it => it.pageIndex === pageIndex)) {
        const label = labels[box.kind];
        const elBox = document.createElement('div');
        elBox.className = `ws-place-box ws-place-${box.kind}`;
        elBox.title = `Drag to move the ${label.toLowerCase()}, or drag the bottom-right corner to resize`;

        const applyBoxGeometry = () => {
          elBox.style.left = `${(box.x / ps.width) * 100}%`;
          elBox.style.top = `${((ps.height - box.y - box.height) / ps.height) * 100}%`;
          elBox.style.width = `${(box.width / ps.width) * 100}%`;
          elBox.style.height = `${(box.height / ps.height) * 100}%`;
        };
        applyBoxGeometry();

        const contentSpan = document.createElement('span');
        contentSpan.className = 'ws-place-content';
        const applyContentStyle = () => {
          if (box.kind === 'signature') {
            contentSpan.replaceChildren();
            if (savedSig.pngDataUrl) {
              const img = document.createElement('img');
              img.src = savedSig.pngDataUrl;
              img.alt = 'Signature';
              img.style.transform = `scale(${signatureScale})`;
              contentSpan.appendChild(img);
            } else {
              contentSpan.textContent = 'Signature';
            }
          } else if (box.kind === 'stamp') {
            contentSpan.replaceChildren();
            const sd = box.stampId ? stampDataCache.get(box.stampId) : undefined;
            if (sd) {
              const img = document.createElement('img');
              img.src = sd.dataUrl;
              img.alt = 'Stamp';
              contentSpan.appendChild(img);
            } else {
              contentSpan.textContent = 'Stamp';
            }
          } else if (box.kind === 'name' || box.kind === 'date') {
            const txt = box.kind === 'date'
              ? (dateStrInput.value || 'Date')
              : (printedNameInput.value || 'Printed Name');
            contentSpan.textContent = txt;
            const ptSize = fitTextFontSize(txt, box.width, box.height, textFontSize);
            contentSpan.style.fontSize = `${Math.max(9, Math.round(ptSize * cssScale * 10) / 10)}px`;
          }
        };
        applyContentStyle();
        elBox.appendChild(contentSpan);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ws-item-x';
        remove.textContent = '✕';
        remove.title = `Remove the ${label.toLowerCase()}`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('pointerdown', ev => ev.stopPropagation());
        remove.addEventListener('click', ev => {
          ev.stopPropagation();
          items = items.filter(it => it !== box);
          itemsChanged([pageIndex]);
        });
        elBox.appendChild(remove);

        const handle = document.createElement('span');
        handle.className = 'ws-resize-handle';
        handle.title = `Drag corner to resize the ${label.toLowerCase()}`;
        elBox.appendChild(handle);

        handle.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          handle.setPointerCapture(ev.pointerId);
          const stageRect = pe.overlay.getBoundingClientRect();
          const startX = ev.clientX;
          const startY = ev.clientY;
          const origBox = { ...box };
          const onResizeMove = (/** @type {PointerEvent} */ mv) => {
            const dxPt = ((mv.clientX - startX) / Math.max(1, stageRect.width)) * ps.width;
            const dyPt = ((mv.clientY - startY) / Math.max(1, stageRect.height)) * ps.height;
            const resized = resizeBoxInPage(origBox, dxPt, dyPt, ps, {
              minWidth: box.kind === 'date' ? 36 : 54,
              minHeight: box.kind === 'signature' ? 14 : 10
            });
            box.x = resized.x;
            box.y = resized.y;
            box.width = resized.width;
            box.height = resized.height;
            applyBoxGeometry();
            applyContentStyle();
          };
          const onResizeUp = () => {
            handle.removeEventListener('pointermove', onResizeMove);
            handle.removeEventListener('pointerup', onResizeUp);
            handle.removeEventListener('pointercancel', onResizeUp);
          };
          handle.addEventListener('pointermove', onResizeMove);
          handle.addEventListener('pointerup', onResizeUp);
          handle.addEventListener('pointercancel', onResizeUp);
        });

        elBox.addEventListener('pointerdown', ev => {
          if (ev.target === handle || ev.target === remove) return;
          ev.preventDefault();
          elBox.setPointerCapture(ev.pointerId);
          const stageRect = pe.overlay.getBoundingClientRect();
          const startX = ev.clientX;
          const startY = ev.clientY;
          const origX = box.x;
          const origY = box.y;
          const onMove = (/** @type {PointerEvent} */ mv) => {
            const dxPt = ((mv.clientX - startX) / Math.max(1, stageRect.width)) * ps.width;
            const dyPt = ((mv.clientY - startY) / Math.max(1, stageRect.height)) * ps.height;
            box.x = Math.max(0, Math.min(ps.width - box.width, Math.round((origX + dxPt) * 10) / 10));
            box.y = Math.max(0, Math.min(ps.height - box.height, Math.round((origY - dyPt) * 10) / 10));
            applyBoxGeometry();
          };
          const onUp = () => {
            elBox.removeEventListener('pointermove', onMove);
            elBox.removeEventListener('pointerup', onUp);
            elBox.removeEventListener('pointercancel', onUp);
          };
          elBox.addEventListener('pointermove', onMove);
          elBox.addEventListener('pointerup', onUp);
          elBox.addEventListener('pointercancel', onUp);
        });

        pe.overlay.appendChild(elBox);
      }
    }

    // 4. Lazy rendering: only pages near the viewport hold a canvas; far pages release theirs (Safari memory)
    let renderChain = Promise.resolve();
    function requestRender(/** @type {number} */ i) {
      const pe = pageEls[i];
      pe.want = true;
      if (pe.rendered || pe.rendering) return;
      pe.rendering = true;
      renderChain = renderChain.then(async () => {
        if (!pe.want || closed) { pe.rendering = false; return; }
        try {
          const page = await pdfjsDoc.getPage(i + 1);
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const vpRender = page.getViewport({ scale: cssScale * dpr });
          pe.canvas.width = Math.round(vpRender.width);
          pe.canvas.height = Math.round(vpRender.height);
          const ctx = pe.canvas.getContext('2d');
          if (ctx) await page.render({ canvasContext: ctx, viewport: vpRender }).promise;
          pe.rendered = true;
          if (!pe.want) releaseCanvas(i);
        } catch {
          /* leave blank; scrolling away and back retries */
        } finally {
          pe.rendering = false;
        }
      });
    }
    function releaseCanvas(/** @type {number} */ i) {
      const pe = pageEls[i];
      pe.want = false;
      if (pe.rendered) {
        pe.canvas.width = 0;
        pe.canvas.height = 0;
        pe.rendered = false;
      }
    }
    if (typeof IntersectionObserver === 'function') {
      renderObserver = new IntersectionObserver(entries => {
        for (const en of entries) {
          const i = Number(/** @type {HTMLElement} */ (en.target).dataset.page);
          if (en.isIntersecting) requestRender(i); else releaseCanvas(i);
        }
      }, { root: docWrap, rootMargin: '900px 0px' });
      // The "current" page (for the Place buttons) is the one most visible in the scroll view.
      /** @type {Map<number, number>} */
      const ratios = new Map();
      currentObserver = new IntersectionObserver(entries => {
        for (const en of entries) ratios.set(Number(/** @type {HTMLElement} */ (en.target).dataset.page), en.intersectionRatio);
        let best = -1;
        let bestRatio = 0;
        ratios.forEach((r, i) => { if (r > bestRatio + 1e-6 || (Math.abs(r - bestRatio) < 1e-6 && i < best)) { best = i; bestRatio = r; } });
        if (best >= 0) setCurrentPage(best);
      }, { root: docWrap, threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
      pageEls.forEach(pe => { renderObserver && renderObserver.observe(pe.wrap); currentObserver && currentObserver.observe(pe.wrap); });
    } else {
      // Very old browsers: render the page we opened at and its neighbours.
      [currentPageIndex - 1, currentPageIndex, currentPageIndex + 1].filter(i => i >= 0 && i < totalPages).forEach(requestRender);
    }

    // 5. Validation state
    function updateValidationState() {
      const check = checkPlacement(analysis, items, {
        signaturePresent: !!savedSig.pngDataUrl,
        printedName: printedNameInput.value,
        dateStr: dateStrInput.value
      });
      if (check.errors.length) {
        applyBtn.disabled = true;
        if (!armed) setStatus(check.errors[0], 'hint');
        return;
      }
      applyBtn.disabled = false;
      if (armed) return;
      const pagesMarked = [...new Set(items.map(it => it.pageIndex))].sort((a, b) => a - b);
      const warnings = [...check.warnings];
      const opaqueNames = [...new Set(items
        .filter(it => it.kind === 'stamp' && it.stampId && (stampDataCache.get(it.stampId) || { opaque: false }).opaque)
        .map(it => stampLabel((stampList.find(x => x.id === it.stampId) || { name: 'A stamp' }).name)))];
      for (const n of opaqueNames) warnings.push(`${n}: ${STAMP_OPAQUE_WARNING}`);
      setStatus(
        `Ready: ${items.length} mark${items.length === 1 ? '' : 's'} on page${pagesMarked.length === 1 ? '' : 's'} ${describePageRanges(pagesMarked)}.` +
          (warnings.length ? ' ' + warnings.join(' ') : ''),
        warnings.length ? 'hint' : 'hint ok'
      );
    }

    // 6. Apply: draw every placed mark, flatten the Proposal pages and the marked pages
    applyBtn.onclick = async () => {
      applyBtn.disabled = true;
      setStatus('Signing and flattening Proposal fields…', 'hint');
      try {
        if (savedSig.mode === 'type') {
          savedSig.pngDataUrl = await renderTypedSignaturePngAsync(typedSigInput.value, fontSelect.value);
        }
        if (rememberSigCheck.checked) {
          saveSignatureToStorage({
            mode: savedSig.mode,
            typedText: typedSigInput.value,
            fontKey: normalizeFontKey(fontSelect.value),
            pngDataUrl: savedSig.pngDataUrl,
            printedName: printedNameInput.value.trim(),
            signatureScale,
            textFontSize
          });
        } else {
          try { localStorage.removeItem(SIG_STORAGE_KEY); } catch {}
        }

        const sigBytes = dataUrlToBytes(savedSig.pngDataUrl);
        /** @type {Record<string, Uint8Array>} */
        const stampPngs = {};
        for (const it of items) {
          if (it.kind === 'stamp' && it.stampId && !stampPngs[it.stampId]) stampPngs[it.stampId] = (await loadStamp(it.stampId)).bytes;
        }
        const res = await applyPlacedItemsAndFlatten(PDFLib, {
          pdfBytes: opts.pdfBytes,
          analysis,
          items,
          signerIndex,
          signaturePngBytes: sigBytes,
          printedName: printedNameInput.value.trim(),
          dateStr: dateStrInput.value.trim(),
          signatureScale,
          textFontSize,
          stampPngs
        });

        if (res.pdfBytes.byteLength > maxBytes) {
          const mb = (res.pdfBytes.byteLength / 1024 / 1024).toFixed(1);
          throw new Error(`Signed PDF is ${mb} MB, which exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB upload limit.`);
        }

        const outName = opts.fileName.replace(/\.pdf$/i, '') + '-signed.pdf';
        const outBlob = new Blob([res.pdfBytes.slice()], { type: 'application/pdf' });
        const outFile = new File([outBlob], outName, { type: 'application/pdf' });
        cleanupAndResolve({
          file: outFile,
          printedName: printedNameInput.value.trim(),
          dateStr: dateStrInput.value.trim()
        });
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), 'hint err');
        applyBtn.disabled = false;
      }
    };

    // Initialize UI
    renderPageBar();
    refreshToolbar();
    void initStamps();
    if (savedSig.mode === 'upload' && savedSig.pngDataUrl) {
      uploadPreviewImg.src = savedSig.pngDataUrl;
    }
    void setSigMode(savedSig.mode === 'upload' && savedSig.pngDataUrl ? 'upload' : 'type');
    updateValidationState();
    // Open scrolled to the default target (the last approval page, else the last scan); otherwise at the top.
    if (defaultTarget >= 0) {
      requestAnimationFrame(() => scrollToPage(defaultTarget));
    }
  });
}
