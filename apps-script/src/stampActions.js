/**
 * Sign Workshop stamps (Task 9c). Committee members only. The stamps live in ONE Drive folder named by the Settings key
 * `stampsFolderId` (blank = no stamp button). Rules in lib/stamps.js.
 *
 * Router actions:
 *   stampList  {session}      -> {enabled, stamps: [{id, name, bytes}], skipped: [{name, bytes}]}
 *   stampFetch {session, id}  -> {name, mime, data (base64)}   (only a PNG that stampList would list)
 *
 * The list is cached for 5 minutes and a small stamp's bytes for 10 (CacheService values are limited to 100 KB, so
 * bigger stamps are read from Drive each time; the page also keeps them in memory for the session).
 */
var STAMP_LIST_CACHE_SECONDS = 300;
var STAMP_DATA_CACHE_SECONDS = 600;
var STAMP_DATA_CACHE_MAX_CHARS = 90000;

/** The stamps folder's PNG list (cached). Returns {enabled, stamps, skipped}. */
function stampList_() {
  var folderId = String(getSettings_().stampsFolderId || '').trim();
  if (!folderId) return { enabled: false, stamps: [], skipped: [] };
  var cache = CacheService.getScriptCache();
  var key = 'stamps:' + folderId;
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fall through to Drive */ }
  }
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw userError_('The stamps folder could not be opened. Check the stampsFolderId setting and that the tool\'s account can see that folder.');
  }
  var files = listFolder_(folder).map(function (x) {
    return { id: String(x.id), name: String(x.name || ''), mime: String(x.file.getMimeType() || ''), bytes: Number(x.file.getSize()) || 0 };
  });
  var out = Stamps.list(files, Stamps.MAX_BYTES);
  var res = { enabled: true, stamps: out.stamps, skipped: out.skipped };
  try { cache.put(key, JSON.stringify(res), STAMP_LIST_CACHE_SECONDS); } catch (e) { /* too big or cache down: fine */ }
  return res;
}

function actionStampList_(req) {
  committeeMe_(req.session);
  return stampList_();
}

function actionStampFetch_(req) {
  committeeMe_(req.session);
  var id = String(req.id || '').trim();
  if (!id) throw userError_('Pick a stamp.');
  var listed = stampList_();
  var hit = listed.stamps.filter(function (s) { return s.id === id; })[0];
  if (!hit) throw userError_('That stamp is not in the stamps folder (it may have been moved or is over 2 MB). Reload the page.');
  var cache = CacheService.getScriptCache();
  var dkey = 'stampdata:' + id;
  var cached = cache.get(dkey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* read from Drive */ }
  }
  var file = DriveApp.getFileById(id);
  var bytes = file.getBlob().getBytes();
  if (!Stamps.isPngBytes(bytes)) throw userError_(hit.name + ' is not a valid PNG image.');
  var out = { name: hit.name, mime: 'image/png', data: Utilities.base64Encode(bytes) };
  if (out.data.length <= STAMP_DATA_CACHE_MAX_CHARS) {
    try { cache.put(dkey, JSON.stringify(out), STAMP_DATA_CACHE_SECONDS); } catch (e) { /* ignore */ }
  }
  return out;
}
