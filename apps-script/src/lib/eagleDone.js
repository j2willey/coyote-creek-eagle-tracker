/**
 * EagleDone: rules for "Eagle earned" in one step (Jim W., 2026-10-23) and for where a Scout's folder lives. Pure.
 *
 * Eagle earned: the two signed scans (Eagle Scout Rank Application, Advancement Report) are filed and attached to the
 * Council email (Settings → councilEaglesEmail, Cc the committee and the unit leader); the EBoR photos (resized to JPEG in the
 * browser, EXIF date = the board's date) go to "EBoR Photos" and are attached to the congratulations email to the
 * Scout, family, unit contacts, the board (district reps + Unit Board Members) and the committee.
 *
 * Folder placement (Scouts folder): active Scouts in 202x; once an EBoR date is set, the EBoR year folder (2026, ...;
 * every folder in a year folder is an Eagle or about to be one); Eagle Not Awarded / Proposal Not Approved in the
 * exceptions folder. EBoR Paused stays where it is until the board is booked again. Closed stays where it is too
 * (the January archive moves it to Archive/Closed; Reopen puts the row back without moving the folder).
 */
var EagleDone = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var EXCEPTION_SECTIONS = ['eagle_not_awarded', 'proposal_not_approved'];
  var YEAR_SECTIONS = ['ebor_booked', 'eagle_earned'];

  /**
   * Folder (child of the Scouts folder) a Scout belongs in, or null = leave it where it is.
   * settings: inProgressFolder (202x), exceptionsFolder.
   */
  function placeFor(sectionKey, eborYmd, settings) {
    var s = settings || {};
    if (EXCEPTION_SECTIONS.indexOf(sectionKey) >= 0) return str(s.exceptionsFolder) || 'Exceptions';
    var y = /^(\d{4})-\d{2}-\d{2}/.exec(str(eborYmd));
    if (YEAR_SECTIONS.indexOf(sectionKey) >= 0) return y ? y[1] : null;          // booked without a date yet: leave it
    if (sectionKey === 'ebor_paused') return null;                                // until the board is booked again
    if (sectionKey === 'closed') return null;                                     // stays put; the January archive moves it (Archive/Closed)
    return str(s.inProgressFolder) || '202x';
  }

  /** "T2019" -> "Troop 2019", "C917" -> "Crew 917", "S5" -> "Ship 5"; anything else as typed. */
  function unitName(unit) {
    var m = /^([TCS])\s*0*(\d+)$/i.exec(str(unit));
    if (!m) return str(unit);
    return { T: 'Troop', C: 'Crew', S: 'Ship' }[m[1].toUpperCase()] + ' ' + m[2];
  }

  function longDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
    return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : str(ymd);
  }

  /**
   * Preferred Name (Jim W., 2026-11-04: Theodore Sample goes by Teddy): a ";"-list on the row. The first entry is the
   * name he is called (greetings, display); every entry also helps matching. The legal name stays the Scout's name.
   */
  function preferredList(v) { return str(v).split(/\s*;\s*/).map(str).filter(Boolean); }
  function preferred(v) { return preferredList(v)[0] || ''; }
  /** Greeting name: the first word of the first preferred name, else of the (legal) name. */
  function firstName(name, pref) { var p = preferred(pref); var n = p || str(name); return n.split(/\s+/)[0] || n; }
  /** 'Theodore Sample ("Teddy")'; just the name when there is no preferred name (or it is the same). */
  function display(name, pref) { var p = preferred(pref); return p && p.toLowerCase() !== str(name).toLowerCase() ? str(name) + ' ("' + p + '")' : str(name); }

  /** Standard names (namePart / unitPart from Intake, passed in: no load-time globals). */
  function fileNames(scoutName, unit, eborYmd, namePart, unitPart) {
    var base = namePart(scoutName) + '-' + unitPart(unit);
    var d = str(eborYmd).replace(/-/g, '');
    return {
      application: base + '_EagleApplication-Signed.pdf',
      report: base + '_AdvancementReport-Signed.pdf',
      photo: function (n) { return base + '_EBoR-' + d + '-' + (n < 10 ? '0' : '') + n + '.jpg'; }
    };
  }

  /** Everyone at or behind the board, lower-cased and de-duplicated, in a stable order. */
  function recipients(lists) {
    var out = [];
    (lists || []).forEach(function (l) {
      (l || []).forEach(function (e) { e = str(e).toLowerCase(); if (e && /@/.test(e) && out.indexOf(e) < 0) out.push(e); });
    });
    return out;
  }

  return { EXCEPTION_SECTIONS: EXCEPTION_SECTIONS, placeFor: placeFor, unitName: unitName, longDate: longDate,
    firstName: firstName, preferred: preferred, preferredList: preferredList, display: display, fileNames: fileNames, recipients: recipients };
})();

if (typeof module !== 'undefined') module.exports = EagleDone;
