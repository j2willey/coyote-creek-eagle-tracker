/**
 * Access (Jim W., 2026-11-12; vault ebor-remote-signing-design.md, step 0): who an email address is, in one place.
 * Pure.
 *
 * Sign-in only proves an email address. What it may see is worked out on every request from the tables: the Scout's
 * own records, the units it is a contact for, the Committee tab (Role blank | Admin | Support) and Settings adminEmail.
 *
 * Support (option A, 2026-11-12): someone who supports a district's install without being a working committee member.
 * Admin powers and access to the committee pages (to test, demo and troubleshoot), but left out of every committee
 * list (staffing, Who, suggestions, calendar guests, "no committee member" checks): see committee_() / committeeAll_().
 * Committee email goes to the Google Group, so Support is simply not in the group.
 */
var Access = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var ROLES = ['', 'Admin', 'Support'];

  /** 'admin' / ' Support ' -> 'Admin' / 'Support'; anything else -> ''. */
  function role(v) {
    var r = str(v).toLowerCase();
    return r === 'admin' ? 'Admin' : r === 'support' ? 'Support' : '';
  }

  function isSupport(member) { return !!member && role(member.role) === 'Support'; }

  /** Committee rows without Support: the list that staffs, suggests, invites and counts. */
  function working(committee) { return (committee || []).filter(function (m) { return !isSupport(m); }); }

  /** The Committee row with this email (any role), or null. */
  function memberFor(committee, email) {
    var e = str(email).toLowerCase();
    if (!e) return null;
    return (committee || []).filter(function (c) { return str(c.email).toLowerCase() === e; })[0] || null;
  }

  /** Admin pages (People, Settings, System): Role Admin, Role Support, or Settings adminEmail. */
  function isAdmin(member, email, settings) {
    if (member && (role(member.role) === 'Admin' || role(member.role) === 'Support')) return true;
    var e = str(email).toLowerCase();
    return !!e && e === str(settings && settings.adminEmail).toLowerCase();
  }

  /**
   * i: {email, records: [recordId], units: [unit], committee: committeeAll (every role), settings, signatures: [row]}
   * -> {email, records, units, member (the Committee row or null), admin, support, signatures, onFile}
   * onFile: a sign-in link may be sent (otherwise the address gets the Start-your-Proposal link).
   */
  function whoIs(i) {
    var email = str(i && i.email).toLowerCase();
    var member = memberFor(i && i.committee, email);
    var records = (i && i.records) || [], units = (i && i.units) || [], signatures = (i && i.signatures) || [];
    var admin = !!email && isAdmin(member, email, i && i.settings);
    return {
      email: email, records: records, units: units, member: member, admin: admin, support: isSupport(member), signatures: signatures,
      onFile: !!email && (records.length > 0 || units.length > 0 || !!member || signatures.length > 0)
    };
  }

  return { ROLES: ROLES, role: role, isSupport: isSupport, working: working, memberFor: memberFor, isAdmin: isAdmin, whoIs: whoIs };
})();

if (typeof module !== 'undefined') module.exports = Access;
