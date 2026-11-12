/**
 * People (Jim W., 2026-11-12; plan: vault admin-ui-plan.md, step 3): the Admin page's committee member editor. Pure.
 *
 * Writes only the named Committee tab columns (Name, Initials, Email, Active, Role); any other column (a phone, a
 * count) is left alone. Members are never deleted here: untick Active instead.
 * Initials can't be changed once a member exists: schedule rows and the tracking tab's Who columns refer to them
 * (change them on the sheet, together with those cells, if ever needed).
 */
var People = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var ROLES = ['', 'Admin'];

  function isActive(a) { return !(a === false || /^(false|no|n|0)$/i.test(str(a))); }   // blank = active (as committee_())

  /** Committee tab rows -> [{row, name, initials, email, active, role}] (rows with no name and no email skipped). */
  function list(rows) {
    return (rows || []).filter(function (r) { return str(r['Name']) || str(r['Email']); }).map(function (r) {
      return { row: r._row, name: str(r['Name']), initials: str(r['Initials']), email: str(r['Email']),
        active: isActive(r['Active']), role: /^admin$/i.test(str(r['Role'])) ? 'Admin' : '' };
    });
  }

  /**
   * One add or update. m: {name, initials, email, active, role}; members: list(); opts: {row (update), wasEmail
   * (what the page showed for that row), meEmail (the Admin saving)}.
   * -> {errors: [text], fields: {Name, Initials?, Email, Active, Role}}  (Initials only on add)
   */
  function validate(m, members, opts) {
    var o = opts || {}, errors = [];
    var isAdd = !o.row;
    var cur = isAdd ? null : (members || []).filter(function (x) { return x.row === o.row; })[0];
    if (!isAdd && !cur) return { errors: ['That member is no longer on the Committee tab. Reload the page.'], fields: {} };
    if (cur && str(o.wasEmail).toLowerCase() !== cur.email.toLowerCase()) {
      return { errors: ['That row changed on the sheet since the page loaded. Reload the page.'], fields: {} };
    }
    var name = str(m && m.name), email = str(m && m.email).toLowerCase(), role = str(m && m.role);
    var initials = isAdd ? str(m && m.initials).toUpperCase() : cur.initials;
    var active = m && m.active !== false;
    if (name.length < 2 || name.length > 100) errors.push('Name: 2 to 100 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push('Email: not an email address.');
    if (ROLES.indexOf(role) < 0) errors.push('Role: blank or Admin.');
    var others = (members || []).filter(function (x) { return !cur || x.row !== cur.row; });
    if (email && others.some(function (x) { return x.email.toLowerCase() === email; })) errors.push('Email: already on the list.');
    if (isAdd) {
      if (!/^[A-Z]{2,4}$/.test(initials)) errors.push('Initials: 2 to 4 letters.');
      else if (others.some(function (x) { return x.initials.toUpperCase() === initials; })) errors.push('Initials: already used by someone else.');
    }
    // No locking yourself out: the Admin saving can't remove their own Admin role or deactivate themselves here.
    var me = str(o.meEmail).toLowerCase();
    if (cur && me && cur.email.toLowerCase() === me) {
      if (cur.role === 'Admin' && role !== 'Admin') errors.push('You can\'t remove your own Admin role here (ask another Admin, or edit the sheet).');
      if (!active) errors.push('You can\'t mark yourself inactive here.');
      if (email !== me) errors.push('You can\'t change your own email here (you would be signed out of the committee pages).');
    }
    var fields = { 'Name': name, 'Email': email, 'Active': active, 'Role': role };
    if (isAdd) fields['Initials'] = initials;
    return { errors: errors, fields: fields };
  }

  /** "Committee: added Pat Q (PQ)" / "Committee: PQ Email "a" → "b", Role "" → "Admin"" for the Activity tab. */
  function logLine(cur, fields) {
    if (!cur) return 'Committee: added ' + fields['Name'] + ' (' + fields['Initials'] + ')' + (fields['Role'] ? ', Role Admin' : '') + (fields['Active'] ? '' : ', inactive');
    var was = { 'Name': cur.name, 'Email': cur.email, 'Active': cur.active, 'Role': cur.role };
    var diffs = Object.keys(was).filter(function (k) { return String(was[k]) !== String(fields[k]); })
      .map(function (k) { return k + ' "' + was[k] + '" → "' + fields[k] + '"'; });
    return diffs.length ? 'Committee: ' + cur.initials + ' ' + diffs.join(', ') : '';
  }

  return { ROLES: ROLES, list: list, validate: validate, logLine: logLine };
})();

if (typeof module !== 'undefined') module.exports = People;
