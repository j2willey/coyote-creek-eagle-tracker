/**
 * Stamps (Sign Workshop v2, Task 9c): pure rules for the stamp images the committee keeps in ONE Drive folder
 * (Settings `stampsFolderId`). A stamp is a PNG, at most 2 MB, ideally with a transparent background. No stamp images
 * live in the repo.
 */
var Stamps = (function () {
  var MAX_BYTES = 2 * 1024 * 1024;

  function str(v) { return v == null ? '' : String(v).trim(); }

  /** True when the file name or MIME type says PNG. */
  function isPngFile(f) {
    return /\.png$/i.test(str(f && f.name)) || str(f && f.mime).toLowerCase() === 'image/png';
  }

  /** True when the bytes start with the PNG signature (89 50 4E 47). */
  function isPngBytes(bytes) {
    if (!bytes || bytes.length < 8) return false;
    var b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255, b3 = bytes[3] & 255;
    return b0 === 137 && b1 === 80 && b2 === 78 && b3 === 71;
  }

  /**
   * files: [{id, name, mime, bytes}] in the stamps folder.
   * -> { stamps: [{id, name, bytes}] sorted by name, skipped: [{name, bytes}] (PNGs over the limit) }.
   * Other file types are ignored silently.
   */
  function list(files, maxBytes) {
    var limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BYTES;
    var stamps = [];
    var skipped = [];
    (files || []).forEach(function (f) {
      if (!f || !str(f.id) || !isPngFile(f)) return;
      var bytes = Math.max(0, Number(f.bytes) || 0);
      if (bytes > limit) { skipped.push({ name: str(f.name), bytes: bytes }); return; }
      stamps.push({ id: str(f.id), name: str(f.name), bytes: bytes });
    });
    var byName = function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; };
    stamps.sort(byName);
    skipped.sort(byName);
    return { stamps: stamps, skipped: skipped };
  }

  /** "2.4 MB" style size for the "skipped" note. */
  function sizeText(bytes) {
    var mb = Number(bytes) / 1048576;
    return (Math.round(mb * 10) / 10) + ' MB';
  }

  return { MAX_BYTES: MAX_BYTES, isPngFile: isPngFile, isPngBytes: isPngBytes, list: list, sizeText: sizeText };
})();

if (typeof module !== 'undefined') module.exports = Stamps;
