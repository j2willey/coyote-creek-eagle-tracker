// @ts-check
/**
 * Small PNG / canvas helpers shared by the Sign Workshop (`pdfWorkshop.js`), the draw pad (`pdfDraw.js`) and the EBoR
 * paperwork page (`pdfPaperwork.js`): trim a signature to its ink, measure it, turn a data URL into bytes.
 */
import { inkBoundingBox } from './pdfPlan.js';

/**
 * A PNG data URL of `canvas` cropped to its ink (pixels that are not transparent) plus a small margin, so a signature
 * carries no transparent padding: its box then hugs the ink, in the preview and in the PDF. An empty canvas is returned
 * as is.
 * @param {HTMLCanvasElement} canvas
 * @returns {string}
 */
export function canvasToTrimmedPngDataUrl(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return canvas.toDataURL('image/png');
    const box = inkBoundingBox(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!box || (box.width === canvas.width && box.height === canvas.height)) return canvas.toDataURL('image/png');
    const out = document.createElement('canvas');
    out.width = box.width;
    out.height = box.height;
    const octx = out.getContext('2d');
    if (!octx) return canvas.toDataURL('image/png');
    octx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return out.toDataURL('image/png');
  } catch {
    return canvas.toDataURL('image/png');
  }
}

/**
 * Trim a PNG data URL (e.g. a signature saved by an earlier version) to its ink; resolves to the input on any problem.
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export function trimPngDataUrl(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, img.naturalWidth);
      c.height = Math.max(1, img.naturalHeight);
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvasToTrimmedPngDataUrl(c));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Natural aspect ratio (width / height) of a PNG data URL, 0 when empty or unreadable.
 * @param {string} dataUrl
 * @returns {Promise<number>}
 */
export function pngAspect(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(0); return; }
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0);
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}

/**
 * Convert a `data:image/png;base64,...` URL into a `Uint8Array`.
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
export function dataUrlToBytes(dataUrl) {
  const idx = String(dataUrl || '').indexOf(',');
  if (idx < 0) return new Uint8Array(0);
  const b64 = dataUrl.slice(idx + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

