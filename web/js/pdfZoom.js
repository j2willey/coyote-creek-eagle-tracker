// @ts-check
/**
 * Zoom for the PDF page views (Sign Workshop and EBoR paperwork page) (Jim W., 2026-11-12): the pages open fitted
 * to the window; zoom multiplies that. One control (− 100% + Fit) and Ctrl/⌘ + mouse wheel. The last zoom is
 * remembered in this browser. Marks are kept in page points and drawn in % of the page box, so zoom only changes
 * the page boxes' pixel size and the canvases' render scale.
 */

export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
const STORE_KEY = 'eagle.pdfZoom';

/** @param {number} z */
export function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n * 100) / 100));
}

/**
 * The next zoom step up (dir > 0) or down (dir < 0) from `z` (z need not be on a step).
 * @param {number} z @param {number} dir
 */
export function stepZoom(z, dir) {
  const cur = clampZoom(z);
  if (dir > 0) return ZOOM_STEPS.find(s => s > cur + 1e-6) ?? ZOOM_MAX;
  const below = ZOOM_STEPS.filter(s => s < cur - 1e-6);
  return below.length ? below[below.length - 1] : ZOOM_MIN;
}

/** @param {number} z */
export const zoomLabel = z => `${Math.round(clampZoom(z) * 100)}%`;

export function loadZoom() {
  try { return clampZoom(Number(localStorage.getItem(STORE_KEY)) || 1); } catch { return 1; }
}
/** @param {number} z */
export function saveZoom(z) {
  try { localStorage.setItem(STORE_KEY, String(clampZoom(z))); } catch { /* private mode */ }
}

/**
 * Resize every page box to `scale` (CSS px per PDF point) and keep the spot at the centre of the scroll view in
 * place. Canvases keep their old bitmap (stretched) until `rerender(i)` draws them again at the new scale.
 * @param {HTMLElement} host  the scrolling element
 * @param {Array<{ wrap: HTMLElement, rendered: boolean, want: boolean }>} pageEls
 * @param {(i: number) => { width: number, height: number }} pageSizeOf
 * @param {number} scale
 * @param {(i: number) => void} rerender
 */
export function applyPageScale(host, pageEls, pageSizeOf, scale, rerender) {
  const fx = host.scrollWidth > 0 ? (host.scrollLeft + host.clientWidth / 2) / host.scrollWidth : 0.5;
  const fy = host.scrollHeight > 0 ? (host.scrollTop + host.clientHeight / 2) / host.scrollHeight : 0;
  pageEls.forEach((pe, i) => {
    const ps = pageSizeOf(i);
    pe.wrap.style.width = `${Math.round(ps.width * scale)}px`;
    pe.wrap.style.height = `${Math.round(ps.height * scale)}px`;
  });
  host.scrollLeft = Math.max(0, fx * host.scrollWidth - host.clientWidth / 2);
  host.scrollTop = Math.max(0, fy * host.scrollHeight - host.clientHeight / 2);
  pageEls.forEach((pe, i) => {
    if (pe.rendered || pe.want) { pe.rendered = false; rerender(i); }
  });
}

/**
 * The zoom control: "Zoom − 150% + Fit". Ctrl/⌘ + wheel over `host` zooms too (a trackpad pinch sends that).
 * @param {HTMLElement} host
 * @param {(z: number) => void} onZoom
 * @param {number} initial
 * @returns {{ el: HTMLElement, set: (z: number) => void, get: () => number }}
 */
export function createZoomControl(host, onZoom, initial) {
  let zoom = clampZoom(initial);
  const wrap = document.createElement('span');
  wrap.className = 'ws-zoom';
  const lbl = document.createElement('span');
  lbl.className = 'hint';
  lbl.textContent = 'Zoom';
  const mk = (/** @type {string} */ text, /** @type {string} */ title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-step-btn';
    b.textContent = text;
    b.title = title;
    return b;
  };
  const out = mk('−', 'Zoom out (Ctrl + mouse wheel)');
  const inn = mk('+', 'Zoom in (Ctrl + mouse wheel)');
  const fit = mk('Fit', 'Fit the page to the window');
  const val = document.createElement('span');
  val.className = 'ws-size-val';
  const show = () => { val.textContent = zoomLabel(zoom); out.disabled = zoom <= ZOOM_MIN; inn.disabled = zoom >= ZOOM_MAX; };
  const set = (/** @type {number} */ z) => {
    const next = clampZoom(z);
    if (Math.abs(next - zoom) < 1e-6) { show(); return; }
    zoom = next;
    saveZoom(zoom);
    show();
    onZoom(zoom);
  };
  out.onclick = () => set(stepZoom(zoom, -1));
  inn.onclick = () => set(stepZoom(zoom, 1));
  fit.onclick = () => set(1);
  let acc = 0;
  host.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    acc += ev.deltaY;
    if (Math.abs(acc) < 40) return;
    set(stepZoom(zoom, acc < 0 ? 1 : -1));
    acc = 0;
  }, { passive: false });
  wrap.append(lbl, out, val, inn, fit);
  show();
  return { el: wrap, set, get: () => zoom };
}
