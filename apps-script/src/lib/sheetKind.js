/**
 * SheetKind: is this spreadsheet a non-production copy (dev or staging)?
 *
 * Decided by name, so it survives File → Make a copy:
 *   - contains "Test Copy" (dev sheets), or
 *   - starts with "STAGING" (staging sheets in the Council drive).
 * Non-production sheets get dev conveniences (fake units/committee, folders created next to the sheet) and
 * migration apply without Settings → allowProduction. Anything else is treated as production.
 *
 * Pure (no Google services) so it runs in Apps Script and in Node tests.
 */
var SheetKind = (function () {
  function isNonProduction(name) {
    var n = String(name == null ? '' : name);
    return /test copy/i.test(n) || /^\s*STAGING\b/.test(n);
  }
  /**
   * Staging and production run as the Council account: menu items run as whoever clicks, so mail, invites and
   * files would come from a personal account otherwise (10/19). Dev sheets ("Test Copy") are exempt.
   * -> '' if OK, else the message to show.
   */
  function accountProblem(sheetName, email, domain) {
    var n = String(sheetName == null ? '' : sheetName);
    if (/test copy/i.test(n)) return '';
    var d = String(domain || '').trim().toLowerCase().replace(/^@/, '');
    if (!d) return '';
    var e = String(email || '').trim().toLowerCase();
    if (e && e.slice(-(d.length + 1)) === '@' + d) return '';
    return 'This needs the Council account (@' + d + '), but you are signed in as ' + (e || 'an unknown account') + '.\n\n' +
      'Menu items run as whoever clicks them, so email and calendar invites would come from your own account. ' +
      'Committee members: use the Action column instead. Admin: switch to the cc-advancement profile.';
  }
  return { isNonProduction: isNonProduction, accountProblem: accountProblem };
})();

if (typeof module !== 'undefined') module.exports = SheetKind;
