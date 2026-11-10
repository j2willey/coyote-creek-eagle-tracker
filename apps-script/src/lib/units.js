/**
 * Units (EBoR workflow): unit facts, unit contacts and Unit Board Members. Pure.
 *
 * Three tabs (Jim W., 2026-10-17):
 *   Key 3          Council's Key 3 export, replaced on each import (lib/key3.js), never hand-edited:
 *                  Unit | Role | Position | Name | Email | Phone
 *   Unit Contacts  contacts from anywhere else, one row per contact, hand-maintained:
 *                  Unit | Role | Name | Email | Phone | Note | Updated
 *                  Role "Exclude" suppresses that email (for that unit, or every unit if Unit is blank).
 *   Unit Info      one row per unit, unit facts only:
 *                  Unit | Under Review | Meeting Location | Meeting Day | Meeting Time | Unit Notes | Meeting Frequency |
 *                  Meeting Address | Meeting Notes | Last Updated | Updated By (meeting columns: unit page + Units page)
 * A unit's contacts (EBoR notices, unit sign-in) = every Unit Contacts row except Exclude
 *   + Key 3 Unit Leader and Committee Chair − Exclude.
 * One adult may be a contact for several units: they see EBoRs for all of them.
 * Under Review = the Board Restriction: notified, but can't add Unit Board Members.
 *
 * The old single-tab layout (contact email columns on Unit Info) is read by parse() and
 * converted by legacyContacts() when Setup migrates a dev/staging sheet.
 */
