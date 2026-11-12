// @ts-check
/**
 * A scrollable view of every page of a PDF with draggable marks on top (EBoR paperwork page, Task 12).
 *
 * Same behaviour as the Sign Workshop's view (pages render lazily as they scroll into view and release their canvas
 * when far away; marks are kept in VIEWER space, the page as displayed, and are drawn upright by `pdfEngine`), but
 * generic: a mark is an image (a signature) or text, and the caller owns the list. Marks can be dragged, resized
 * from the corner (images keep their aspect ratio) and removed with the cross; marks that share a `group` move
 * together (the three date boxes). Pointer events with `touch-action: none` on a mark, so a finger or pen drags it
 * and the rest of the page still scrolls.
 */
import { clampItemToPage, resizeBoxInPage, resizeImageBoxInPage, fitTextFontSize, inkHex } from './pdfPlan.js';

/**
 * @typedef {Object} ViewMark
 * @property {string} id
 * @property {'image' | 'text'} kind
 * @property {number} pageIndex
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} label     what it is ("Signature: board chair", "Date MM")
 * @property {string} [dataUrl] image marks
 * @property {string} [text]
 * @property {string} [ink]
 * @property {number} [fontSize]
 * @property {string} [group]   marks with the same group move together
 *
 * @typedef {Object} PageView
 * @property {() => void} refresh               redraw every mark (after the caller changed the list)
 * @property {(i: number) => void} scrollToPage
 * @property {() => number} currentPage
 * @property {(armed: boolean) => void} setArmed  the next click on a page calls onPageClick (cursor changes)
 * @property {(id: string) => void} select
 * @property {() => void} destroy
 */

/**
 * @param {HTMLElement} host  a scrollable element (fixed height, overflow auto)
 * @param {{
 *   pdfjsDoc: any,
 *   pageSizes: Array<{ width: number, height: number }>,
 *   getMarks: () => ViewMark[],
 *   onRemove: (mark: ViewMark) => void,
 *   onChange?: () => void,
 *   onPageClick?: (pageIndex: number, point: { x: number, y: number }) => void,
 *   onCurrentPage?: (pageIndex: number) => void,
 *   scale?: number
 * }} opts
 * @returns {PageView}
 */
