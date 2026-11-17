// @ts-check
/**
 * A photo of the signed Requirement 7 page replaces that page of the Verified Eagle Application (Jim W., 2026-11-17;
 * step 2 of the phone work). Boards that sign on paper take a picture (a phone's document scanner is best: it crops
 * and straightens), turn it upright, trim the edges, and the tool builds the signed application from the Verified one:
 * every page as it was, the Requirement 7 page swapped for the photo. Council accepts a clear photo or scan.
 *
 * Pure helpers (tested in node) + the small editor (rotate, crop by dragging the corners) used by /committee/eagle.
 */
import { loadPdfWithDecrypt } from './pdfEngine.js';
import { decodeUpright } from './photos.js';

/** The photo inside the PDF: long edge at most this many pixels, JPEG quality (legible signatures, ~0.5 MB). */
export const PAGE_PHOTO_MAX_EDGE = 2000;
export const PAGE_PHOTO_QUALITY = 0.82;
/** The smallest crop, as a fraction of each side (a slip of the finger can't make it vanish). */
export const MIN_CROP = 0.15;

/** @param {number} r */
export const normRot = r => (((Math.round((Number(r) || 0) / 90) * 90) % 360) + 360) % 360;

/** Size of an image after turning it by rot degrees. @param {number} w @param {number} h @param {number} rot */
export function rotatedSize(w, h, rot) { return normRot(rot) % 180 ? { width: h, height: w } : { width: w, height: h }; }

/**
 * A crop as fractions of the (rotated) image, kept inside it and at least MIN_CROP on each side.
 * @param {{ x: number, y: number, w: number, h: number }} c
 */
export function clampCrop(c) {
  const n = v => Math.min(1, Math.max(0, Number(v) || 0));
  let w = Math.max(MIN_CROP, Math.min(1, Number(c.w) || 1)), h = Math.max(MIN_CROP, Math.min(1, Number(c.h) || 1));
  const x = Math.min(n(c.x), 1 - w), y = Math.min(n(c.y), 1 - h);
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 };
}

/**
 * Drag one corner of a crop (fractions). corner: 'nw' | 'ne' | 'sw' | 'se'; point: where the finger is (fractions).
 * @param {{ x: number, y: number, w: number, h: number }} c @param {string} corner @param {{ x: number, y: number }} p
 */
export function dragCorner(c, corner, p) {
  let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
  const px = Math.min(1, Math.max(0, p.x)), py = Math.min(1, Math.max(0, p.y));
  if (corner.includes('w')) x1 = Math.min(px, x2 - MIN_CROP); else x2 = Math.max(px, x1 + MIN_CROP);
  if (corner.includes('n')) y1 = Math.min(py, y2 - MIN_CROP); else y2 = Math.max(py, y1 + MIN_CROP);
  return clampCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}

/** The image placed on a page: as large as fits, aspect kept, centred. Page points, bottom-left origin. */
export function fitOnPage(imgW, imgH, pageW, pageH) {
  const s = Math.min(pageW / imgW, pageH / imgH);
  const width = Math.round(imgW * s * 10) / 10, height = Math.round(imgH * s * 10) / 10;
  return { x: Math.round((pageW - width) / 2 * 10) / 10, y: Math.round((pageH - height) / 2 * 10) / 10, width, height };
}

/**
 * The Verified Application with one page replaced by the photo. The new page has the old page's displayed size
 * (Letter for the BSA form). Form fields are flattened first so none points at the page that leaves.
 * @param {any} PDFLib @param {Uint8Array} pdfBytes @param {number} pageIndex @param {Uint8Array} jpegBytes
 * @param {number} imgW @param {number} imgH
 * @returns {Promise<{ pdfBytes: Uint8Array, pages: number }>}
 */
export async function replacePageWithImage(PDFLib, pdfBytes, pageIndex, jpegBytes, imgW, imgH) {
  const doc = await loadPdfWithDecrypt(PDFLib, pdfBytes);
  const n = doc.getPageCount();
  if (!(pageIndex >= 0 && pageIndex < n)) throw new Error(`The application has ${n} page${n === 1 ? '' : 's'}: there is no page ${pageIndex + 1}.`);
  try { const f = doc.getForm(); if (f.getFields().length) f.flatten(); } catch { /* no usable form: nothing to flatten */ }
  const old = doc.getPage(pageIndex);
  const sz = old.getSize(), rot = normRot(old.getRotation().angle);
  const shown = rotatedSize(sz.width, sz.height, rot);
  doc.removePage(pageIndex);
  const page = doc.insertPage(pageIndex, [shown.width, shown.height]);
  const img = await doc.embedJpg(jpegBytes);
  page.drawImage(img, fitOnPage(imgW, imgH, shown.width, shown.height));
  const out = await doc.save();
  return { pdfBytes: out instanceof Uint8Array ? out : new Uint8Array(out), pages: n };
}

// ---------- browser: render and the editor ----------

