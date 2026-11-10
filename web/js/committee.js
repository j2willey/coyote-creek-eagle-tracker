// Shared bits of the committee pages (/committee, /committee/schedule, /committee/outbox, /committee/review):
// the session, the top-bar nav, sign-out, and a "please sign in" message.
import { api } from './api.js';

export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export let session = null;
try { session = localStorage.getItem('ccacSession'); } catch {}

// The bar holds VIEWS only (Jim W., 2026-11-05, option B); actions sit next to each page's title (renderNav's
// `actions`). "Review outcome" is an action now (Record outcomes), so it has no tab; its page stays.
const PAGES = [
  ['home', '/committee', 'Dashboard'],
  ['schedule', '/committee/schedule', 'Schedule'],
  ['outbox', '/committee/outbox', 'Outbox'],
  ['units', '/committee/units', 'Units'],
  ['stats', '/committee/stats', 'Stats'],
  ['admin', '/committee/admin', 'Admin']
];
const OB_KEY = 'ccacOutboxN', REV_KEY = 'ccacReviewN';   // last counts seen, so every page can show them at once

const ICONS = {
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}
const stored = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };

/**
 * A page action next to the title: a link (href) or a button (onClick). primary: the main one. count: 'review'
 * shows the number of reviews waiting for an outcome (kept current by setReviewCount).
 */
export function actionButton({ label, href, onClick, icon: ic, primary, count, title, id }) {
  const b = href ? el('a', { href }) : el('button', { type: 'button' });
  b.className = 'actbtn' + (primary ? ' primary' : '');
  if (id) b.id = id;
  if (title) b.title = title;
  if (ic) b.append(icon(ic));
  b.append(label);
  if (count === 'review') { const n = stored(REV_KEY); b.append(el('span', { className: 'badge revcount', textContent: String(n), hidden: !n })); }
  if (onClick) b.onclick = onClick;
  return b;
}

/**
 * The committee bar (views as tabs, Outbox count, the member's menu with Sign out) above the page; `holder` (the
 * page's <nav id="cnav"> beside its <h1>) becomes the page's action area. Returns the element for the member's name.
 */
export function renderNav(holder, active, actions = []) {
  const me = el('span', { id: 'meLine' });
  const out = el('button', { type: 'button', className: 'linkbtn', textContent: 'Sign out' });
  out.onclick = async () => {
    try { Object.keys(localStorage).filter(k => k.startsWith('ccac')).forEach(k => localStorage.removeItem(k)); } catch {}
    try { await api('signOut', { session }); } catch {}
    location.href = '/signin';
  };
  const menu = el('details', { className: 'medrop' }, el('summary', {}, me), el('div', { className: 'medrop-pop' }, out));
  document.addEventListener('click', (ev) => { if (menu.open && !menu.contains(ev.target)) menu.open = false; });
  const tabs = el('div', { className: 'cbar-tabs' }, ...PAGES.map(([key, href, label]) => {
    const a = el('a', { href, className: 'cbar-tab' + (key === active ? ' on' : '') }, label);
    if (key === active) a.setAttribute('aria-current', 'page');
    if (key === 'outbox') a.append(el('span', { className: 'badge obcount', hidden: true }));
    return a;
  }));
  const bar = el('nav', { className: 'cbar' }, tabs, menu);
  bar.setAttribute('aria-label', 'Committee pages');
  const top = holder.closest('.topbar') || holder.parentNode;
  top.parentNode.insertBefore(bar, top);
  holder.replaceWith(el('div', { className: 'pageacts', id: 'pageActs' }, ...actions));
  setOutboxCount(stored(OB_KEY));
  return me;
}

/** Outbox emails waiting: the badge on the Outbox tab (and remembered for the other pages). */
export function setOutboxCount(n) {
  n = Number(n) || 0;
  try { localStorage.setItem(OB_KEY, String(n)); } catch {}
  document.querySelectorAll('.badge.obcount').forEach(b => { b.textContent = String(n); b.hidden = !n; });
}

/** Reviews waiting for an outcome: the badge on every "Record outcomes" button. */
export function setReviewCount(n) {
  n = Number(n) || 0;
  try { localStorage.setItem(REV_KEY, String(n)); } catch {}
  document.querySelectorAll('.badge.revcount').forEach(b => { b.textContent = String(n); b.hidden = !n; });
}

export function meText(me, testMode) {
  return (me.name || me.email) + (me.initials ? ' (' + me.initials + ')' : '') + (testMode ? ' · test mode' : '');
}

/** No session, or the server said signed out: show a sign-in link and remember where to come back to. */
export function needSignIn(msgEl, error) {
  try { localStorage.setItem('ccacNext', location.pathname + location.search); } catch {}
  msgEl.hidden = false;
  msgEl.className = error ? 'err' : 'muted';
  msgEl.replaceChildren(error ? error + ' ' : 'Please ', el('a', { href: '/signin', textContent: error ? 'Sign in →' : 'sign in' }),
    error ? '' : ' with the email address on the committee list.');
}

export const isSignedOut = (e) => /signed out/i.test(String(e && e.message || e));