var Units = (function () {
  var CONTACT_COLS = ['Unit Leader Email', 'Committee Chair Email', 'EBoR Coordinator Email', 'Other Contacts'];
  var LEGACY_ROLE = { 'Unit Leader Email': 'Unit Leader', 'Committee Chair Email': 'Committee Chair',
    'EBoR Coordinator Email': 'EBoR Coordinator', 'Other Contacts': 'Other' };
  var KEY3_NOTIFY = ['Unit Leader', 'Committee Chair'];

  /**
   * A Key 3 row's role for the tool (Jim W., 2026-10-25): Unit Leader | Cubmaster | Scoutmaster | Crew Advisor (and
   * Skipper) → 'Unit Leader'; Committee Chair → 'Committee Chair'; anything else (Chartered Org Rep, assistants) → ''.
   * Role is checked first, then Position, so a hand-pasted export ("Scoutmaster" in Role) still counts.
   */
  function key3Role(role, position) {
    var out = '';
    [role, position].some(function (v) {
      var p = str(v);
      if (!p || /assistant|associate|chartered\s*org|^cor$|executive\s*officer|den\s*leader/i.test(p)) return false;
      if (/committee\s*chair/i.test(p)) { out = 'Committee Chair'; return true; }
      // "Venturing Crew Advisor", "Crew Advisor", "Advisor", "Cubmaster", "Scoutmaster", "Skipper", "Unit Leader" …
      if (/unit\s*leader|cubmaster|scoutmaster|advisor|skipper/i.test(p)) { out = 'Unit Leader'; return true; }
      return false;
    });
    return out;
  }

  function str(v) { return v == null ? '' : String(v).trim(); }

  /** "T910", "Troop 910", "T-910" -> "t910"; same rules as the rest of the tool. */
  function code(u) {
    var m = /^([a-z]*?)0*(\d{1,5})$/.exec(str(u).toLowerCase().replace(/[^a-z0-9]+/g, ''));
    if (!m) return '';
    var w = m[1];
    var t = !w ? '' : (w === 'c' || /crew$/.test(w)) ? 'c' : (w === 'p' || /pack$/.test(w)) ? 'p'
      : (w === 's' || /ship$/.test(w)) ? 's' : (w === 't' || w === 'troop') ? 't' : w;
    return t + m[2];
  }

  /**
   * A Scout in more than one unit (Jim W., 2026-11-01): the Unit cell lists them, primary FIRST ("C967 T911",
   * "T910 / C917", "Troop 910, Crew 917"). The primary unit is the one on the Eagle application: its contacts get the
   * EBoR emails, only it sets Unit Board Members, files and folders and the Stats page use it. Every listed unit sees
   * the Scout on its unit page.
   */
  var SPLIT = /\s*[\/,;&+\n]+\s*|\s+(?=[A-Za-z]+\s*-?\s*\d)/;
  function parts(cell) { return str(cell).split(SPLIT).map(str).filter(Boolean); }
  /** The first unit as typed ("C967 T911" -> "C967"; "Troop 910" -> "Troop 910"). */
  function primaryText(cell) { return parts(cell)[0] || ''; }
  /** Every unit code in the cell, primary first, no repeats ("C967 T911" -> ["c967", "t911"]). */
  function codes(cell) {
    var out = [];
    parts(cell).forEach(function (p) { var c = code(p); if (c && out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  /** The primary unit's code, or ''. */
  function primary(cell) { return code(cell) || codes(cell)[0] || ''; }

  function emailsIn(cell) {
    var out = [];
    (str(cell).match(/[^\s,;<>()"']+@[^\s,;<>()"']+\.[^\s,;<>()"']+/g) || []).forEach(function (e) {
      e = e.toLowerCase();
      if (out.indexOf(e) < 0) out.push(e);
    });
    return out;
  }

  /** A checkbox, or any mark ("Yes", "x", "Restricted" …). Blank, FALSE, No, N, 0 and "-" mean no. */
  function truthy(v) {
    if (v === true) return true;
    if (v === false || v == null) return false;
    var s = str(v).toLowerCase();
    return s !== '' && ['false', 'no', 'n', '0', '-', 'none'].indexOf(s) < 0;
  }

  /** EBoR board size (Jim W., 2026-10-24): 3 to 6 members, district/council and unit together. */
  var BOARD_MIN = 3, BOARD_MAX = 6;
  function boardSize(repsCell, boardCell, splitWho) {
    var reps = (splitWho ? splitWho(repsCell) : str(repsCell).split(/\s*[,\/;\n]\s*/)).filter(function (x) { return str(x); }).length;
    return reps + parseBoard(boardCell).length;
  }

  /** rows: Tabs.read('Unit Info'). -> [{unit, code, underReview, contacts[]}] */
  function parse(rows) {
    return (rows || []).map(function (r) {
      var contacts = [];
      CONTACT_COLS.forEach(function (c) { emailsIn(r[c]).forEach(function (e) { if (contacts.indexOf(e) < 0) contacts.push(e); }); });
      return { unit: str(r['Unit']), code: code(r['Unit']), underReview: truthy(r['Under Review']), contacts: contacts };
    }).filter(function (u) { return u.code; });
  }

  /** "t910" -> "T910" (display form). */
  function label(c) { return str(c).toUpperCase(); }

  /** Old Unit Info rows (contact email columns) -> Unit Contacts rows, one per email. */
  function legacyContacts(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var c = code(r['Unit']);
      if (!c) return;
      CONTACT_COLS.forEach(function (col) {
        emailsIn(r[col]).forEach(function (e) { out.push({ unit: label(c), role: LEGACY_ROLE[col], email: e }); });
      });
    });
    return out;
  }

  /**
   * The three tabs -> [{unit, code, underReview, contacts[], meeting:{location, day, time}, notes}].
   * info/key3/local: Tabs.read() rows. A unit appears if any tab mentions it.
   */
  function combine(info, key3, local) {
    var byCode = {}, order = [];
    function get(raw) {
      var c = code(raw);
      if (!c) return null;
      if (!byCode[c]) {
        byCode[c] = { unit: label(c), code: c, underReview: false, contacts: [],
          meeting: { location: '', day: '', time: '', frequency: '', address: '', notes: '' }, notes: '' };
        order.push(c);
      }
      return byCode[c];
    }
    function add(u, e) { if (u.contacts.indexOf(e) < 0) u.contacts.push(e); }
    // "Under Review" column, found by name ("Under review", "Board Restriction", "Restricted" … work too).
    var urKey = null;
    (info || []).some(function (r) {
      urKey = Object.keys(r).filter(function (k) { return /under\s*review|restrict/i.test(k); })[0] || null;
      return true;
    });
    (info || []).forEach(function (r) {
      var u = get(r['Unit']);
      if (!u) return;
      u.underReview = u.underReview || (urKey ? truthy(r[urKey]) : false);
      u.meeting = { location: str(r['Meeting Location']), day: str(r['Meeting Day']), time: str(r['Meeting Time']),
        frequency: str(r['Meeting Frequency']), address: str(r['Meeting Address']), notes: str(r['Meeting Notes']) };
      u.notes = str(r['Unit Notes']);
    });
    (key3 || []).forEach(function (r) {
      if (!key3Role(r['Role'], r['Position'])) return;
      var u = get(r['Unit']);
      if (u) emailsIn(r['Email']).forEach(function (e) { add(u, e); });
    });
    var excludeAll = [], excludeUnit = {};
    (local || []).forEach(function (r) {
      var role = str(r['Role']).toLowerCase();
      var emails = emailsIn(r['Email']);
      if (role === 'exclude') {
        var c = code(r['Unit']);
        emails.forEach(function (e) { if (c) (excludeUnit[c] = excludeUnit[c] || []).push(e); else excludeAll.push(e); });
        return;
      }
      var u = get(r['Unit']);
      if (u) emails.forEach(function (e) { add(u, e); });
    });
    return order.map(function (c) {
      var u = byCode[c], ex = excludeAll.concat(excludeUnit[c] || []);
      u.contacts = u.contacts.filter(function (e) { return ex.indexOf(e) < 0; });
      return u;
    });
  }

  /** The unit (or a Scout's PRIMARY unit, when the cell lists several). */
  function find(units, unit) {
    var c = primary(unit);
    return c ? (units || []).filter(function (u) { return u.code === c; })[0] || null : null;
  }

  /** Units an address is a contact for (several allowed). */
  function forEmail(units, email) {
    var e = str(email).toLowerCase();
    return (units || []).filter(function (u) { return u.contacts.indexOf(e) >= 0; });
  }

  /**
   * Unit Board Members cell: "Name, email, phone; Name, email, phone".
   * Lenient: parts are recognized by shape (has @ = email, mostly digits = phone).
   */
  function parseBoard(cell) {
    return str(cell).split(/\s*[;\n]\s*/).map(function (entry) {
      var m = { name: '', email: '', phone: '' };
      entry.split(/\s*,\s*/).forEach(function (part) {
        part = str(part);
        if (!part) return;
        if (/@/.test(part)) m.email = part.toLowerCase();
        else if (/^[\d\s().+-]{7,}$/.test(part)) m.phone = part;
        else m.name = m.name ? m.name + ' ' + part : part;
      });
      return m;
    }).filter(function (m) { return m.name || m.email; });
  }

  function formatBoard(members) {
    return (members || []).map(function (m) {
      return [str(m.name), str(m.email).toLowerCase(), str(m.phone)].filter(Boolean).join(', ');
    }).filter(Boolean).join('; ');
  }

  var MAX_BOARD = 6;

  /** Validate a board from the unit page. -> {ok, errors[], members[]} */
  function validateBoard(members) {
    var errors = [];
    var clean = (members || []).map(function (m) {
      return { name: str(m && m.name).slice(0, 80), email: str(m && m.email).toLowerCase().slice(0, 120), phone: str(m && m.phone).slice(0, 30) };
    }).filter(function (m) { return m.name || m.email || m.phone; });
    if (clean.length > MAX_BOARD) errors.push('At most ' + MAX_BOARD + ' Unit Board Members.');
    clean.forEach(function (m, i) {
      if (!m.name) errors.push('Board member ' + (i + 1) + ': name is required.');
      if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) errors.push('Board member ' + (i + 1) + ': email is not valid.');
      if (/[;,]/.test(m.name)) errors.push('Board member ' + (i + 1) + ': please leave commas and semicolons out of the name.');
    });
    return { ok: errors.length === 0, errors: errors, members: clean };
  }

  /**
   * "Others to invite" to a Scout's EBoR (a parent, a new Scoutmaster...),
   * entered by the Scout/parent: [{email, note}] <-> "email (note); email".
   */
  function parseCc(cell) {
    return str(cell).split(/\s*;\s*/).map(function (part) {
      var e = emailsIn(part)[0] || '';
      var m = /\(([^)]*)\)/.exec(part);
      return { email: e, note: m ? str(m[1]) : '' };
    }).filter(function (x) { return x.email; });
  }

  function formatCc(list) {
    return (list || []).map(function (x) {
      return str(x.email).toLowerCase() + (str(x.note) ? ' (' + str(x.note).replace(/[();]/g, ' ').trim() + ')' : '');
    }).join('; ');
  }

  var MAX_CC = 6;
  function validateCc(list) {
    var errors = [];
    var clean = (list || []).map(function (x) {
      return { email: str(x && x.email).toLowerCase().slice(0, 120), note: str(x && x.note).slice(0, 60) };
    }).filter(function (x) { return x.email || x.note; });
    if (clean.length > MAX_CC) errors.push('At most ' + MAX_CC + ' people.');
    clean.forEach(function (x, i) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email)) errors.push('Person ' + (i + 1) + ': email is not valid.');
    });
    return { ok: errors.length === 0, errors: errors, list: clean };
  }


  return { parts: parts, primaryText: primaryText, codes: codes, primary: primary,
    CONTACT_COLS: CONTACT_COLS, KEY3_NOTIFY: KEY3_NOTIFY, key3Role: key3Role, MAX_BOARD: MAX_BOARD, BOARD_MIN: BOARD_MIN, BOARD_MAX: BOARD_MAX, boardSize: boardSize, truthy: truthy, code: code, label: label, emailsIn: emailsIn,
    parse: parse, legacyContacts: legacyContacts, combine: combine, find: find,
    forEmail: forEmail, parseBoard: parseBoard, formatBoard: formatBoard, validateBoard: validateBoard,
    parseCc: parseCc, formatCc: formatCc, validateCc: validateCc
  };
})();

if (typeof module !== 'undefined') module.exports = Units;
