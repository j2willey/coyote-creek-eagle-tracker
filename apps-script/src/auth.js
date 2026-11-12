/**
 * Sign-in adapter (M2): CacheService for short-lived link tokens and rate
 * limits, the hidden _Sessions tab for hashed sessions. Rules live in
 * lib/identity.js.
 *
 * Router actions:
 *   requestLink {email}        -> always the same neutral reply (on file: sign-in link; not on file: Proposal link)
 *   redeemLink  {token, browser, agent} -> {session, email} | {mismatch, message} (enforce mode) | error "expired"
 *   freshLink   {token, browser, agent} -> {message}   after a mismatch: a new link to the address on file, for this browser
 *   redeemCode  {code, browser, agent}  -> like redeemLink: the 6-digit code from the email, typed where the link was asked for
 *   whoami      {session}      -> {email, records:[{recordId, scoutName, status}]}
 *   signOut     {session}      -> {}
 */
var SESSIONS_TAB = '_Sessions';

function hash_(token) {
  var salt = PropertiesService.getScriptProperties().getProperty('HASH_SALT');
  if (!salt) throw new Error('HASH_SALT missing: run Admin → Setup / repair tabs');
  return Identity.bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + token));
}

function actionRequestLink_(req) {
  var email = Identity.normalizeEmail(req.email);
  // codeEntry: the page shows a box for the emailed code (same for every address: reveals nothing).
  var reply = { message: Identity.NEUTRAL_REPLY, codeEntry: getSettings_().signinCode === true };
  if (!Identity.isValidEmail(email)) return reply;          // same answer: reveal nothing

  var cache = CacheService.getScriptCache();
  var now = Date.now();
  var rlKey = 'rl:' + email;
  if (!Identity.rateLimitOk(cache.get(rlKey), now)) return reply;
  cache.put(rlKey, String(now), Math.ceil(Identity.RATE_LIMIT_MS / 1000));

  // On file: a Scout record, a Unit Contact (EBoR), the Committee tab (any role): lib/access.js.
  if (!whoIs_(email).onFile) {
    // Not on file. A submission still waiting for its (old-style) confirmation gets that link again; otherwise
    // the address gets a link to start a first-time Proposal (email-first intake, Jim W. 2026-10-28).
    if (!resendIntakeConfirmation_(email)) sendStartLink_(email);
    return reply;
  }

  sendSignInLink_(email, Identity.cleanBrowserId(req.browser), req.agent);
  return reply;
}

/**
 * Email a one-time sign-in link. browserId: the asking browser's id ('' = none), kept as a hash with the link so the
 * opening browser can be compared (Identity.browserCheck); agent: its user agent, for the _SignIns log.
 */
function sendSignInLink_(email, browserId, agent) {
  var s = getSettings_();
  var cache = CacheService.getScriptCache();
  var token = Identity.makeToken(Utilities.getUuid);
  var minutes = Math.min(Number(s.linkMinutes) || 60, 360); // CacheService max is 6 h
  var bHash = browserId ? hash_(browserId) : '';
  cache.put('lt:' + token, JSON.stringify({ email: email, b: bHash, a: Identity.describeAgent(agent) }), minutes * 60);
  // Settings signinCode: a 6-digit code too, kept for the asking browser only (one waiting code per browser).
  var code = '';
  if (s.signinCode === true && bHash) {
    code = Identity.makeCode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid()));
    cache.put('lc:' + bHash, JSON.stringify({ email: email, codeHash: hash_(code), token: token, tries: 0,
      exp: Date.now() + minutes * 60000, a: Identity.describeAgent(agent) }), minutes * 60);
  }
  var shown = code ? code.slice(0, 3) + ' ' + code.slice(3) : '';
  var mail = Identity.linkEmail(Identity.linkUrl(s.webOrigin, token), minutes, shown);
  mailFromTemplate_('Sign-in link', { link: Identity.linkUrl(s.webOrigin, token), minutes: String(minutes), code: shown },
    { to: email, subject: mail.subject, body: mail.body, kind: 'signin' });
}

