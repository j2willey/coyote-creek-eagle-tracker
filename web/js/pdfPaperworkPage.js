// @ts-check
/**
 * The EBoR paperwork page (`/committee/ebor-paperwork`, Task 12): sign the Verified Eagle Application (Requirement 7)
 * and fill + sign the Advancement Report at the board, then file both and draft the Council email.
 *
 * Built on the Sign Workshop's engine: `pdfEngine` (decrypt, flatten, draw upright on rotated pages), `pdfPlan`
 * (placement maths, ink palette), `pdfDraw` (the touch / stylus draw pad), `pdfView` (the scrollable pages with
 * draggable marks). The page's HTML passes in the committee helpers (api, $, el, session ...) so this file stays
 * type-checked without importing the untyped committee.js.
 */
import { ensurePdfLibs, ensureGoogleScriptFonts, renderTypedSignaturePngAsync, loadSavedSignature } from './pdfWorkshop.js';
import { SCRIPT_FONTS, INK_COLORS, DEFAULT_INK, normalizeInk } from './pdfPlan.js';
import { inspectPdfWithPdfJs, applyMarksAndFlatten } from './pdfEngine.js';
import { createPageView } from './pdfView.js';
import { createDrawPad } from './pdfDraw.js';
import { pngAspect, dataUrlToBytes } from './pdfInk.js';
import { findRequirement7Page, requirement7DateMarks, fitSignatureToBox, fillAdvancementReport } from './pdfPaperwork.js';

// Ink, font and Type / Draw only: never a signature (several people sign on one device).
const STORE_KEY = 'ccacEborPaperwork_v1';

/**
 * @typedef {import('./pdfView.js').ViewMark & { slotKey?: string }} Mark
 * @typedef {{ key: string, label: string, rep: boolean, name: string, dataUrl: string, aspect: number }} Slot
 * @typedef {{ pageIndex: number, x: number, y: number, width: number, height: number }} Rect
 * @typedef {{
 *   kind: 'application' | 'report', host: any, pagesBar: any, slotsBox: any,
 *   baseBytes: Uint8Array | null, pdfjsDoc: any, view: import('./pdfView.js').PageView | null,
 *   pageSizes: Array<{ width: number, height: number }>, marks: Mark[], slots: Slot[],
 *   sigRects: Record<string, Rect | null>, armed: Slot | null, verifiedId: string
 * }} DocState
 */