/**
 * The photo turned and cropped, as JPEG bytes (long edge at most maxEdge).
 * @param {ImageBitmap} bmp @param {number} rot @param {{ x: number, y: number, w: number, h: number }} crop
 * @returns {Promise<{ bytes: Uint8Array, width: number, height: number, dataUrl: string }>}
 */
export async function renderPagePhoto(bmp, rot, crop, maxEdge = PAGE_PHOTO_MAX_EDGE, quality = PAGE_PHOTO_QUALITY) {
  const r = normRot(rot), full = rotatedSize(bmp.width, bmp.height, r);
  const turned = document.createElement('canvas');
  turned.width = full.width; turned.height = full.height;
  const tc = /** @type {CanvasRenderingContext2D} */ (turned.getContext('2d'));
  tc.translate(full.width / 2, full.height / 2);
  tc.rotate(r * Math.PI / 180);
  tc.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const c = clampCrop(crop);
  const sx = Math.round(c.x * full.width), sy = Math.round(c.y * full.height), sw = Math.round(c.w * full.width), sh = Math.round(c.h * full.height);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * scale)); out.height = Math.max(1, Math.round(sh * scale));
  const oc = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  oc.fillStyle = '#fff'; oc.fillRect(0, 0, out.width, out.height);
  oc.drawImage(turned, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const dataUrl = out.toDataURL('image/jpeg', quality);
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, width: out.width, height: out.height, dataUrl };
}

/**
 * The editor: the photo, ⟲ / ⟳, and a crop frame with four corner handles (pointer events: finger, pen or mouse).
 * Resolves {bmp, rot, crop} on "Use this photo", null on Cancel.
 * @param {HTMLElement} host @param {File} file @param {(tag: string, props?: any, ...kids: any[]) => any} el
 * @returns {Promise<{ bmp: ImageBitmap, rot: number, crop: { x: number, y: number, w: number, h: number } } | null>}
 */
export async function editPagePhoto(host, file, el) {
  const bmp = await decodeUpright(file);
  let rot = 0, crop = { x: 0, y: 0, w: 1, h: 1 };
  const canvas = el('canvas', { className: 'pp-canvas' });
  const frame = el('div', { className: 'pp-frame' });
  const corners = ['nw', 'ne', 'sw', 'se'].map(k => { const h = el('div', { className: 'pp-handle pp-' + k }); h.dataset.corner = k; frame.append(h); return h; });
  const stage = el('div', { className: 'pp-stage' }, canvas, frame);
  const draw = () => {
    const full = rotatedSize(bmp.width, bmp.height, rot);
    const maxW = Math.min(host.clientWidth || 600, 640), maxH = Math.round(window.innerHeight * 0.6);
    const s = Math.min(maxW / full.width, maxH / full.height, 1);
    canvas.width = Math.round(full.width * s); canvas.height = Math.round(full.height * s);
    const cx = canvas.getContext('2d');
    cx.save(); cx.translate(canvas.width / 2, canvas.height / 2); cx.rotate(rot * Math.PI / 180);
    cx.drawImage(bmp, -bmp.width * s / 2, -bmp.height * s / 2, bmp.width * s, bmp.height * s); cx.restore();
    stage.style.width = canvas.width + 'px'; stage.style.height = canvas.height + 'px';
    placeFrame();
  };
  const placeFrame = () => {
    Object.assign(frame.style, { left: crop.x * canvas.width + 'px', top: crop.y * canvas.height + 'px',
      width: crop.w * canvas.width + 'px', height: crop.h * canvas.height + 'px' });
  };
  corners.forEach(h => {
    h.addEventListener('pointerdown', ev => {
      ev.preventDefault(); h.setPointerCapture(ev.pointerId);
      const move = (/** @type {PointerEvent} */ e) => {
        const r = canvas.getBoundingClientRect();
        crop = dragCorner(crop, h.dataset.corner, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        placeFrame();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  });
  return new Promise(resolve => {
    const left = el('button', { type: 'button', textContent: '⟲ Turn left' });
    const right = el('button', { type: 'button', textContent: '⟳ Turn right' });
    const reset = el('button', { type: 'button', textContent: 'Full photo' });
    const use = el('button', { type: 'button', className: 'primary', textContent: 'Use this photo' });
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    left.onclick = () => { rot = normRot(rot - 90); crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); };
    right.onclick = () => { rot = normRot(rot + 90); crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); };
    reset.onclick = () => { crop = { x: 0, y: 0, w: 1, h: 1 }; placeFrame(); };
    use.onclick = () => { host.replaceChildren(); resolve({ bmp, rot, crop: clampCrop(crop) }); };
    cancel.onclick = () => { host.replaceChildren(); bmp.close && bmp.close(); resolve(null); };
    host.replaceChildren(
      el('p', { className: 'hint', textContent: 'Turn the page upright, then drag the corners to the edges of the paper (leave out the table around it).' }),
      el('div', { className: 'eg-actions' }, left, right, reset), stage, el('div', { className: 'eg-actions' }, use, cancel));
    requestAnimationFrame(draw);
  });
}