/** The 6-digit code from the sign-in email, typed on the page that asked (Settings signinCode). 5 tries, then dead. */
function actionRedeemCode_(req) {
  var code = Identity.cleanCode(req.code);
  if (!code) throw userError_('Type the 6 digits from the email.');
  var given = Identity.cleanBrowserId(req.browser);
  if (!given) throw userError_('This browser can\'t keep a sign-in (a private window, or site data blocked?). Use the link in the email instead.');
  var key = 'lc:' + hash_(given);
  var cache = CacheService.getScriptCache();
  var out = withLock_(function () {
    var raw = cache.get(key);
    if (!raw) return { err: 'No sign-in code is waiting for this browser (it expired or was already used). Ask for a new link above.' };
    var p = JSON.parse(raw);
    var t = Identity.codeTry(p, hash_(code));
    if (t.ok || t.dead) { cache.remove(key); cache.remove('lt:' + p.token); }   // the link and the code are one sign-in
    if (t.ok) return { email: p.email, a: p.a };
    if (t.dead) return { err: 'Too many wrong codes. Ask for a new link above.' };
    var secs = Math.floor((Number(p.exp) - Date.now()) / 1000);
    if (secs > 1) cache.put(key, JSON.stringify(Object.assign({}, p, { tries: t.tries })), secs);
    return { err: 'That code is not right. ' + t.left + (t.left === 1 ? ' try' : ' tries') + ' left.' };
  });
  if (out.err) throw userError_(out.err);
  logSignIn_(out.email, { result: 'code', allow: true }, out.a || '', Identity.describeAgent(req.agent));
  var session = startSession_(out.email);
  var payload = mePayload_(out.email);
  payload.session = session;
  return payload;
}

function actionRedeemLink_(req) {
  var token = String(req.token || '');
  if (!Identity.isTokenShape(token)) throw userError_('That link is not valid. Request a new one.');
  var cache = CacheService.getScriptCache();
  var mode = getSettings_().linkBrowserCheck;
  var given = Identity.cleanBrowserId(req.browser);
  var got = withLock_(function () {                         // read + use up together: two clicks at once can't both get in
    var raw = cache.get('lt:' + token);
    if (!raw) return null;
    var x = JSON.parse(raw);
    var chk = Identity.browserCheck(x.b || '', given ? hash_(given) : '', mode);
    if (chk.allow) { cache.remove('lt:' + token); if (x.b) cache.remove('lc:' + x.b); }   // single use (its code too)
    return { x: x, chk: chk };
  });
  if (!got) throw userError_('That link has expired or was already used. Request a new one.');
  logSignIn_(got.x.email, got.chk, got.x.a || '', Identity.describeAgent(req.agent));
  if (!got.chk.allow) {
    return { mismatch: true, message: 'This sign-in link was asked for on a different browser or device. For your security it only ' +
      'works there. Use the button to get a fresh link for this browser: it goes to the email address on file.' +
      (getSettings_().signinCode === true ? ' Or, if the page where you asked is still open, type the 6-digit code from the email there.' : '') };
  }

  var email = got.x.email;
  var session = startSession_(email);
  // Everything the signed-in page shows, in the same reply (saves a second round trip of several seconds).
  var out = mePayload_(email);
  out.session = session;
  return out;
}

/**
 * Enforce mode, after a mismatch: "Send a fresh link to this browser". The new link goes to the address on file for the
 * old link (never to one the visitor types), so a forwarded link is useless to whoever received it. Uses up the old link.
 */
function actionFreshLink_(req) {
  var token = String(req.token || '');
  if (!Identity.isTokenShape(token)) throw userError_('That link is not valid. Enter your email for a new one.');
  var given = Identity.cleanBrowserId(req.browser);
  if (!given) throw userError_('This browser can\'t keep a sign-in (a private window, or site data blocked?). Open the site in a normal window and ask for a link there.');
  var cache = CacheService.getScriptCache();
  var x = withLock_(function () {
    var raw = cache.get('lt:' + token);
    if (raw) cache.remove('lt:' + token);
    return raw ? JSON.parse(raw) : null;
  });
  if (!x) throw userError_('That link has expired or was already used. Enter your email for a new one.');
  sendSignInLink_(x.email, given, req.agent);
  return { message: 'We emailed a fresh sign-in link to the address on file. Open it on this device, in this same app or browser.' };
}

/** _SignIns (hidden): one row per link opened, for judging the same-browser check. Never blocks a sign-in. */
var SIGNINS_TAB = '_SignIns';
function logSignIn_(email, chk, askedOn, openedOn) {
  if (chk.result === 'off') return;
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(SIGNINS_TAB);
    if (!sh) {
      sh = ss.insertSheet(SIGNINS_TAB);
      sh.appendRow(['When', 'Email', 'Result', 'Allowed', 'Asked on', 'Opened on']);
      sh.setFrozenRows(1);
      sh.hideSheet();
    }
    sh.appendRow([new Date(), email, chk.result, chk.allow ? 'yes' : 'NO', askedOn, openedOn]);
  } catch (e) { console.warn('logSignIn_: ' + e); }
}