/** @param {any} deps */
export function initPaperwork(deps) {
  const { api, $, el, session, meLine, meText, needSignIn, isSignedOut, readBase64, sizeText } = deps;

  /** @type {any} */
  let data = null;
  /** @type {any} */
  let sc = null;
  let loadSeq = 0;
  /** @type {Uint8Array | null} */
  let templateBytes = null;
  let dirty = false;
  const maxMB = () => (data && data.maxUploadMB) || 20;

  const stored = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } })();
  let ink = normalizeInk(stored.ink || loadSavedSignature('').ink || DEFAULT_INK);
  let fontKey = String(stored.fontKey || 'dancing');
  let sigMode = stored.mode === 'draw' ? 'draw' : 'type';
  const saveSettings = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ink, fontKey, mode: sigMode })); } catch { /* private mode */ } };

  /** @param {'application' | 'report'} kind @returns {DocState} */
  const newDoc = kind => {
    const k = kind === 'application' ? 'Application' : 'Report';
    return { kind, host: $('host' + k), pagesBar: $('pages' + k), slotsBox: $('slots' + k), baseBytes: null, pdfjsDoc: null, view: null,
      pageSizes: [], marks: [], slots: [], sigRects: {}, armed: null, verifiedId: '' };
  };
  const docs = { application: newDoc('application'), report: newDoc('report') };

  /** @param {string} t @param {string} [c] */
  const say = (t, c) => { $('saveMsg').textContent = t; $('saveMsg').className = c || 'muted'; };
  /** @param {any} e */
  const fail = e => {
    if (isSignedOut(e)) { $('app').hidden = true; $('msg').hidden = false; needSignIn($('msg'), e.message); return; }
    say(e && e.message ? e.message : String(e), 'err');
  };

  // ---- ink palette (a row of colour dots) ----
  /** @type {Array<() => void>} */
  const inkSyncs = [];
  /** @param {any} row */
  function buildInkRow(row) {
    row.replaceChildren(el('span', { className: 'hint', textContent: 'Ink:' }));
    /** @type {any[]} */
    const btns = [];
    for (const c of INK_COLORS) {
      const b = el('button', { type: 'button', className: 'ws-ink', title: c.label });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.style.background = c.hex;
      b.onclick = () => setInk(c.key);
      btns.push(b);
      row.appendChild(b);
    }
    const sync = () => btns.forEach((b, i) => { const on = INK_COLORS[i].key === ink; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    inkSyncs.push(sync);
    sync();
  }
  /** @param {string} key */
  function setInk(key) {
    ink = normalizeInk(key);
    saveSettings();
    inkSyncs.forEach(f => f());
    // The date follows the ink; a finished signature keeps the colour it was made in.
    for (const d of Object.values(docs)) { d.marks.forEach(m => { if (m.kind === 'text') m.ink = ink; }); if (d.view) d.view.refresh(); }
    if (sigDialogOpen) { sigPad.redraw(); void renderTyped(); }
  }

  // ---- the signature dialog (one for all signers) ----
  const dlg = $('sigDlg');
  const sigText = $('sigText');
  const sigFont = $('sigFont');
  const sigPreview = $('sigPreview');
  const sigPad = createDrawPad($('sigPad'), { getInk: () => ink, onChange: () => { $('sigMsg').textContent = ''; } });
  let sigDialogOpen = false;
  /** @type {((r: string | null) => void) | null} */
  let sigResolve = null;
  buildInkRow($('sigInk'));
  sigFont.replaceChildren(...SCRIPT_FONTS.map(f => { const o = el('option', { value: f.key, textContent: f.label }); o.style.fontFamily = `'${f.family}', cursive`; return o; }));
  async function renderTyped() {
    sigFont.style.fontFamily = `"${(SCRIPT_FONTS.find(f => f.key === sigFont.value) || SCRIPT_FONTS[0]).family}", cursive`;
    sigPreview.src = sigText.value.trim() ? await renderTypedSignaturePngAsync(sigText.value, sigFont.value, ink) : '';
  }
  sigText.oninput = () => void renderTyped();
  sigFont.onchange = () => { fontKey = sigFont.value; saveSettings(); void renderTyped(); };
  /** @param {string} mode */
  function setSigMode(mode) {
    sigMode = mode === 'draw' ? 'draw' : 'type';
    saveSettings();
    dlg.querySelectorAll('.ws-tab').forEach((/** @type {any} */ b) => b.classList.toggle('active', b.dataset.mode === sigMode));
    $('sigType').hidden = sigMode !== 'type';
    $('sigDraw').hidden = sigMode !== 'draw';
    $('sigMsg').textContent = '';
  }
  dlg.querySelectorAll('.ws-tab').forEach((/** @type {any} */ b) => { b.onclick = () => setSigMode(b.dataset.mode || 'type'); });
  $('sigUndo').onclick = () => sigPad.undo();
  $('sigClear').onclick = () => sigPad.clear();
  /** @param {string | null} result */
  function closeSig(result) {
    if (!sigResolve) return;
    const r = sigResolve; sigResolve = null; sigDialogOpen = false;
    if (dlg.open) dlg.close();
    r(result);
  }
  $('sigCancel').onclick = () => closeSig(null);
  dlg.addEventListener('cancel', (/** @type {Event} */ ev) => { ev.preventDefault(); closeSig(null); });
  $('sigUse').onclick = async () => {
    if (sigMode === 'type') {
      if (!sigText.value.trim()) { $('sigMsg').textContent = 'Type the signature first.'; return; }
      closeSig(await renderTypedSignaturePngAsync(sigText.value, sigFont.value, ink));
    } else {
      if (!sigPad.hasInk()) { $('sigMsg').textContent = 'Draw the signature first.'; return; }
      closeSig(sigPad.toPngDataUrl());
    }
  };
  /** @param {string} title @param {string} name @returns {Promise<string | null>} a PNG data URL, or null when cancelled */
  async function askSignature(title, name) {
    ensureGoogleScriptFonts();
    $('sigTitle').textContent = title;
    $('sigWho').textContent = `Signer: ${name}`;
    sigText.value = name;
    sigFont.value = SCRIPT_FONTS.some(f => f.key === fontKey) ? fontKey : 'dancing';
    sigPad.clear();
    setSigMode(sigMode);
    inkSyncs.forEach(f => f());
    sigDialogOpen = true;
    dlg.showModal();
    void renderTyped();
    return new Promise(resolve => { sigResolve = resolve; });
  }

  // ---- documents: open a PDF into a view ----
  /** @param {DocState} d @param {Uint8Array} bytes */
  async function openPdf(d, bytes) {
    const { pdfjsLib } = await ensurePdfLibs();
    if (d.view) d.view.destroy();
    if (d.pdfjsDoc) { try { void d.pdfjsDoc.destroy(); } catch { /* ignore */ } }
    const insp = await inspectPdfWithPdfJs(pdfjsLib, bytes);
    d.pdfjsDoc = insp.pdfjsDoc;
    d.pageSizes = insp.pageSizes;
    d.baseBytes = bytes;
    d.marks = [];
    d.armed = null;
    d.view = createPageView(d.host, {
      pdfjsDoc: d.pdfjsDoc, pageSizes: d.pageSizes, getMarks: () => d.marks,
      onRemove: m => { d.marks = d.marks.filter(x => x !== m); afterMarksChanged(d); },
      onChange: () => { dirty = true; },
      onPageClick: (pageIndex, point) => placeAtPoint(d, pageIndex, point),
      onCurrentPage: () => drawPageBar(d)
    });
    drawPageBar(d);
    refreshSlots(d);
    return insp;
  }
  /** @param {DocState} d */
  function drawPageBar(d) {
    d.pagesBar.replaceChildren(el('span', { className: 'hint', textContent: 'Jump to page:' }));
    const cur = d.view ? d.view.currentPage() : 0;
    d.pageSizes.forEach((_, i) => {
      const b = el('button', { type: 'button', className: 'ws-page-btn' + (i === cur ? ' active' : '') + (d.marks.some(m => m.pageIndex === i) ? ' marked' : ''), textContent: String(i + 1) });
      b.onclick = () => d.view && d.view.scrollToPage(i);
      d.pagesBar.appendChild(b);
    });
  }
  /** @param {DocState} d */
  function afterMarksChanged(d) {
    dirty = true;
    if (d.view) d.view.refresh();
    drawPageBar(d);
    refreshSlots(d);
  }

  // ---- signer slots ----
  /** @param {DocState} d @param {Slot} s */
  const slotPlaced = (d, s) => d.marks.some(m => m.slotKey === s.key);
  /** @param {DocState} d */
  const docDone = d => d.slots.length > 0 && d.slots.every(s => slotPlaced(d, s) && s.name.trim().length >= 2);
  function updateTabs() {
    $('tabApplication').querySelector('.ep-ok').hidden = !docDone(docs.application);
    $('tabReport').querySelector('.ep-ok').hidden = !docDone(docs.report);
  }
  /** @param {DocState} d */
  function refreshSlots(d) {
    d.slotsBox.querySelectorAll('.ep-slot').forEach((/** @type {any} */ b) => { if (b.sync) b.sync(); });
    updateTabs();
  }

  /** @param {DocState} d */
  function renderSlots(d) {
    d.slotsBox.replaceChildren(
      el('h3', { textContent: d.kind === 'application' ? 'Requirement 7: two signatures' : 'Advancement Report: three signatures' }),
      el('p', { className: 'hint', textContent: 'Each signer types their name, then signs. At least one signer on each document must be a District Advancement Committee / Council representative.' }),
      ...d.slots.map(s => {
        const name = el('input', { type: 'text', value: s.name, placeholder: 'Signer\'s name (type it)', autocomplete: 'off' });
        name.setAttribute('list', 'boardNames');
        name.setAttribute('aria-label', `Name of the signer: ${s.label}`);
        const rep = el('input', { type: 'checkbox', checked: s.rep });
        const sign = el('button', { type: 'button', textContent: 'Sign…' });
        const place = el('button', { type: 'button' });
        const thumb = el('img', { className: 'ep-thumb', alt: 'Signature', hidden: true });
        const status = el('span', { className: 'hint' });
        const box = el('div', { className: 'ep-slot' },
          el('h4', { textContent: s.label }), name,
          el('label', { className: 'choice' }, rep, ' ' + (data.repLabel || 'District Advancement Committee / Council representative')),
          el('div', { className: 'ep-actions' }, sign, thumb, place, status));
        const sync = () => {
          const placed = slotPlaced(d, s);
          sign.disabled = s.name.trim().length < 2;
          sign.textContent = s.dataUrl ? 'Sign again…' : 'Sign…';
          place.disabled = !s.dataUrl;
          place.textContent = placed ? 'Move to its line' : (d.kind === 'report' && d.sigRects[s.key] ? 'Place on the form' : 'Place on the page…');
          status.textContent = !s.dataUrl ? 'Not signed yet.' : placed ? 'Placed. Drag it to adjust.' : 'Signed. Place it on the page.';
          box.classList.toggle('done', placed && s.name.trim().length >= 2);
        };
        name.oninput = () => { s.name = name.value; dirty = true; refreshSlots(d); };
        rep.onchange = () => { s.rep = rep.checked; };
        sign.onclick = async () => {
          const url = await askSignature(s.label, s.name.trim());
          if (!url) return;
          s.dataUrl = url; s.aspect = await pngAspect(url); dirty = true;
          thumb.src = url; thumb.hidden = false;
          // A signature already on the page is replaced in place (same width, new picture).
          const m = d.marks.find(x => x.slotKey === s.key);
          if (m) { m.dataUrl = url; m.height = Math.round((m.width / (s.aspect || 4)) * 10) / 10; if (d.view) d.view.refresh(); }
          refreshSlots(d);
        };
        place.onclick = () => placeSlot(d, s);
        box.sync = sync;
        sync();
        return box;
      }));
    updateTabs();
  }

  /** @param {DocState} d @param {Slot} s @param {number} pageIndex @param {{x:number,y:number,width:number,height:number}} box */
  function putSignature(d, s, pageIndex, box) {
    d.marks = d.marks.filter(m => m.slotKey !== s.key);
    const id = `sig-${d.kind}-${s.key}`;
    d.marks.push({ id, slotKey: s.key, kind: 'image', pageIndex, x: box.x, y: box.y, width: box.width, height: box.height,
      label: `Signature: ${s.label}`, dataUrl: s.dataUrl });
    afterMarksChanged(d);
    if (d.view) { d.view.scrollToPage(pageIndex); d.view.select(id); }
  }
  /** @param {DocState} d @param {Slot} s */
  function placeSlot(d, s) {
    if (!s.dataUrl) return;
    const rect = d.kind === 'report' ? d.sigRects[s.key] : null;
    if (rect) {
      putSignature(d, s, rect.pageIndex, fitSignatureToBox(s.aspect, rect, { x: 0, y: 0 }, d.pageSizes[rect.pageIndex]));
      return;
    }
    d.armed = s;
    if (d.view) d.view.setArmed(true);
    say(`Click on the page where "${s.label}" signs (Escape cancels).`, 'muted');
  }
  /** @param {DocState} d @param {number} pageIndex @param {{x:number,y:number}} point */
  function placeAtPoint(d, pageIndex, point) {
    const s = d.armed;
    if (!s) return;
    d.armed = null;
    if (d.view) d.view.setArmed(false);
    say('', 'muted');
    putSignature(d, s, pageIndex, fitSignatureToBox(s.aspect, null, point, d.pageSizes[pageIndex]));
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    for (const d of Object.values(docs)) if (d.armed) { d.armed = null; if (d.view) d.view.setArmed(false); say('', 'muted'); }
  });

  // ---- tabs ----
  /** @param {'application' | 'report'} which */
  function showTab(which) {
    $('tabApplication').classList.toggle('on', which === 'application');
    $('tabReport').classList.toggle('on', which === 'report');
    $('panelApplication').hidden = which !== 'application';
    $('panelReport').hidden = which !== 'report';
    const d = docs[which];
    if (d.view) d.view.refresh();
  }
  $('tabApplication').onclick = () => showTab('application');
  $('tabReport').onclick = () => showTab('report');

  // ---- loading a Scout ----
  /** @param {string} b64 */
  const toBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  /** @param {string} fileId @param {string} name @param {number} seq */
  async function loadVerified(fileId, name, seq) {
    $('appNote').className = 'hint';
    $('appNote').textContent = `Opening ${name}…`;
    const r = await api('fetchScoutFile', { session, recordId: sc.recordId, fileId });
    if (seq !== loadSeq) return;
    docs.application.verifiedId = fileId;
    await openApplication(toBytes(r.data), r.name || name, seq);
  }
  /** @param {Uint8Array} bytes @param {string} name @param {number} seq */
  async function openApplication(bytes, name, seq) {
    const d = docs.application;
    const insp = await openPdf(d, bytes);
    if (seq !== loadSeq) return;
    /** @type {string[]} */
    const texts = [];
    for (let p = 1; p <= insp.pdfjsDoc.numPages; p++) {
      const tc = await (await insp.pdfjsDoc.getPage(p)).getTextContent();
      texts.push(tc.items.map((/** @type {any} */ it) => it.str || '').join(' '));
    }
    const r7 = findRequirement7Page(texts);
    const target = r7.index >= 0 ? r7.index : Math.min(1, d.pageSizes.length - 1);
    if (sc.requirement7) d.marks.push(...requirement7DateMarks(sc.requirement7, target, d.pageSizes[target], ink));
    afterMarksChanged(d);
    if (d.view) d.view.scrollToPage(target);
    $('appNote').className = 'hint';
    $('appNote').textContent = `${name}: ` + (r7.how === 'text' ? `Requirement 7 is on page ${target + 1}.`
      : r7.how === 'page2' ? 'Requirement 7 text not found (a scan?): opened at page 2. Scroll to the right page if it is not.'
        : 'Scroll to the page with Requirement 7.') +
      (sc.requirement7 ? ` The date ${sc.requirement7.text} is placed as three boxes (MM, DD, YY): drag them together onto the form's boxes.` : ' No EBoR date yet: pick it above.');
  }

  /** @param {number} seq */
  async function loadReport(seq) {
    $('repNote').className = 'hint';
    $('repNote').textContent = 'Preparing the Advancement Report…';
    try {
      if (!templateBytes) {
        const t = await api('eborPaperworkTemplate', { session });
        templateBytes = toBytes(t.data);
      }
    } catch (e) {
      if (isSignedOut(e)) throw e;
      $('repNote').className = 'hint err';
      $('repNote').textContent = e.message + ' You can choose the blank Advancement Report from this computer instead.';
      $('repLocalRow').hidden = false;
      return;
    }
    if (seq !== loadSeq) return;
    await fillReport(templateBytes, seq);
  }
  /** @param {Uint8Array} blank @param {number} seq */
  async function fillReport(blank, seq) {
    const d = docs.report;
    const { PDFLib } = await ensurePdfLibs();
    const out = await fillAdvancementReport(PDFLib, blank, { text: sc.fields, radio: sc.radio }, data.signatureFields);
    if (seq !== loadSeq) return;
    await openPdf(d, out.pdfBytes);
    d.sigRects = out.sigRects;
    refreshSlots(d);
    const notes = [];
    if (out.missing.length) notes.push(`Not on this form: ${out.missing.join(', ')}.`);
    if (!Object.values(out.sigRects).some(Boolean)) notes.push('No signature boxes found: place each signature by clicking on the page.');
    $('repNote').className = notes.length ? 'hint err' : 'hint';
    $('repNote').textContent = `Filled from the tracking sheet, Key 3 and Settings. Check it before signing. ${notes.join(' ')}`;
  }
  $('fReportLocal').addEventListener('change', async () => {
    const f = $('fReportLocal').files && $('fReportLocal').files[0];
    if (!f || !sc) return;
    try { templateBytes = new Uint8Array(await f.arrayBuffer()); await fillReport(templateBytes, loadSeq); } catch (e) { fail(e); }
  });

  function showScoutInfo() {
    const box = $('scoutBox');
    box.hidden = false;
    const district = sc.suggestions.district || [], unit = sc.suggestions.unit || [];
    const names = [...new Set([...district, ...unit, ...data.committee.map((/** @type {any} */ m) => m.name)])];
    $('boardNames').replaceChildren(...names.map(n => el('option', { value: n })));
    const dateIn = el('input', { type: 'date', value: sc.boardYmd || '' });
    dateIn.onchange = () => { if (dateIn.value && dateIn.value !== sc.boardYmd) void loadScout(dateIn.value); };
    const signed = [sc.alreadySigned.application && 'application', sc.alreadySigned.report && 'Advancement Report'].filter(Boolean);
    box.replaceChildren(
      el('div', {}, el('b', { textContent: sc.name }), ` · ${sc.unit} · ${sc.stage} · Board of Review `, dateIn, sc.boardTime ? ` at ${sc.boardTime}` : '',
        sc.folderUrl ? el('span', {}, ' · ', el('a', { href: sc.folderUrl, target: '_blank', rel: 'noopener', textContent: 'Scout\'s folder ↗' })) : ''),
      district.length || unit.length ? el('div', { className: 'muted' }, 'Board (suggestions for the signers\' names): ' + [
        district.length ? 'district / council: ' + district.join(', ') : '', unit.length ? 'unit: ' + unit.join(', ') : ''].filter(Boolean).join(' · ')) : '',
      signed.length ? el('div', { className: 'warnbox', textContent: `Signed ${signed.join(' and ')} already in the folder: saving again moves the earlier version to Archive.` }) : '');
    const probs = sc.problems || [];
    $('problems').hidden = !probs.length;
    $('problems').replaceChildren(...probs.map((/** @type {string} */ t) => el('div', { textContent: t })));
  }
  function fillVerifiedChoices() {
    const sel = $('fVerified');
    sel.replaceChildren(el('option', { value: '', textContent: sc.pdfs.length ? '— choose the Verified Application —' : '— no PDFs in the folder —' }),
      ...sc.pdfs.map((/** @type {any} */ f) => el('option', { value: f.id, textContent: `${f.verified ? '★ ' : ''}${f.name} (${f.date}, ${sizeText(f.bytes)})` })));
    sel.value = sc.verifiedId || '';
  }

  /** @param {string} [boardYmd] */
  async function loadScout(boardYmd) {
    const seq = ++loadSeq;
    const recordId = $('fScout').value;
    sc = null;
    $('scoutBox').hidden = true; $('problems').hidden = true;
    for (const d of Object.values(docs)) {
      if (d.view) d.view.destroy();
      d.view = null; d.marks = []; d.slots = []; d.slotsBox.replaceChildren(); d.pagesBar.replaceChildren(); d.host.replaceChildren(); d.baseBytes = null; d.sigRects = {}; d.verifiedId = '';
    }
    updateTabs();
    $('appNote').textContent = ''; $('repNote').textContent = ''; $('repLocalRow').hidden = true;
    if (!recordId) return;
    say('Loading…', 'muted');
    try {
      sc = await api('eborPaperworkScout', { session, recordId, ...(boardYmd ? { boardYmd } : {}) });
      if (seq !== loadSeq) return;
      /** @param {any} s @returns {Slot} */
      const slotOf = s => ({ key: s.key, label: s.label, rep: !!s.rep, name: '', dataUrl: '', aspect: 0 });
      docs.application.slots = data.slots.application.map(slotOf);
      docs.report.slots = data.slots.report.map(slotOf);
      showScoutInfo();
      fillVerifiedChoices();
      renderSlots(docs.application); renderSlots(docs.report);
      dirty = false;
      say('', 'muted');
      if (sc.verifiedId) {
        const f = sc.pdfs.find((/** @type {any} */ x) => x.id === sc.verifiedId);
        await loadVerified(sc.verifiedId, f ? f.name : 'Verified Application', seq);
      } else {
        $('appNote').className = 'hint err';
        $('appNote').textContent = 'No file with "verified" in its name in the Scout\'s folder. Choose it from the list, or from this computer.';
      }
      await loadReport(seq);
    } catch (e) { fail(e); }
  }

  $('fVerified').addEventListener('change', async () => {
    const id = $('fVerified').value;
    if (!id || !sc) return;
    const f = sc.pdfs.find((/** @type {any} */ x) => x.id === id);
    try { await loadVerified(id, f ? f.name : 'Verified Application', loadSeq); } catch (e) { fail(e); }
  });
  $('fVerifiedLocal').addEventListener('change', async () => {
    const f = $('fVerifiedLocal').files && $('fVerifiedLocal').files[0];
    if (!f || !sc) return;
    try {
      if (f.size > maxMB() * 1048576) throw new Error(`${f.name} is ${sizeText(f.size)}; the limit is ${maxMB()} MB.`);
      docs.application.verifiedId = '';
      $('fVerified').value = '';
      await openApplication(new Uint8Array(await f.arrayBuffer()), f.name, loadSeq);
    } catch (e) { fail(e); }
  });

  // ---- save ----
  /** @returns {string} the first problem, or '' */
  function problemBeforeSave() {
    if (!sc) return 'Pick a Scout.';
    if (!sc.boardYmd) return 'Pick the Board of Review date.';
    for (const d of Object.values(docs)) {
      const label = d.kind === 'application' ? 'the Verified Eagle Application' : 'the Advancement Report';
      if (!d.baseBytes) return `${label} is not open yet.`;
      for (const s of d.slots) {
        if (s.name.trim().length < 2) return `Type the name of the signer on ${label}: ${s.label}.`;
        if (!s.dataUrl) return `${s.label} (${label}) has not signed yet.`;
        if (!slotPlaced(d, s)) return `Place the signature of ${s.label} on ${label}.`;
      }
      if (!d.slots.some(s => s.rep)) return `${label}: tick "${data.repLabel}" for at least one signer.`;
    }
    return '';
  }
  /** @param {DocState} d */
  async function pdfFileFor(d) {
    const { PDFLib } = await ensurePdfLibs();
    /** @type {import('./pdfEngine.js').FreeMark[]} */
    const marks = d.marks.map(m => m.kind === 'image'
      ? { id: m.id, kind: 'image', pageIndex: m.pageIndex, x: m.x, y: m.y, width: m.width, height: m.height, png: dataUrlToBytes(m.dataUrl || '') }
      : { id: m.id, kind: 'text', pageIndex: m.pageIndex, x: m.x, y: m.y, width: m.width, height: m.height, text: m.text, ink: m.ink, fontSize: m.fontSize });
    const res = await applyMarksAndFlatten(PDFLib, { pdfBytes: /** @type {Uint8Array} */ (d.baseBytes), marks });
    if (res.pdfBytes.byteLength > maxMB() * 1048576) {
      throw new Error(`The signed ${d.kind === 'application' ? 'application' : 'Advancement Report'} is ${sizeText(res.pdfBytes.byteLength)}, over the ${maxMB()} MB limit.`);
    }
    return new File([res.pdfBytes.slice()], `${d.kind}-signed.pdf`, { type: 'application/pdf' });
  }
  $('saveBtn').addEventListener('click', async () => {
    const p = problemBeforeSave();
    if (p) { say(p, 'err'); return; }
    if (!docs.application.marks.some(m => m.kind === 'text') && !confirm('The date is not on Requirement 7 (the date boxes were removed). Save anyway?')) return;
    if ((sc.alreadySigned.application || sc.alreadySigned.report) && !confirm('Signed paperwork is already in the Scout\'s folder. Replace it? (The earlier files go to Archive.)')) return;
    const btn = $('saveBtn');
    btn.disabled = true;
    try {
      say('Checking the signers…', 'muted');
      /** @param {DocState} d */
      const signers = d => d.slots.map(s => ({ name: s.name, rep: s.rep, signed: !!s.dataUrl && slotPlaced(d, s) }));
      const st = await api('eborPaperworkStart', { session, recordId: sc.recordId, boardYmd: sc.boardYmd,
        application: signers(docs.application), report: signers(docs.report), verifiedId: docs.application.verifiedId || '' });
      say('Flattening the signed pages…', 'muted');
      const fApp = await pdfFileFor(docs.application), fRep = await pdfFileFor(docs.report);
      say(`Uploading the application (${sizeText(fApp.size)})…`, 'muted');
      await api('eborPaperworkUpload', { uploadToken: st.uploadToken, kind: 'application', name: fApp.name, data: await readBase64(fApp) });
      say(`Uploading the Advancement Report (${sizeText(fRep.size)})…`, 'muted');
      await api('eborPaperworkUpload', { uploadToken: st.uploadToken, kind: 'report', name: fRep.name, data: await readBase64(fRep) });
      say('Filing, archiving, drafting the email…', 'muted');
      const r = await api('eborPaperworkFinish', { session, uploadToken: st.uploadToken });
      dirty = false;
      try { localStorage.removeItem('ccacHome'); } catch { /* ignore */ }
      if (r.outboxId) {
        try { sessionStorage.setItem('ccacReviewDone', r.message); } catch { /* ignore */ }
        location.href = '/committee/outbox?id=' + encodeURIComponent(r.outboxId);
        return;
      }
      say(r.message, 'ok');
    } catch (e) { fail(e); }
    finally { btn.disabled = false; }
  });
  window.addEventListener('beforeunload', ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  // ---- start ----
  async function start() {
    data = await api('eborPaperworkChoices', { session });
    meLine.textContent = meText(data.me, data.testMode);
    /** @param {string} ymd */
    const nice = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : ''; };
    $('fScout').replaceChildren(el('option', { value: '', textContent: data.scouts.length ? '— Pick a Scout —' : '— No Scouts at EBoR Booked or Paused —' }),
      ...data.scouts.map((/** @type {any} */ s) => el('option', { value: s.recordId, textContent: `${s.name} (${s.unit}) · ${s.stage}${s.boardYmd ? ' · board ' + nice(s.boardYmd) + (s.boardTime ? ' ' + s.boardTime : '') : ' · no board on the schedule'}` })));
    const want = new URLSearchParams(location.search).get('r');
    $('fScout').value = (want && data.scouts.some((/** @type {any} */ s) => s.recordId === want)) ? want : (data.selected || '');
    $('fScout').addEventListener('change', () => void loadScout());
    buildInkRow($('inkRow'));
    $('app').hidden = false; $('msg').hidden = true;
    if (!data.settings.templateSet) {
      $('problems').hidden = false;
      $('problems').textContent = 'Settings → advancementReportTemplateId is empty: the blank Advancement Report cannot be loaded from Drive (you can choose it from this computer).';
    }
    showTab('application');
    await loadScout();
  }

  if (!session) needSignIn($('msg'));
  else start().catch(e => { if (isSignedOut(e)) needSignIn($('msg'), e.message); else { $('msg').textContent = e.message; $('msg').className = 'err'; } });
}
