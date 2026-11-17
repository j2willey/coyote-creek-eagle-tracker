// EBoR photos, prepared in the browser before upload (Apps Script can't resize images):
//  - HEIC (iPhone, when the phone didn't convert it) decoded with heic2any, loaded only when needed;
//  - turned upright (EXIF orientation), long edge at most 1600 px, JPEG; quality (then size) steps down until the photo is
//    at most PHOTO_MAX_BYTES (2026-11-17: 9 photos at 2048 px / 0.85 made a 6.7 MB email; Google Groups refuse 8 MB.
//    Target: 12 photos ≈ 3.8 MB of JPEG ≈ 5.3 MB email);
//  - EXIF DateTimeOriginal = the board's date, with the photo's own time of day when known (piexifjs).
// If a helper library can't load, the photo still goes (without the EXIF date) and the caller is told.
import { CDN_SCRIPTS } from './cdnIntegrity.js'; // URL + Subresource Integrity hash per library
const LIBS = { piexif: CDN_SCRIPTS.piexif, heic2any: CDN_SCRIPTS.heic2any };
const loaded = {};
function loadScript(name) {
  if (globalThis[name]) return Promise.resolve(globalThis[name]);
  if (!loaded[name]) loaded[name] = new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: LIBS[name].url, integrity: LIBS[name].integrity, crossOrigin: 'anonymous', async: true });
    s.onload = () => globalThis[name] ? resolve(globalThis[name]) : reject(new Error(name + ' did not load'));
    s.onerror = () => { loaded[name] = null; reject(new Error(name + ' could not be loaded')); };
    document.head.append(s);
  });
  return loaded[name];
}

/** Photos per congratulations email that stay well under the 8 MB group limit; more is allowed (the dashboard just says so). */
export const MAX_PHOTOS = 12;
/** Per photo, after resizing. */
export const PHOTO_MAX_BYTES = 320 * 1024;
/** Tried in order until one fits PHOTO_MAX_BYTES; the last one is used even if it doesn't. */
export const PHOTO_STEPS = [{ edge: 1600, quality: 0.8 }, { edge: 1600, quality: 0.7 }, { edge: 1280, quality: 0.7 }, { edge: 1280, quality: 0.6 }];
const b64Bytes = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

/**
 * encode(edge, quality) -> JPEG data URL. Returns the first step's result that fits maxBytes (else the last).
 * Pure apart from encode, so it is tested without a browser.
 */
export async function encodeWithin(encode, steps = PHOTO_STEPS, maxBytes = PHOTO_MAX_BYTES) {
  let last = null;
  for (const st of steps) {
    const url = await encode(st.edge, st.quality);
    last = { url, edge: st.edge, quality: st.quality, bytes: b64Bytes(url) };
    if (last.bytes <= maxBytes) return last;
  }
  return last;
}

const pad = (n) => String(n).padStart(2, '0');
const isHeic = (f) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

function dataUrlOf(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read a photo'));
    r.readAsDataURL(blob);
  });
}

/** "HH:MM:SS" from the original photo's EXIF, else from the file's time, else 19:00:00. */
async function timeOfDay(file, piexif) {
  try {
    if (piexif && /jpe?g/i.test(file.type || file.name)) {
      const ex = piexif.load(await dataUrlOf(file));
      const t = (ex.Exif && ex.Exif[piexif.ExifIFD.DateTimeOriginal]) || '';
      const m = /\d{4}:\d{2}:\d{2} (\d{2}:\d{2}:\d{2})/.exec(t);
      if (m) return m[1];
    }
  } catch { /* no EXIF */ }
  if (file.lastModified) { const d = new Date(file.lastModified); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  return '19:00:00';
}

/**
 * file: a File from <input type=file>. ymd: the board's date 'YYYY-MM-DD'.
 * -> { base64, bytes, width, height, exif: true|false, note }
 */
export async function preparePhoto(file, ymd, { steps = PHOTO_STEPS, maxBytes = PHOTO_MAX_BYTES } = {}) {
  let src = file, note = '';
  if (isHeic(file)) {
    const heic2any = await loadScript('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    src = Array.isArray(out) ? out[0] : out;
  }
  const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  let w = 0, h = 0;
  const canvas = document.createElement('canvas');
  const enc = await encodeWithin(async (edge, quality) => {
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const nw = Math.round(bmp.width * scale), nh = Math.round(bmp.height * scale);
    if (nw !== w || nh !== h) { w = canvas.width = nw; h = canvas.height = nh; canvas.getContext('2d').drawImage(bmp, 0, 0, w, h); }
    return canvas.toDataURL('image/jpeg', quality);
  }, steps, maxBytes);
  bmp.close && bmp.close();
  let url = enc.url;
  let exif = false;
  try {
    const piexif = await loadScript('piexif');
    const stamp = ymd.replace(/-/g, ':') + ' ' + await timeOfDay(file, piexif);
    const zeroth = {}, ex = {};
    zeroth[piexif.ImageIFD.Orientation] = 1;
    zeroth[piexif.ImageIFD.DateTime] = stamp;
    zeroth[piexif.ImageIFD.Software] = 'Coyote Creek Eagle Tracker';
    ex[piexif.ExifIFD.DateTimeOriginal] = stamp;
    ex[piexif.ExifIFD.DateTimeDigitized] = stamp;
    url = piexif.insert(piexif.dump({ '0th': zeroth, Exif: ex }), url);
    exif = true;
  } catch (e) { note = 'EXIF date not added (' + e.message + ')'; }
  const base64 = url.split(',')[1];
  return { base64, bytes: Math.round(base64.length * 3 / 4), width: w, height: h, exif, note };
}
