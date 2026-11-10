// @ts-check
/**
 * In-Browser PDF Sign & Flatten Workshop modal for `/committee/review` (Jim W., 2026-11-09).
 *
 * Lazy-loads `pdf-lib` and `pdf.js` from `cdn.jsdelivr.net` (and the 10 OFL Google Script Fonts stylesheet) only when
 * a committee member opens the Sign Workshop. Manages the member's signature in `localStorage` (Type in 10 script fonts
 * at 3x DPI, Draw on canvas, or Upload with white background made transparent), supports signature & text sizing plus
 * drag-to-move and corner drag-to-resize on the page preview, defaults to the LAST Proposal Approval page when multiple
 * copies exist, stamps in vector, and flattens form fields ONLY on the Proposal pages (`1..proposalEndPage`).
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
  canSignPage,
  describeTargetPage,
  fitTextFontSize,
  fitSignatureDimensions,
  resizeBoxInPage,
  defaultSignPlacement
} from './pdfPlan.js';

import { CDN_SCRIPTS } from './cdnIntegrity.js';

import {
  inspectPdfWithPdfJs,
  applySignatureAndFlatten
} from './pdfEngine.js';

/**
 * @typedef {import('./pdfPlan.js').WorkbookAnalysis} WorkbookAnalysis
 * @typedef {import('./pdfPlan.js').SignPlacement} SignPlacement
 * @typedef {import('./pdfPlan.js').BoxPlacement} BoxPlacement
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
 * Format `YYYY-MM-DD` as `MM/DD/YYYY` for the workbook's Date box if it matches `YYYY-MM-DD`.
 * @param {string} ymd
 * @returns {string}
 */
function formatDisplayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(ymd || '').trim();
}

/**
 * Clone a `SignPlacement` object.
 * @param {SignPlacement} p
 * @returns {SignPlacement}
 */
