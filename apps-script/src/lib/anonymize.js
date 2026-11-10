/**
 * Anonymize: turn a STAGING copy of production into a safe playground for the committee
 * (Jim W., 2026-10-21). Real Scouts become Scout_<n>; emails go to plus-addresses of one
 * test inbox; phones become 408-555-1212. Birth dates, units, stages, project titles and
 * beneficiaries stay so the sheet still looks familiar. Never runs on production (adapter checks).
 *
 * Pure (no Google services).
 */
var Anonymize = (function () {
  var PHONE = '408-555-1212';
  var FAKE = /^Scout_\d+$/;

  function str(v) { return v == null ? '' : String(v).trim(); }
  function isFake(name) { return FAKE.test(str(name)); }

  /** "tester@example.org" + "Scout_3" -> "tester+Scout_3@example.org" ('' if base isn't an email). */
  function plusAddress(base, tag) {
    var m = /^([^@\s+]+)(?:\+[^@\s]*)?@([^@\s]+)$/.exec(str(base));
    return m ? m[1] + '+' + tag + '@' + m[2] : '';
  }

  /** Plus-address of the Settings testRecipient inbox, falling back to "tester+<tag>@example.org" when base is blank. */
  function testEmail(base, tag) {
    return plusAddress(base, tag) || ('tester+' + str(tag) + '@example.org');
  }

  /** New values for record number n (1-based). coach: the old coach cell (kept blank if blank). */
  function fakeFields(n, base, oldCoach) {
    var name = 'Scout_' + n;
    return {
      scout_name: name,
      scout_email: plusAddress(base, name),
      parent_email: plusAddress(base, 'Parent+' + name),
      scout_phone: PHONE,
      bsa_id: '',
      proj_coach: str(oldCoach) ? 'Coach_' + n : ''
    };
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Name forms that may appear in text: "First Last", "Last, First", "First_Last" (file names). */
  function nameForms(fullName) {
    var n = str(fullName).replace(/\s+/g, ' ');
    if (!n) return [];
    var parts = n.split(' ');
    var forms = [n];
    if (parts.length > 1) forms.push(parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' '));
    forms.push(n.replace(/[^A-Za-z0-9 _'-]+/g, ' ').replace(/'/g, '').trim().replace(/\s+/g, '_'));
    return forms.filter(function (f, i, a) { return f.length > 2 && a.indexOf(f) === i; });
  }

  /**
   * Scrub free text (notes, log lines, file names): the old name -> new name, any email ->
   * a plus-address of base, any phone number -> 408-555-1212.
   */
  function scrub(text, oldName, newName, base, n) {
    var t = String(text == null ? '' : text);
    if (!t) return t;
    nameForms(oldName).forEach(function (f) {
      t = t.replace(new RegExp(escapeRe(f), 'gi'), newName);
    });
    var k = 0;
    t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, function (e) {
      if (/\+(Parent\+)?Scout_\d+@/.test(e) || /\+Other_\d+_\d+@/.test(e)) return e;   // already fake
      k++;
      return plusAddress(base, 'Other_' + n + '_' + k) || 'removed@example.org';
    });
    t = t.replace(/(\(?\b\d{3}\)?[-. ]?\d{3}[-. ]\d{4}\b)/g, PHONE);
    return t;
  }

  return { PHONE: PHONE, isFake: isFake, plusAddress: plusAddress, testEmail: testEmail, fakeFields: fakeFields, nameForms: nameForms, scrub: scrub };
})();

if (typeof module !== 'undefined') module.exports = Anonymize;
