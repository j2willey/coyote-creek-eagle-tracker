/**
 * Signatures (Jim W., 2026-11-12; vault ebor-remote-signing-design.md, phase 1): the ledger of who signs which box of a
 * Scout's EBoR paperwork when it can't all be signed in the room. Pure.
 *
 * Hidden tab `_Signatures`, one row per signer per paperwork run ("series", one Request ID):
 *  - signed in the room (Save partial): Status Signed, Email blank;
 *  - asked to sign later (Send for signatures): Status Pending, with the signer's email. A pending, unexpired row puts
 *    that email "on file" (lib/access.js): it can sign in, and sees that Scout's paperwork only, only while pending.
 * Rows are found by Row ID (`SG-...`), never by row number. Finish stamps Filed on every row of the series.
 *
 * Slot keys: `application:chair`, `application:rep`, `report:Signature1..3` (EborPaperwork.signerSlots).
 * Names and emails are runtime data: nothing here is a real person's.
 */
var Signatures = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  function E() { return (typeof EborPaperwork !== 'undefined') ? EborPaperwork : require('./eborPaperwork'); }
  var DAY = 86400000;

  var TAB = '_Signatures';
  var HEADERS = ['Row ID', 'Request ID', 'Record ID', 'Scout', 'Email', 'Name', 'Slots', 'Rep', 'Status', 'Asked by', 'Asked',
    'Signed', 'Expires', 'Filed', 'Note'];
  var STATUS = { pending: 'Pending', signed: 'Signed', cancelled: 'Cancelled' };
  var DOCS = ['application', 'report'];
  var DOC_LABEL = { application: 'Eagle Application (Requirement 7)', report: 'Advancement Report' };

  /** Every slot key, in page order. */
  function slotKeys() {
    var out = [];
    DOCS.forEach(function (d) { E().signerSlots(d).forEach(function (s) { out.push(d + ':' + s.key); }); });
    return out;
  }

  /** 'application:chair' -> 'Eagle Application (Requirement 7): Board of review chair' ('' if unknown). */
  function slotLabel(key) {
    var p = str(key).split(':'), slot = E().signerSlots(p[0]).filter(function (s) { return s.key === p[1]; })[0];
    return slot ? DOC_LABEL[p[0]] + ': ' + slot.label : '';
  }

  /** "application:chair, report:Signature1" <-> ['application:chair', 'report:Signature1'] (unknown keys dropped). */
  function parseSlots(cell) {
    var known = slotKeys();
    var out = [];
    str(cell).split(/[\s,;]+/).forEach(function (k) { if (known.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
    return out;
  }
  function slotsText(list) { return (list || []).join(', '); }

  function ms(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    var t = new Date(str(v)).getTime();
    return isNaN(t) ? 0 : t;
  }
  function isTrue(v) { return v === true || /^(true|yes|y|1)$/i.test(str(v)); }

  /** Tab rows (Tabs.read) -> [{row, id, requestId, recordId, scout, email, name, slots, rep, status, askedBy, asked, signed, expires, filed, note}] */
  function list(rows) {
    return (rows || []).filter(function (r) { return str(r['Row ID']); }).map(function (r) {
      return { row: r._row, id: str(r['Row ID']), requestId: str(r['Request ID']), recordId: str(r['Record ID']), scout: str(r['Scout']),
        email: str(r['Email']).toLowerCase(), name: str(r['Name']), slots: parseSlots(r['Slots']), rep: isTrue(r['Rep']),
        status: str(r['Status']) || STATUS.pending, askedBy: str(r['Asked by']), asked: ms(r['Asked']), signed: ms(r['Signed']),
        expires: ms(r['Expires']), filed: ms(r['Filed']), note: str(r['Note']) };
    });
  }

  function isOpen(r, now) { return r.status === STATUS.pending && !r.filed && !!r.email && r.expires > now; }

  /** Pending, unexpired, unfiled rows for this email (what it may sign). */
  function openFor(all, email, now) {
    var e = str(email).toLowerCase();
    return e ? (all || []).filter(function (r) { return r.email === e && isOpen(r, now); }) : [];
  }

  /** The record's current series (latest Request ID not Filed): its rows, or [] when there is none. */
  function series(all, recordId) {
    var mine = (all || []).filter(function (r) { return r.recordId === str(recordId) && !r.filed; });
    if (!mine.length) return [];
    var latest = mine.reduce(function (a, r) { return r.asked > a.asked ? r : a; }, mine[0]).requestId;
    return mine.filter(function (r) { return r.requestId === latest; });
  }

  /**
   * Where a series stands. -> {requestId, signed: {slotKey: {name, rep, email}}, pending: [row], expired: [row],
   * missing: [slotKey], complete (every slot signed), repOk: {application, report}}
   */
  function state(rows, now) {
    var signed = {}, pending = [], expired = [];
    (rows || []).forEach(function (r) {
      if (r.status === STATUS.signed) r.slots.forEach(function (k) { signed[k] = { name: r.name, rep: r.rep, email: r.email }; });
      else if (r.status === STATUS.pending) (r.expires > now ? pending : expired).push(r);
    });
    var missing = slotKeys().filter(function (k) { return !signed[k]; });
    var repOk = {};
    DOCS.forEach(function (d) { repOk[d] = Object.keys(signed).some(function (k) { return k.indexOf(d + ':') === 0 && signed[k].rep; }); });
    return { requestId: rows && rows[0] ? rows[0].requestId : '', signed: signed, pending: pending, expired: expired, missing: missing,
      complete: !missing.length, repOk: repOk };
  }

  /**
   * Save partial: the room's signers become Signed rows of a new series. sign: {application: [{key, name, rep, signed}],
   * report: [...]} (only the signed ones are kept). -> [{slots, name, rep}]
   */
  function roomSigners(sign) {
    var out = [];
    DOCS.forEach(function (d) {
      ((sign && sign[d]) || []).forEach(function (s) {
        var name = str(s && s.name).replace(/\s+/g, ' ').slice(0, 80);
        if (!(s && s.signed) || name.length < 2) return;
        var key = d + ':' + str(s.key);
        if (slotKeys().indexOf(key) < 0) return;
        var same = out.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
        if (same) { same.slots.push(key); same.rep = same.rep || !!s.rep; }
        else out.push({ slots: [key], name: name, rep: !!s.rep });
      });
    });
    return out;
  }

  /**
   * Send for signatures. signers: [{name, email, slots: [slotKey], rep}]; st: state(series) of the current series.
   * Each signer: a name, a valid email, at least one slot not already signed and not already asked of someone pending.
   * -> {errors: [text], clean: [{name, email, slots, rep}]}
   */
  function checkRequest(signers, st, isEmail) {
    var errors = [], clean = [], taken = {};
    if (!st || !st.requestId) return { errors: ['Save partial first: there is no paperwork in progress for this Scout.'], clean: [] };
    Object.keys(st.signed || {}).forEach(function (k) { taken[k] = 'already signed by ' + st.signed[k].name; });
    (st.pending || []).forEach(function (r) { r.slots.forEach(function (k) { taken[k] = 'already asked of ' + r.name; }); });
    var emails = {};
    (signers || []).forEach(function (s, i) {
      var n = i + 1, name = str(s && s.name).replace(/\s+/g, ' ').slice(0, 80), email = str(s && s.email).toLowerCase();
      var slots = parseSlots(slotsText(s && s.slots));
      if (name.length < 2) errors.push('Signer ' + n + ': type the name.');
      if (!(isEmail ? isEmail(email) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) errors.push('Signer ' + n + ': not an email address.');
      else if (emails[email]) errors.push('Signer ' + n + ': ' + email + ' is listed twice (give one signer several boxes instead).');
      emails[email] = true;
      if (!slots.length) errors.push('Signer ' + n + ': pick at least one signature box.');
      slots.forEach(function (k) {
        if (taken[k]) errors.push('Signer ' + n + ': ' + slotLabel(k) + ' is ' + taken[k] + '.');
        taken[k] = 'already given to signer ' + n;
      });
      clean.push({ name: name, email: email, slots: slots, rep: !!(s && s.rep) });
    });
    if (!(signers || []).length) errors.push('Add at least one signer.');
    return { errors: errors, clean: clean };
  }

  /** Tab row objects for new rows. o: {id(): 'SG-...', requestId, recordId, scout, askedBy, now, days, status, signed} */
  function newRows(people, o) {
    return (people || []).map(function (p) {
      var signedNow = o.status === STATUS.signed;
      return { 'Row ID': o.id(), 'Request ID': o.requestId, 'Record ID': o.recordId, 'Scout': o.scout, 'Email': p.email || '',
        'Name': p.name, 'Slots': slotsText(p.slots), 'Rep': !!p.rep, 'Status': o.status || STATUS.pending, 'Asked by': o.askedBy,
        'Asked': new Date(o.now), 'Signed': signedNow ? new Date(o.now) : '', 'Expires': signedNow ? '' : new Date(o.now + (Number(o.days) || 14) * DAY),
        'Filed': '', 'Note': p.note || '' };
    });
  }

  /**
   * A signer's save is accepted only on the copies they opened: base: {application: {id, modified}, report: {...}};
   * current: the same from the folder now. -> '' or the reason it changed.
   */
  function baseChanged(base, current) {
    for (var i = 0; i < DOCS.length; i++) {
      var d = DOCS[i], b = (base || {})[d] || {}, c = (current || {})[d] || {};
      if (str(b.id) !== str(c.id) || Number(b.modified) !== Number(c.modified)) return 'Someone else saved the ' + DOC_LABEL[d] + ' since you opened it.';
    }
    return '';
  }

  /** The Partial copies' names: the standard -Signed names with -Partial. names: EagleDone.fileNames(...) */
  function partialNames(names) {
    var p = function (n) { return str(n).replace(/-Signed\.pdf$/i, '-Partial.pdf'); };
    return { application: p(names && names.application), report: p(names && names.report) };
  }

  /** Which slot keys a document has, for one signer: slots filtered to the document. */
  function slotsOf(doc, slots) { return (slots || []).filter(function (k) { return k.indexOf(doc + ':') === 0; }).map(function (k) { return k.split(':')[1]; }); }

  /** "Signatures: AB signed Board of review chair; waiting on Pat Q (pat@example.org) for ..." for the Notes / log. */
  function summary(st) {
    var parts = [];
    var names = {};
    Object.keys(st.signed || {}).forEach(function (k) { var n = st.signed[k].name; (names[n] = names[n] || []).push(slotLabel(k)); });
    Object.keys(names).forEach(function (n) { parts.push(n + ' signed ' + names[n].join(', ')); });
    (st.pending || []).forEach(function (r) { parts.push('waiting on ' + r.name + ' (' + r.email + ') for ' + r.slots.map(slotLabel).join(', ')); });
    (st.expired || []).forEach(function (r) { parts.push('expired: ' + r.name + ' (' + r.email + ')'); });
    return parts.join('; ');
  }

  /** Digest: series with rows pending longer than `days` (asked before now - days). -> [{recordId, scout, names}] */
  function waiting(all, now, days) {
    var cut = now - (Number(days) || 3) * DAY, by = {};
    (all || []).forEach(function (r) {
      if (!isOpen(r, now) || r.asked > cut) return;
      (by[r.recordId] = by[r.recordId] || { recordId: r.recordId, scout: r.scout, names: [] }).names.push(r.name);
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  return { TAB: TAB, HEADERS: HEADERS, STATUS: STATUS, DOCS: DOCS, DOC_LABEL: DOC_LABEL, slotKeys: slotKeys, slotLabel: slotLabel,
    parseSlots: parseSlots, slotsText: slotsText, list: list, isOpen: isOpen, openFor: openFor, series: series, state: state,
    roomSigners: roomSigners, checkRequest: checkRequest, newRows: newRows, baseChanged: baseChanged, partialNames: partialNames,
    slotsOf: slotsOf, summary: summary, waiting: waiting };
})();

if (typeof module !== 'undefined') module.exports = Signatures;
