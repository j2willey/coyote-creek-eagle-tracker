/**
 * Identity (M2): pure rules for sign-in links and sessions.
 *
 * Flow (solution-options.md, element 1):
 *  1. requestLink(email): if the address is on file, email a single-use link
 *     (valid linkMinutes). The page ALWAYS gets the same answer, so it can't
 *     be used to discover who is in the system. One request per address per
 *     RATE_LIMIT_MS.
 *  2. redeemLink(token): the link token is consumed and a session token is
 *     issued (valid sessionDays). Only a SHA-256 hash of the session token is
 *     stored (_Sessions tab); the browser keeps the token itself.
 *  3. whoami(session): look up the hash; expired = signed out.
 *
 * This module is the seam for Scouting America SSO later: only how an email
 * gets proven changes; sessions and everything after stay the same.
 */
var Identity = (function () {
  var RATE_LIMIT_MS = 5 * 60 * 1000;
  // Same answer whether or not the address is on file (email-first intake, 2026-10-28): on file → sign-in link,
  // not on file → a link to start a Proposal. Never reveals which.
  var NEUTRAL_REPLY = 'Check your email: we have sent you a link. It can take a minute or two; check spam too.';

  function normalizeEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }

  function isValidEmail(e) {
    var s = normalizeEmail(e);
    return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  }

  /** lastMs: time of the previous request for this address (or null). */
  function rateLimitOk(lastMs, nowMs, windowMs) {
    if (lastMs == null || lastMs === '') return true;
    return (nowMs - Number(lastMs)) >= (windowMs || RATE_LIMIT_MS);
  }

  /** Tokens are random hex; uuidFn returns a UUID string (Utilities.getUuid in Apps Script). */
  function makeToken(uuidFn) {
    return (uuidFn() + uuidFn()).replace(/-/g, '').toLowerCase();
  }

  function isTokenShape(t) { return /^[0-9a-f]{64}$/.test(String(t || '')); }

  /** bytes: array of signed bytes (Utilities.computeDigest) -> hex string. */
  function bytesToHex(bytes) {
    return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
  }

  function linkUrl(webOrigin, token) {
    var base = String(webOrigin || '').replace(/\/+$/, '');
    if (!base) throw new Error('Settings → webOrigin is empty (e.g. https://<project>.web.app)');
    return base + '/signin?t=' + encodeURIComponent(token);
  }

  /** Address not on file: a link to start a first-time Proposal (email-first-intake-design.md). */
  function startEmail(url, hours) {
    return {
      subject: 'Your Coyote Creek Eagle Project Proposal link',
      body: 'This email address is not on file with the Coyote Creek District Advancement Committee.\n\n' +
            'Scouts: to submit your Eagle Project Proposal for district review, use this link:\n\n' + url + '\n\n' +
            'It works for ' + hours + ' hours.\n\n' +
            'Already submitted a Proposal before (on this site, by email or on the old sign-up sheet)? Please do not submit ' +
            'again: request a sign-in link with the email address you used then, or reply to this email.\n\n' +
            'Parents and guardians: you are copied on every email we send your Scout; your Scout signs in with their own ' +
            'email address.\n\n' +
            'Adult leaders: this address is not on file as an authorized unit leader or committee member. If you think it ' +
            'should be, check with your unit leader or reply to this email.\n\n' +
            'If you did not ask for this, ignore this email.\n\nCoyote Creek District Advancement Committee'
    };
  }

  function linkEmail(url, minutes, code) {
    return {
      subject: 'Your Coyote Creek Eagle sign-in link',
      body: 'Use this link to sign in to the Coyote Creek District Eagle Project page:\n\n' + url + '\n\n' +
            (code ? 'Or type this code on the page where you asked for the link: ' + code + '\n\n' : '') +
            'It works once and expires in ' + minutes + ' minutes. It signs in as you, so please don\'t forward it. ' +
            'If you did not ask for it, ignore this email.\n\n' +
            'Coyote Creek District Advancement Committee'
    };
  }

  /**
   * Sign-in code (Jim W., 2026-10-29; Settings signinCode): a 6-digit code in the sign-in email, typed on the page
   * that asked for it. Works when the link would open in another browser (an iPhone email app's own browser).
   * bytes: random signed bytes (Utilities.computeDigest of a UUID) -> '000000'..'999999'.
   */
  function makeCode(bytes) {
    var n = 0;
    for (var i = 0; i < 4; i++) n = n * 256 + ((bytes[i] + 256) % 256);
    return ('00000' + (n % 1000000)).slice(-6);
  }
  var CODE_TRIES = 5;
  /** Typed code -> digits only ('123 456' -> '123456'); '' unless exactly 6 digits. */
  function cleanCode(v) { var d = String(v || '').replace(/[\s-]/g, ''); return /^\d{6}$/.test(d) ? d : ''; }
  /**
   * One try at a pending code. pending: {codeHash, tries}; givenHash: hash of the typed code.
   * -> {ok, tries (after this one), left, dead (retire the code)}
   */
  function codeTry(pending, givenHash) {
    var tries = (Number(pending && pending.tries) || 0) + 1;
    var ok = !!(pending && givenHash && pending.codeHash === givenHash);
    return { ok: ok, tries: tries, left: Math.max(0, CODE_TRIES - tries), dead: !ok && tries >= CODE_TRIES };
  }

  /** Session row for the _Sessions tab: [hash, email, recordIds, created, expires, lastSeen]. */
  function newSessionRow(hash, email, recordIds, nowMs, days) {
    var now = new Date(nowMs);
    return [hash, normalizeEmail(email), (recordIds || []).join(','), now,
            new Date(nowMs + days * 24 * 3600 * 1000), now];
  }

  /** rows: _Sessions values without header. Returns { index, row } or null if missing/expired. */
  function findSession(rows, hash, nowMs) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === hash) {
        var exp = rows[i][4] instanceof Date ? rows[i][4].getTime() : new Date(rows[i][4]).getTime();
        if (!(exp > nowMs)) return null;
        return { index: i, row: rows[i] };
      }
    }
    return null;
  }

  /** Indexes (0-based, no header) of expired sessions, for cleanup. */
  function expiredIndexes(rows, nowMs) {
    var out = [];
    rows.forEach(function (r, i) {
      var exp = r[4] instanceof Date ? r[4].getTime() : new Date(r[4]).getTime();
      if (!(exp > nowMs)) out.push(i);
    });
    return out;
  }

  /**
   * Same-browser check for sign-in links (Jim W., 2026-10-29): the page that asks for a link sends a random per-browser
   * id; the server keeps its hash with the link; the page that opens the link sends its id again. A forwarded link then
   * opens in a browser that never asked. mode (Settings linkBrowserCheck): 'off' | 'log' (record only, the default
   * for the first weeks) | 'enforce'. storedHash: '' for links sent before the check existed; givenHash: '' when the
   * opening browser has no id (private window, storage cleared).
   * -> {result: 'match' | 'mismatch' | 'no-id' | 'old-link' | 'off', allow}
   */
  function browserCheck(storedHash, givenHash, mode) {
    var m = String(mode || 'log').trim().toLowerCase();
    if (m === 'off') return { result: 'off', allow: true };
    var result = !storedHash ? 'old-link' : !givenHash ? 'no-id' : storedHash === givenHash ? 'match' : 'mismatch';
    return { result: result, allow: m !== 'enforce' || result === 'match' || result === 'old-link' };
  }

  /** A browser id the page sent: 16-64 characters of [A-Za-z0-9-]; anything else counts as none. */
  function cleanBrowserId(v) { var x = String(v || ''); return /^[A-Za-z0-9-]{16,64}$/.test(x) ? x : ''; }

  /**
   * Short, readable device + browser for the sign-in log ("iPhone · Safari", "iPhone · in-app (Gmail?)",
   * "Android · Chrome", "Windows · Edge"). Best effort: an iPhone app's built-in browser often looks exactly like Safari.
   */
  function describeAgent(ua) {
    var u = String(ua || '');
    if (!u) return '';
    var dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /CrOS/.test(u) ? 'Chromebook'
      : /Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'other';
    var ios = dev === 'iPhone' || dev === 'iPad';
    var app = /GSA\//.test(u) ? 'Google app' : /FBAN|FBAV/.test(u) ? 'Facebook app' : /Instagram/.test(u) ? 'Instagram app'
      : /\bwv\)/.test(u) ? 'in-app (Android)' : '';
    var br = app || (/EdgA?\/|EdgiOS/.test(u) ? 'Edge' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /FxiOS|Firefox\//.test(u) ? 'Firefox'
      : ios && !/Safari\//.test(u) ? 'in-app (Gmail/Outlook?)' : /Safari\//.test(u) ? 'Safari' : 'other');
    return dev + ' · ' + br;
  }

  return {
    RATE_LIMIT_MS: RATE_LIMIT_MS, makeCode: makeCode, cleanCode: cleanCode, codeTry: codeTry, CODE_TRIES: CODE_TRIES, browserCheck: browserCheck, cleanBrowserId: cleanBrowserId, describeAgent: describeAgent,
    NEUTRAL_REPLY: NEUTRAL_REPLY,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    rateLimitOk: rateLimitOk,
    makeToken: makeToken,
    isTokenShape: isTokenShape,
    bytesToHex: bytesToHex,
    linkUrl: linkUrl,
    linkEmail: linkEmail,
    startEmail: startEmail,
    newSessionRow: newSessionRow,
    findSession: findSession,
    expiredIndexes: expiredIndexes
  };
})();

if (typeof module !== 'undefined') module.exports = Identity;
