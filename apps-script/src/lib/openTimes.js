/**
 * OpenTimes: "New times are open" email (Jim W., 2026-10-31). After a committee member opens one or more sessions,
 * ONE email goes To every Scout ready to book that type, Cc their parents/guardians and the committee group, listing
 * the new times. Jim's call: a small group (6-8 Scouts), seeing each other in To is fine and adds some urgency; one
 * email keeps the committee from getting a copy per Scout. Pure.
 */
var OpenTimes = (function () {
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }
  function M() { return typeof MailPlan !== 'undefined' ? MailPlan : require('./mailPlan.js'); }
  function str(v) { return v == null ? '' : String(v).trim(); }

  /** Template tab per type (lib/templateCatalog.js). */
  var TEMPLATE = { Intake: 'Open times: Pre-Review Call', ESSPPR: 'Open times: Proposal Review', EBoR: 'Open times: Eagle Board of Review' };

  /** The "To Book" section of a type, or null. */
  function sectionFor(type) {
    var out = null;
    B().BOOKABLE_SECTIONS.forEach(function (sec) { if (B().bookableType(sec) === type) out = sec; });
    return out;
  }

  /**
   * Scouts ready to book `type`: in its To Book section, no upcoming booking of that type.
   * records: [{recordId, section, scout_name, unit, scout_email, parent_email}]. rows: schedule rows.
   * -> [{ recordId, name, unit, scoutEmails, parentEmails, noEmail }] by name.
   */
  function recipients(records, type, rows, nowMs) {
    var sec = sectionFor(type);
    if (!sec) return [];
    return (records || []).filter(function (r) {
      return r.section === sec && str(r.scout_name) && !B().currentBooking(rows, str(r.recordId), type, nowMs);
    }).map(function (r) {
      var se = M().merge(r.scout_email), pe = M().merge(r.parent_email);
      return { recordId: str(r.recordId), name: str(r.scout_name), preferred: str(r.preferred_name), unit: str(r.unit), scoutEmails: se, parentEmails: pe, noEmail: !se.length && !pe.length };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /**
   * chosen: recipients() items. -> { to, cc }: To = the Scouts (a Scout with no email of their own: the parent, as for
   * every family email); Cc = the other parents/guardians + the committee group. No address twice.
   */
  function addresses(chosen, group) {
    var to = [], cc = [];
    (chosen || []).forEach(function (x) {
      var fam = M().family(x.scoutEmails, x.parentEmails);
      to = M().merge(to, fam.to);
      cc = M().merge(cc, fam.keepCc);
    });
    cc = M().merge(cc, group).filter(function (e) { return to.indexOf(e) < 0; });
    return { to: to, cc: cc };
  }

  /** "Pat", "Pat and Lee", "Pat, Lee and Sam". */
  function namesText(names) {
    var n = (names || []).map(str).filter(Boolean);
    if (n.length < 2) return n.join('');
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }

  /**
   * slots: Booking.openSlots() items. whenFn(ms) -> "Sat 10/31 9:00 AM". placeFn(slot) -> place text (in-person types).
   * -> list lines for {times}: "Sat 10/31 9:00 AM" (online type) or "Tue 11/3 7:00 PM at East Valley YMCA".
   */
  function timesList(slots, type, whenFn, placeFn) {
    return (slots || []).slice().sort(function (a, b) { return a.start - b.start; }).map(function (x) {
      var where = B().isVirtual(type, x) ? (B().rules(type).virtual ? '' : 'online') : (placeFn ? placeFn(x) : str(x.location));
      return whenFn(x.start) + (where ? (where === 'online' ? ' (online)' : ' at ' + where) : '');
    });
  }

  /**
   * Which of the chosen sessions to list: open and offered to Scouts now (their lead time respected), plus, with
   * includeOthers, every other open session of the type. openNow: Booking.openSlots(rows, type, now, settingsLead).
   * keys: the sessions just created. -> { list, held: keys not listed (booked, reserved, unstaffed or inside the lead time) }
   */
  function pick(openNow, keys, includeOthers) {
    var want = {};
    (keys || []).forEach(function (k) { want[str(k)] = true; });
    var list = (openNow || []).filter(function (x) { return includeOthers || want[x.key]; });
    var listed = {};
    list.forEach(function (x) { listed[x.key] = true; });
    return { list: list, held: Object.keys(want).filter(function (k) { return !listed[k]; }) };
  }

  return { TEMPLATE: TEMPLATE, sectionFor: sectionFor, recipients: recipients, addresses: addresses, namesText: namesText, timesList: timesList, pick: pick };
})();

if (typeof module !== 'undefined') module.exports = OpenTimes;
