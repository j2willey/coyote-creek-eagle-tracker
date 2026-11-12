// @ts-check
/**
 * The signing overlay (Task 13): "Sign with pen..." opens a nearly full-screen pad, one component used by the Sign
 * Workshop (`pdfWorkshop.js`) and the EBoR paperwork page (`pdfPaperworkPage.js`). A pen tablet that maps to the whole
 * screen (a screenless USB tablet) lines up with the big area; a phone or touchscreen gets the whole screen too.
 *
 * The overlay is a modal `<dialog>`, so it stacks above any other dialog. It has a baseline guide, Undo (last stroke),
 * Clear, Cancel, Done and an ink palette; Esc cancels. The page does not scroll or select text while it is open
 * (`touch-action: none`, one pointer at a time, a resting palm is ignored: all in the pad engine, `pdfDraw.js`).
 * It returns the strokes as data (`Ink`), never a bitmap: the caller renders the picture at whatever colour and size
 * it needs (`inkToPngDataUrl`).
 */
import { createDrawPad } from './pdfDraw.js';
import { INK_COLORS, normalizeInk } from './pdfPlan.js';

/**
 * @typedef {import('./pdfStrokes.js').Ink} Ink
 * @typedef {{ ink: Ink, inkKey: string }} SigningResult
 */

/**
 * Open the overlay.
 * @param {{ title?: string, who?: string, inkKey?: string, initialInk?: Ink | null }} [opts]
 * @returns {Promise<SigningResult | null>}  the strokes and the ink colour chosen, or null when cancelled
 */
export function openSigningOverlay(opts = {}) {
  return new Promise(resolve => {
    let inkKey = normalizeInk(opts.inkKey);
    const dlg = document.createElement('dialog');
    dlg.className = 'sp-overlay';
    dlg.setAttribute('aria-label', 'Sign with pen');

    const mk = (/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const head = mk('div', 'sp-head', '');
    const title = mk('strong', 'sp-title', opts.title || 'Sign with pen');
    const who = mk('span', 'sp-who hint', opts.who || '');
    const inkRow = mk('span', 'sp-ink', '');
    inkRow.setAttribute('role', 'radiogroup');
    inkRow.setAttribute('aria-label', 'Ink colour');
    const undoBtn = /** @type {HTMLButtonElement} */ (mk('button', 'sp-btn', 'Undo'));
    const clearBtn = /** @type {HTMLButtonElement} */ (mk('button', 'sp-btn', 'Clear'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (mk('button', 'sp-btn', 'Cancel'));
    const doneBtn = /** @type {HTMLButtonElement} */ (mk('button', 'sp-btn sp-done', 'Done'));
    for (const b of [undoBtn, clearBtn, cancelBtn, doneBtn]) b.type = 'button';
    head.append(title, who, inkRow, undoBtn, clearBtn, cancelBtn, doneBtn);

    const stage = mk('div', 'sp-stage', '');
    const canvas = /** @type {HTMLCanvasElement} */ (mk('canvas', 'sp-canvas', ''));
    const line = mk('div', 'sp-line', '');
    const mark = mk('span', 'sp-mark', 'x');
    const hint = mk('div', 'sp-hint hint', 'Sign above the line with the pen, a finger or the mouse.');
    stage.append(canvas, line, mark, hint);
    dlg.append(head, stage);

    /** @type {HTMLButtonElement[]} */
    const dots = [];
    for (const c of INK_COLORS) {
      const b = /** @type {HTMLButtonElement} */ (mk('button', 'ws-ink', ''));
      b.type = 'button';
      b.title = c.label;
      b.style.background = c.hex;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.onclick = () => { inkKey = c.key; syncInk(); pad.redraw(); };
      dots.push(b);
      inkRow.appendChild(b);
    }
    function syncInk() {
      dots.forEach((b, i) => { const on = INK_COLORS[i].key === inkKey; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    }
    function syncButtons() {
      const has = pad.hasInk();
      doneBtn.disabled = !has;
      undoBtn.disabled = !has;
      clearBtn.disabled = !has;
      hint.hidden = has;
    }
    const pad = createDrawPad(canvas, { getInk: () => inkKey, onChange: syncButtons });

    let finished = false;
    const noSelect = (/** @type {Event} */ ev) => ev.preventDefault();
    const prevOverflow = document.documentElement.style.overflow;
    /** @param {SigningResult | null} result */
    function finish(result) {
      if (finished) return;
      finished = true;
      document.removeEventListener('selectstart', noSelect, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
      pad.destroy();
      document.documentElement.style.overflow = prevOverflow;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(result);
    }
    const onKey = (/** @type {KeyboardEvent} */ ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null); }
    };
    const onResize = () => pad.fit();

    undoBtn.onclick = () => pad.undo();
    clearBtn.onclick = () => pad.clear();
    cancelBtn.onclick = () => finish(null);
    doneBtn.onclick = () => { const ink = pad.getInk(); if (ink) finish({ ink, inkKey }); };
    dlg.addEventListener('cancel', ev => { ev.preventDefault(); finish(null); });

    document.body.appendChild(dlg);
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('selectstart', noSelect, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    syncInk();
    pad.fit();
    if (opts.initialInk) pad.setInk(opts.initialInk);
    syncButtons();
    requestAnimationFrame(() => pad.fit()); // the dialog has its final size one frame after it opens
  });
}