/**
 * Who an email address is (lib/access.js): its Scout records, units, Committee row (any role, Support included),
 * Admin / Support. The one identity check: sign-in, the signed-in page, the committee and Admin pages.
 */
function whoIs_(email) {
  var e = Identity.normalizeEmail(email);
  var s = getSettings_();
  return Access.whoIs({ email: e, records: e ? Records.findByEmail(e) : [], units: e ? Units.forEmail(units_(), e) : [],
    committee: committeeAll_(), settings: s, signatures: e ? openSignaturesFor_(e) : [] });
}

/** New browser session for a proven email address. Returns the token (only its hash is stored). */
function startSession_(email) {
  var w = whoIs_(email);
  var session = Identity.makeToken(Utilities.getUuid);
  var s = getSettings_();
  var days = w.member ? (Number(s.committeeSessionDays) || 30) : (Number(s.sessionDays) || 14);
  var row = Identity.newSessionRow(hash_(session), email, w.records, Date.now(), days);
  withLock_(function () { sessionsSheet_().appendRow(row); });
  return session;
}

function actionWhoami_(req) {
  var found = findSession_(req.session);
  if (!found) throw userError_('Signed out. Request a new sign-in link.');
  var email = String(found.row[1]);
  // Last seen: at most once an hour (a write on every page load is slow).
  var seen = found.row[5] instanceof Date ? found.row[5].getTime() : new Date(found.row[5]).getTime();
  if (!(Date.now() - seen < 3600 * 1000)) {
    var fresh = findSession_(req.session, true);
    if (fresh) { sessionsSheet_().getRange(fresh.index + 2, 6).setValue(new Date()); uncache_('s:' + hash_(req.session)); }
  }
  return mePayload_(email);
}

/** What the signed-in page shows for an email: Scout records, units, committee role. */
function mePayload_(email) {
  var settings = getSettings_();
  var w = whoIs_(email);
  var records = w.records.map(function (id) {
    var r = Records.get(id);
    return { recordId: id, scoutName: r ? r.fields.scout_name : '',
             status: r ? scoutStatusOf_(settings, r) : '' };
  });
  var units = w.units.map(function (u) { return { unit: u.unit, underReview: u.underReview }; });
  var m = w.member;
  // EBoR paperwork waiting for this address's signature (remote signing): one entry per Scout, for /sign.
  var sig = {};
  w.signatures.forEach(function (r) { sig[r.recordId] = sig[r.recordId] || { recordId: r.recordId, scout: r.scout }; });
  return { email: email, records: records, units: units, signatures: Object.keys(sig).map(function (k) { return sig[k]; }),
    committee: m ? { name: String(m.name || ''), initials: String(m.initials || ''), admin: w.admin, support: w.support } : null };
}

function actionSignOut_(req) {
  if (!Identity.isTokenShape(req.session)) return {};
  uncache_('s:' + hash_(req.session));
  withLock_(function () {
    var found = findSession_(req.session, true);
    if (found) sessionsSheet_().deleteRow(found.index + 2);
  });
  return {};
}

/**
 * The session's row, or null (missing / expired). Cached for a few minutes so each page
 * load doesn't read the whole _Sessions tab; fresh = read the tab (needed for its row number).
 */
function findSession_(session, fresh) {
  if (!Identity.isTokenShape(session)) return null;
  var h = hash_(session);
  var load = function () {
    var sh = sessionsSheet_();
    var n = sh.getLastRow() - 1;
    if (n < 1) return null;
    return Identity.findSession(sh.getRange(2, 1, n, 6).getValues(), h, Date.now());
  };
  if (fresh) return load();
  var hit = cached_('s:' + h, function () { var f = load(); return f ? { index: f.index, row: f.row } : { none: true }; }, 600);
  if (!hit || hit.none) { uncache_('s:' + h); return null; }
  return Identity.findSession([hit.row], h, Date.now()) ? hit : null;   // expiry still checked every time
}

function sessionsSheet_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SESSIONS_TAB);
  if (!sh) throw new Error('No _Sessions tab: run Admin → Setup / repair tabs');
  return sh;
}

/** Errors whose message is safe to show the user (router passes it through). */
function userError_(msg) { var e = new Error(msg); e.userMessage = msg; return e; }