export function createPageView(host, opts) {
  const { pdfjsDoc, pageSizes } = opts;
  const totalPages = pageSizes.length;
  const pageSizeOf = (/** @type {number} */ i) => pageSizes[i] || { width: 612, height: 792 };
  const cssScale = opts.scale || Math.max(0.5, Math.min(1.3, ((host.clientWidth || 720) - 28) / Math.max(...pageSizes.map(p => p.width), 612)));
  let armed = false;
  let selectedId = '';
  let current = 0;
  let closed = false;
  host.replaceChildren();
  const doc = document.createElement('div');
  doc.className = 'ws-doc';
  host.appendChild(doc);

  /** @type {Array<{ wrap: HTMLElement, canvas: HTMLCanvasElement, overlay: HTMLElement, rendered: boolean, rendering: boolean, want: boolean }>} */
  const pageEls = [];
  for (let i = 0; i < totalPages; i++) {
    const ps = pageSizeOf(i);
    const wrap = document.createElement('div');
    wrap.className = 'ws-page';
    wrap.dataset.page = String(i);
    wrap.style.width = `${Math.round(ps.width * cssScale)}px`;
    wrap.style.height = `${Math.round(ps.height * cssScale)}px`;
    const label = document.createElement('span');
    label.className = 'ws-page-label';
    label.textContent = `Page ${i + 1}`;
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const overlay = document.createElement('div');
    overlay.className = 'ws-overlay';
    wrap.append(canvas, overlay, label);
    doc.appendChild(wrap);
    pageEls.push({ wrap, canvas, overlay, rendered: false, rendering: false, want: false });
    wrap.addEventListener('click', ev => {
      if (!armed || !opts.onPageClick) return;
      const target = /** @type {HTMLElement} */ (ev.target);
      if (target.closest && target.closest('.ws-place-box')) return;
      const r = wrap.getBoundingClientRect();
      opts.onPageClick(i, {
        x: ((ev.clientX - r.left) / Math.max(1, r.width)) * ps.width,
        y: ps.height - ((ev.clientY - r.top) / Math.max(1, r.height)) * ps.height
      });
    });
  }

  function setCurrent(/** @type {number} */ i) {
    if (i === current) return;
    current = i;
    if (opts.onCurrentPage) opts.onCurrentPage(i);
  }
  function scrollToPage(/** @type {number} */ i) {
    const el = pageEls[i];
    if (!el) return;
    host.scrollTop = Math.max(0, el.wrap.offsetTop - 8);
    setCurrent(i);
  }

  function changed() { if (opts.onChange) opts.onChange(); }

  function select(/** @type {string} */ id) {
    selectedId = id;
    host.querySelectorAll('.ws-place-box').forEach(e => e.classList.toggle('selected', /** @type {HTMLElement} */ (e).dataset.id === id));
  }

  /** Marks of one page: drag (a group together), corner resize, cross to remove. */
  function renderPage(/** @type {number} */ pageIndex) {
    const pe = pageEls[pageIndex];
    if (!pe) return;
    const ps = pageSizeOf(pageIndex);
    pe.overlay.replaceChildren();
    /** @type {Map<string, () => void>} */
    const placers = new Map();      // mark id -> repositions its element (a dragged group moves without a rebuild)
    for (const box of opts.getMarks().filter(m => m.pageIndex === pageIndex)) {
      const el = document.createElement('div');
      el.className = `ws-place-box ws-place-${box.kind === 'image' ? 'signature' : 'name'}`;
      el.dataset.id = box.id;
      if (box.id === selectedId) el.classList.add('selected');
      el.style.touchAction = 'none';
      el.title = `${box.label}: drag to move, drag the bottom-right corner to resize`;
      const geometry = () => {
        el.style.left = `${(box.x / ps.width) * 100}%`;
        el.style.top = `${((ps.height - box.y - box.height) / ps.height) * 100}%`;
        el.style.width = `${(box.width / ps.width) * 100}%`;
        el.style.height = `${(box.height / ps.height) * 100}%`;
      };
      geometry();
      placers.set(box.id, geometry);
      const content = document.createElement('span');
      content.className = 'ws-place-content';
      const paint = () => {
        if (box.kind === 'image') {
          content.replaceChildren();
          const img = document.createElement('img');
          img.src = box.dataUrl || '';
          img.alt = box.label;
          content.appendChild(img);
        } else {
          const txt = String(box.text || '');
          content.textContent = txt;
          content.style.color = inkHex(box.ink);
          const pt = fitTextFontSize(txt, box.width, box.height, Number(box.fontSize) || 0);
          content.style.fontSize = `${Math.max(9, Math.round(pt * cssScale * 10) / 10)}px`;
        }
      };
      paint();
      el.appendChild(content);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ws-item-x';
      remove.textContent = '✕';
      remove.title = `Remove: ${box.label}`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('pointerdown', ev => ev.stopPropagation());
      remove.addEventListener('click', ev => { ev.stopPropagation(); opts.onRemove(box); });
      el.appendChild(remove);

      const handle = document.createElement('span');
      handle.className = 'ws-resize-handle';
      handle.style.touchAction = 'none';
      el.appendChild(handle);
      handle.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        select(box.id);
        handle.setPointerCapture(ev.pointerId);
        const rect = pe.overlay.getBoundingClientRect();
        const startX = ev.clientX, startY = ev.clientY, orig = { ...box };
        const move = (/** @type {PointerEvent} */ mv) => {
          const dx = ((mv.clientX - startX) / Math.max(1, rect.width)) * ps.width;
          const dy = ((mv.clientY - startY) / Math.max(1, rect.height)) * ps.height;
          const r = box.kind === 'image' ? resizeImageBoxInPage(orig, dx, dy, ps, { minWidth: 24 }) : resizeBoxInPage(orig, dx, dy, ps, { minWidth: 24, minHeight: 10 });
          box.x = r.x; box.y = r.y; box.width = r.width; box.height = r.height;
          geometry(); paint();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          changed();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });

      el.addEventListener('pointerdown', ev => {
        if (ev.target === handle || ev.target === remove) return;
        ev.preventDefault();
        select(box.id);
        el.setPointerCapture(ev.pointerId);
        const rect = pe.overlay.getBoundingClientRect();
        const startX = ev.clientX, startY = ev.clientY;
        const movers = (box.group ? opts.getMarks().filter(m => m.group === box.group && m.pageIndex === pageIndex) : [box]).map(m => ({ m, x: m.x, y: m.y }));
        const move = (/** @type {PointerEvent} */ mv) => {
          const dx = ((mv.clientX - startX) / Math.max(1, rect.width)) * ps.width;
          const dy = ((mv.clientY - startY) / Math.max(1, rect.height)) * ps.height;
          // The group moves as one: stop at the first mark that would leave the page.
          let ddx = dx, ddy = -dy;
          for (const o of movers) {
            ddx = Math.max(-o.x, Math.min(ps.width - o.m.width - o.x, ddx));
            ddy = Math.max(-o.y, Math.min(ps.height - o.m.height - o.y, ddy));
          }
          for (const o of movers) {
            o.m.x = Math.round((o.x + ddx) * 10) / 10;
            o.m.y = Math.round((o.y + ddy) * 10) / 10;
            const place = placers.get(o.m.id);
            if (place) place();
          }
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          changed();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      pe.overlay.appendChild(el);
    }
  }

  function refresh() { for (let i = 0; i < totalPages; i++) renderPage(i); }

  // Lazy rendering (same approach as the Sign Workshop).
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
        const vp = page.getViewport({ scale: cssScale * dpr });
        pe.canvas.width = Math.round(vp.width);
        pe.canvas.height = Math.round(vp.height);
        const ctx = pe.canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
        pe.rendered = true;
        if (!pe.want) release(i);
      } catch { /* left blank; scrolling away and back retries */ }
      finally { pe.rendering = false; }
    });
  }
  function release(/** @type {number} */ i) {
    const pe = pageEls[i];
    pe.want = false;
    if (pe.rendered) { pe.canvas.width = 0; pe.canvas.height = 0; pe.rendered = false; }
  }
  /** @type {IntersectionObserver | null} */
  let renderObserver = null;
  /** @type {IntersectionObserver | null} */
  let currentObserver = null;
  if (typeof IntersectionObserver === 'function') {
    renderObserver = new IntersectionObserver(entries => {
      for (const en of entries) {
        const i = Number(/** @type {HTMLElement} */ (en.target).dataset.page);
        if (en.isIntersecting) requestRender(i); else release(i);
      }
    }, { root: host, rootMargin: '900px 0px' });
    /** @type {Map<number, number>} */
    const ratios = new Map();
    currentObserver = new IntersectionObserver(entries => {
      for (const en of entries) ratios.set(Number(/** @type {HTMLElement} */ (en.target).dataset.page), en.intersectionRatio);
      let best = -1, bestRatio = 0;
      ratios.forEach((r, i) => { if (r > bestRatio + 1e-6 || (Math.abs(r - bestRatio) < 1e-6 && i < best)) { best = i; bestRatio = r; } });
      if (best >= 0) setCurrent(best);
    }, { root: host, threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    pageEls.forEach(pe => { renderObserver && renderObserver.observe(pe.wrap); currentObserver && currentObserver.observe(pe.wrap); });
  } else {
    for (let i = 0; i < Math.min(totalPages, 3); i++) requestRender(i);
  }
  refresh();

  return {
    refresh,
    scrollToPage,
    currentPage: () => current,
    setArmed(a) { armed = a; doc.classList.toggle('armed', a); },
    select,
    destroy() {
      closed = true;
      if (renderObserver) renderObserver.disconnect();
      if (currentObserver) currentObserver.disconnect();
      host.replaceChildren();
    }
  };
}

/** Keep a mark inside its page (used by the page when it adds or moves marks). */
export { clampItemToPage };
