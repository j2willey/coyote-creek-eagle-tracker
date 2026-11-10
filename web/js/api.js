// One fetch wrapper for every page. Apps Script can't answer a CORS preflight,
// so we POST text/plain (a "simple request"); the script parses the JSON body.
import { API_URL, ENV } from './config.js';

export async function api(action, data = {}) {
  if (!API_URL || API_URL.includes('PASTE')) throw new Error('API_URL not set for ' + (ENV || 'host ' + location.hostname) + ' in web/js/config.js');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...data }),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('Network error (' + res.status + ')');
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'Request failed');
  return out;
}

/**
 * A random id for this browser (Jim W., 2026-10-29): sent when asking for a sign-in link and again when the link is
 * opened, so the server can tell a forwarded link (Settings linkBrowserCheck). '' when storage is unavailable.
 * The key doesn't start with "ccac" so signing out (which clears ccac* keys) keeps it.
 */
export function browserId() {
  try {
    let v = localStorage.getItem('eagleBrowserId');
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
      localStorage.setItem('eagleBrowserId', v);
    }
    return v;
  } catch { return ''; }
}
/** What signIn/redeem calls send along: this browser's id and its user agent. */
export const browserInfo = () => ({ browser: browserId(), agent: navigator.userAgent });

