/**
 * UnitBroadcast (Jim W., 2026-10-26): an email from the Advancement Committee to the units (Admin page).
 * Units by type (Packs, Troops, Crews, Ships); people by role: Committee Chairs, Unit Leaders (Scoutmaster, Cubmaster,
 * Crew Advisor, Skipper …), Unit Contacts (unit-provided; "Exclude" addresses left out). Chartered Org Reps never.
 * Unique addresses, sent To the committee group with the units in Bcc, in batches that fit Apps Script's 50
 * recipients per message. Pure.
 */
var UnitBroadcast = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var TYPES = { p: 'Packs', t: 'Troops', c: 'Crews', s: 'Ships' };
  var PER_MESSAGE = 48;                  // 50 per message (To + Bcc) minus the group in To, with a spare
  function U() { return typeof Units !== 'undefined' ? Units : require('./units.js'); }
  function typeOf(code) { var m = /^([a-z]+)\d+$/.exec(str(code)); return m ? m[1] : ''; }

  /**
   * key3 / local: Key 3 and Unit Contacts tab rows. opts: {types: ['t','c','s'], chairs, leaders, contacts: bool}.
   * -> {recipients: [{email, units: ['T964', …], roles: ['Unit Leader', …]}] sorted by email, units: n}
   */
  function recipients(key3, local, opts) {
    opts = opts || {};
    var types = opts.types || [];
    var exclAll = [], exclUnit = {};
    (local || []).forEach(function (r) {
      if (str(r['Role']).toLowerCase() !== 'exclude') return;
      var c = U().code(r['Unit']);
      U().emailsIn(r['Email']).forEach(function (e) { if (c) (exclUnit[c] = exclUnit[c] || []).push(e); else exclAll.push(e); });
    });
    var by = {}, unitsSeen = {};
    function add(unit, email, role) {
      var c = U().code(unit);
      if (!c || types.indexOf(typeOf(c)) < 0) return;
      if (exclAll.indexOf(email) >= 0 || (exclUnit[c] || []).indexOf(email) >= 0) return;
      unitsSeen[c] = true;
      var x = by[email] = by[email] || { email: email, units: [], roles: [] };
      var lbl = U().label(c);
      if (x.units.indexOf(lbl) < 0) x.units.push(lbl);
      if (x.roles.indexOf(role) < 0) x.roles.push(role);
    }
    (key3 || []).forEach(function (r) {
      var role = U().key3Role(r['Role'], r['Position']);                   // '' for Chartered Org Reps, assistants …
      if ((role === 'Committee Chair' && opts.chairs) || (role === 'Unit Leader' && opts.leaders)) {
        U().emailsIn(r['Email']).forEach(function (e) { add(r['Unit'], e, role); });
      }
    });
    if (opts.contacts) {
      (local || []).forEach(function (r) {
        var role = str(r['Role']);
        if (!role || role.toLowerCase() === 'exclude') return;
        U().emailsIn(r['Email']).forEach(function (e) { add(r['Unit'], e, role); });
      });
    }
    var list = Object.keys(by).sort().map(function (k) { return by[k]; });
    return { recipients: list, units: Object.keys(unitsSeen).length };
  }

  /** Addresses → batches of at most PER_MESSAGE. */
  function batches(emails, size) {
    var n = size || PER_MESSAGE, out = [];
    for (var i = 0; i < (emails || []).length; i += n) out.push(emails.slice(i, i + n));
    return out;
  }

  return { TYPES: TYPES, PER_MESSAGE: PER_MESSAGE, typeOf: typeOf, recipients: recipients, batches: batches };
})();

if (typeof module !== 'undefined') module.exports = UnitBroadcast;