function clonePlacement(p) {
  return {
    signature: { ...p.signature },
    date: { ...p.date },
    printedName: { ...p.printedName }
  };
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

  // Pick initial page: defaultTargetPageIndex (which targets the LAST Proposal Approval page when multiple exist)
  let activePageIndex = analysis.defaultTargetPageIndex;
  if (!canSignPage(analysis, activePageIndex).ok) {
    const firstValid = analysis.pages.find(p => canSignPage(analysis, p.pageIndex).ok);
    if (firstValid) activePageIndex = firstValid.pageIndex;
  }

  const activePageSize = () => pageSizes[activePageIndex] || { width: 612, height: 792 };
  let placement = clonePlacement(defaultSignPlacement(analysis.edition, signerIndex, activePageSize()));

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
    const flattenEndPageNum = Math.max(activePageIndex, analysis.proposalEndPageIndex) + 1;
    const totalPages = analysis.pages.length;
    const flattenSummary = flattenEndPageNum < totalPages
      ? `Proposal pages 1–${flattenEndPageNum} will be flattened; pages ${flattenEndPageNum + 1}–${totalPages} stay fillable for Plan & Report.`
      : `All ${totalPages} page(s) in this Proposal PDF will have their form fields flattened.`;

    const fontOptionsHtml = SCRIPT_FONTS.map(
      f => `<option value="${f.key}" style="font-family: '${f.family}', cursive; font-size: 1.15rem;">${f.label}</option>`
    ).join('');

    modal.innerHTML = `
      <div class="ws-header">
        <div>
          <h2>Sign &amp; Flatten Proposal in Browser</h2>
          <p class="hint ws-subhead">
            <span class="tag signing">${editionLabel}</span>
            <span id="wsFlattenSummary">${flattenSummary}</span>
          </p>
        </div>
        <button type="button" class="ws-close" aria-label="Close">✕</button>
      </div>
      <div class="ws-body">
        <div class="ws-preview-col">
          <div class="ws-pagebar" id="wsPageBar"></div>
          <div class="ws-canvas-wrap" id="wsCanvasWrap">
            <div class="ws-stage" id="wsStage">
              <canvas id="wsPageCanvas"></canvas>
              <div class="ws-overlay" id="wsOverlay"></div>
            </div>
          </div>
          <div class="hint ws-drag-hint">
            <span>Tip: Drag the Signature, Date, or Printed Name boxes to move them, or drag a corner handle to resize.</span>
            <button type="button" class="ws-linkbtn" id="wsResetPos">Reset default position &amp; size</button>
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
    const pageCanvas = /** @type {HTMLCanvasElement} */ (q('#wsPageCanvas'));
    const overlay = q('#wsOverlay');
    const stage = q('#wsStage');
    const resetPosBtn = /** @type {HTMLButtonElement} */ (q('#wsResetPos'));
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
    function cleanupAndResolve(/** @type {WorkshopResult | null} */ res) {
      if (closed) return;
      closed = true;
      backdrop.remove();
      resolve(res);
    }

    closeBtn.onclick = () => cleanupAndResolve(null);
    cancelBtn.onclick = () => cleanupAndResolve(null);

    // 1. Build page selector bar (defaults to the LAST approval page when multiple exist)
    function renderPageBar() {
      pageBar.replaceChildren();
      const targetDesc = describeTargetPage(analysis, activePageIndex);
      const info = document.createElement('span');
      info.className = 'ws-page-pill active';
      info.textContent = `Signing: ${targetDesc}`;
      pageBar.appendChild(info);

      if (analysis.approvalPageIndices.length > 1) {
        const switchWrap = document.createElement('span');
        switchWrap.className = 'ws-page-switch';
        const lbl = document.createElement('span');
        lbl.className = 'hint';
        lbl.textContent = 'Switch approval page:';
        switchWrap.appendChild(lbl);

        analysis.approvalPageIndices.forEach((idx, pos) => {
          const isLast = pos === analysis.approvalPageIndices.length - 1;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ws-page-btn' + (idx === activePageIndex ? ' active' : '');
          btn.textContent = isLast ? `Page ${idx + 1} (last)` : `Page ${idx + 1}`;
          btn.onclick = () => {
            if (!canSignPage(analysis, idx).ok) return;
            activePageIndex = idx;
            placement = clonePlacement(defaultSignPlacement(analysis.edition, signerIndex, activePageSize()));
            renderPageBar();
            updateValidationState();
            void renderPdfPage();
          };
          switchWrap.appendChild(btn);
        });
        pageBar.appendChild(switchWrap);
      } else if (analysis.approvalPageIndices.length === 0) {
        const candidates = analysis.pages.filter(p => !p.forbidden).map(p => p.pageIndex);
        for (const idx of candidates) {
          const check = canSignPage(analysis, idx);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ws-page-btn' + (idx === activePageIndex ? ' active' : '');
          btn.textContent = `Page ${idx + 1}`;
          btn.disabled = !check.ok;
          btn.onclick = () => {
            if (!canSignPage(analysis, idx).ok) return;
            activePageIndex = idx;
            placement = clonePlacement(defaultSignPlacement(analysis.edition, signerIndex, activePageSize()));
            renderPageBar();
            updateValidationState();
            void renderPdfPage();
          };
          pageBar.appendChild(btn);
        }
      }

      if (analysis.firstNotOursPageIndex < totalPages) {
        const guardNote = document.createElement('span');
        guardNote.className = 'hint';
        guardNote.textContent = ` (Pages ${analysis.firstNotOursPageIndex + 1}–${totalPages} are Plan/Report — locked against Proposal signing)`;
        pageBar.appendChild(guardNote);
      }
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

    resetPosBtn.onclick = () => {
      placement = clonePlacement(defaultSignPlacement(analysis.edition, signerIndex, activePageSize()));
      setSignatureScale(1);
      setTextFontSize(0);
    };

    // 3. Interactive overlay boxes (Signature, Date, Printed Name) with drag-to-move AND corner drag-to-resize
    function renderOverlayBoxes() {
      overlay.replaceChildren();
      const ps = activePageSize();
      const stageWidthPx = stage.clientWidth || 700;
      const pxPerPt = stageWidthPx / Math.max(1, ps.width);

      const items = /** @type {Array<{ key: keyof SignPlacement, label: string }>} */ ([
        { key: 'signature', label: 'Signature' },
        { key: 'date', label: 'Date' },
        { key: 'printedName', label: 'Printed Name' }
      ]);

      for (const item of items) {
        const box = placement[item.key];
        const elBox = document.createElement('div');
        elBox.className = `ws-place-box ws-place-${item.key}`;
        elBox.title = `Drag to move ${item.label}, or drag the bottom-right corner to resize`;

        const applyBoxGeometry = () => {
          const leftPct = (box.x / ps.width) * 100;
          const topPct = ((ps.height - box.y - box.height) / ps.height) * 100;
          const widthPct = (box.width / ps.width) * 100;
          const heightPct = (box.height / ps.height) * 100;
          elBox.style.left = `${leftPct}%`;
          elBox.style.top = `${topPct}%`;
          elBox.style.width = `${widthPct}%`;
          elBox.style.height = `${heightPct}%`;
        };
        applyBoxGeometry();

        const contentSpan = document.createElement('span');
        contentSpan.className = 'ws-place-content';

        const applyContentStyle = () => {
          if (item.key === 'signature') {
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
          } else {
            const txt = item.key === 'date'
              ? (dateStrInput.value || 'Date')
              : (printedNameInput.value || 'Printed Name');
            contentSpan.textContent = txt;
            const ptSize = fitTextFontSize(txt, box.width, box.height, textFontSize);
            contentSpan.style.fontSize = `${Math.max(9, Math.round(ptSize * pxPerPt * 10) / 10)}px`;
          }
        };
        applyContentStyle();
        elBox.appendChild(contentSpan);

        // Bottom-right corner resize handle
        const handle = document.createElement('span');
        handle.className = 'ws-resize-handle';
        handle.title = `Drag corner to resize ${item.label}`;
        elBox.appendChild(handle);

        handle.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          handle.setPointerCapture(ev.pointerId);
          const stageRect = overlay.getBoundingClientRect();
          const startX = ev.clientX;
          const startY = ev.clientY;
          const origBox = { ...box };

          const onResizeMove = (/** @type {PointerEvent} */ mv) => {
            const dxPt = ((mv.clientX - startX) / Math.max(1, stageRect.width)) * ps.width;
            const dyPt = ((mv.clientY - startY) / Math.max(1, stageRect.height)) * ps.height;
            const resized = resizeBoxInPage(origBox, dxPt, dyPt, ps, {
              minWidth: item.key === 'date' ? 36 : 54,
              minHeight: item.key === 'signature' ? 14 : 10
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

        // Pointer drag-to-move handler on the box itself
        elBox.addEventListener('pointerdown', ev => {
          if (ev.target === handle) return;
          ev.preventDefault();
          elBox.setPointerCapture(ev.pointerId);
          const stageRect = overlay.getBoundingClientRect();
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

        overlay.appendChild(elBox);
      }
    }

    // 4. Render the active PDF page onto `wsPageCanvas`
    async function renderPdfPage() {
      const page = await pdfjsDoc.getPage(activePageIndex + 1);
      const cssScale = 1.15;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vpCss = page.getViewport({ scale: cssScale });
      const vpRender = page.getViewport({ scale: cssScale * dpr });

      pageCanvas.width = Math.round(vpRender.width);
      pageCanvas.height = Math.round(vpRender.height);
      pageCanvas.style.width = `${Math.round(vpCss.width)}px`;
      pageCanvas.style.height = `${Math.round(vpCss.height)}px`;
      stage.style.width = `${Math.round(vpCss.width)}px`;
      stage.style.height = `${Math.round(vpCss.height)}px`;

      const ctx = pageCanvas.getContext('2d');
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport: vpRender }).promise;
      }
      renderOverlayBoxes();
    }

    // 5. Validation state
    function updateValidationState() {
      const pageOk = canSignPage(analysis, activePageIndex);
      if (!pageOk.ok) {
        applyBtn.disabled = true;
        statusMsg.textContent = pageOk.reason;
        statusMsg.className = 'hint err';
        return;
      }
      if (!savedSig.pngDataUrl) {
        applyBtn.disabled = true;
        statusMsg.textContent = 'Create or upload your signature in Section 1.';
        statusMsg.className = 'hint';
        return;
      }
      if (!printedNameInput.value.trim()) {
        applyBtn.disabled = true;
        statusMsg.textContent = 'Enter your printed name in Section 2.';
        statusMsg.className = 'hint';
        return;
      }
      if (!dateStrInput.value.trim()) {
        applyBtn.disabled = true;
        statusMsg.textContent = 'Enter the approval date in Section 2.';
        statusMsg.className = 'hint';
        return;
      }
      applyBtn.disabled = false;
      statusMsg.textContent = `Ready to sign ${describeTargetPage(analysis, activePageIndex)} and flatten Proposal fields.`;
      statusMsg.className = 'hint ok';
    }

    // 6. Apply Signature & Flatten Proposal
    applyBtn.onclick = async () => {
      applyBtn.disabled = true;
      statusMsg.textContent = 'Signing and flattening Proposal fields…';
      statusMsg.className = 'hint';
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
        const res = await applySignatureAndFlatten(PDFLib, {
          pdfBytes: opts.pdfBytes,
          analysis,
          pageIndex: activePageIndex,
          signerIndex,
          signaturePngBytes: sigBytes,
          printedName: printedNameInput.value.trim(),
          dateStr: dateStrInput.value.trim(),
          signatureScale,
          textFontSize,
          placement
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
        statusMsg.textContent = e instanceof Error ? e.message : String(e);
        statusMsg.className = 'hint err';
        applyBtn.disabled = false;
      }
    };

    // Initialize UI
    renderPageBar();
    if (savedSig.mode === 'upload' && savedSig.pngDataUrl) {
      uploadPreviewImg.src = savedSig.pngDataUrl;
    }
    void setSigMode(savedSig.mode === 'upload' && savedSig.pngDataUrl ? 'upload' : 'type');
    void renderPdfPage();
  });
}
