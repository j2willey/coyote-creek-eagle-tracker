/**
 * Speed (2026-10-21): every spreadsheet read is a slow remote call, so
 *  - within one request, each tab is read once (Records / schedule memos, cleared on writes and on withLock_);
 *  - across requests, slow-changing tabs are kept in the script cache for a few minutes
 *    (Settings, Committee, unit contacts, sign-in sessions), cleared when a member edits those tabs
 *    (onTrackingEdit) or a script writes them.
 */
var CACHE_TTL_S = 300;
var CACHE_KEYS_BY_TAB = {
  'Settings': ['c:settings'],
  'Committee': ['c:committee'],
  'Key 3': ['c:units'], 'Unit Contacts': ['c:units'], 'Unit Info': ['c:units']
};

/** fn() result, from the script cache when fresh. Values must be JSON-safe. Never throws for cache trouble. */
function cached_(key, fn, ttl) {
  var cache = null, hit = null;
  try { cache = CacheService.getScriptCache(); hit = cache.get(key); } catch (e) {}
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var v = fn();
  try { var s = JSON.stringify(v); if (cache && s.length < 90000) cache.put(key, s, ttl || CACHE_TTL_S); } catch (e) {}
  return v;
}

function uncache_(keys) {
  try { CacheService.getScriptCache().removeAll([].concat(keys)); } catch (e) {}
}

/** A member edited a tab: drop what the cache holds from it. */
function uncacheTab_(sheetName) {
  var k = CACHE_KEYS_BY_TAB[sheetName];
  if (k) uncache_(k);
}

/** Per-request memos (schedule sheet, tracking tab). Cleared when a write starts or ends. */
function clearMemos_() {
  try { Records.invalidate(); } catch (e) {}
  readSchedule_._memo = null;
}
