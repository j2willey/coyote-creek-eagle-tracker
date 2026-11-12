/**
 * Intake (M3): pure rules for the first-time Proposal submission.
 *
 * Flow (solution-options.md, element 2):
 *  1. submitIntake: form fields validated -> Intake Queue row (Uploading).
 *  2. uploadIntakeFile (one request per file): stored in the `_Intake Queue`
 *     folder, logged in Uploads Log under the Queue ID.
 *  3. finishIntake: needs an ESSPP file -> Unconfirmed; confirmation link
 *     emailed to the Scout and the parent (either click confirms).
 *  4. confirmIntake: duplicate check, then promotion (Scout folder, files
 *     renamed to the standard, row under "New Submissions") or held for a
 *     committee member.
 *
 * No Google services here, so everything is unit-tested in Node.
 */
var Intake = (function () {
  var STATUS = {
    UPLOADING: 'Uploading',
    UNCONFIRMED: 'Unconfirmed',
    CONFIRMED: 'Confirmed',
    PROMOTED: 'Promoted',
    DUPLICATE: 'Possible duplicate',
    SPAM: 'Spam/deleted',
    ERROR: 'Error',
    ATTACHED: 'Attached',
    REPLACED: 'Replaced'        // an unfinished upload the Scout later sent again successfully (Jim W., 2026-11-12)
  };

  // Form field -> Intake Queue header -> tracking-tab machine name (same as the key).
  var FIELDS = [
    { key: 'scout_name', header: 'Eagle Candidate', label: 'Scout name', required: true, max: 100 },
    // Preferred Name (2026-11-04): the name the Scout goes by, if different; ";" between several (first = what he is called)
    { key: 'preferred_name', header: 'Preferred Name', label: 'Preferred name', max: 100 },
    { key: 'unit', header: 'Unit', label: 'Unit', required: true, type: 'unit' },
    { key: 'birth_date', header: 'Birth Date', label: 'Birth date', required: true, type: 'date' },
    { key: 'scout_email', header: 'Scout Email', label: 'Scout email', required: true, type: 'email' },
    { key: 'scout_phone', header: 'Scout Phone', label: 'Scout phone', max: 30 },
    { key: 'bsa_id', header: 'BSA ID', label: 'BSA ID', type: 'bsaId' },
    { key: 'parent_email', header: 'Parent/Guardian Email', label: 'Parent/guardian email', required: true, type: 'email' },
    { key: 'proj_title', header: 'Eagle Proj', label: 'Project title', required: true, max: 200 },
    { key: 'beneficiary', header: 'Beneficiary', label: 'Beneficiary', required: true, max: 200 },
    { key: 'proj_address', header: 'Project Address', label: 'Project address', max: 300 },
    { key: 'proj_coach', header: 'Project Coach', label: 'Project coach', max: 100 },
    { key: 'est_fundraising', header: 'Est. Fundraising', label: 'Estimated fundraising', max: 40 }
  ];

  var TAGS = ['ESSPP', 'Signatures', 'Slides', 'Photo', 'Other'];
  var EXT = { pdf: 1, pptx: 1, docx: 1, jpg: 1, jpeg: 1, png: 1, heic: 1 };
  var MIME = {
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic'
  };
  var MAX_FILES = 10;

  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isEmail(e) { return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

  /** 'YYYY-MM-DD' from a Date (local fields) or a string; '' if not a real date. */
  function dateKey(v) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    }
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str(v));
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      var dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
      return y + '-' + pad2(mo) + '-' + pad2(d);
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(v));   // M/D/YYYY as typed in the sheet
    if (m) return dateKey(m[3] + '-' + m[1] + '-' + m[2]);
    return '';
  }

  /**
   * input: raw form object. now: Date (for the birth-date sanity check).
   * keys: optional subset of field keys to check (Scout Update edits).
   * returns { ok, errors: [{field, message}], clean: {key: value} }
   */
  function validate(input, now, keys) {
    var errors = [];
    var clean = {};
    var today = now || new Date();
    // The form sends Unit as two parts (dot for type + number, as on the BSA forms).
    if (input && (input.unit_type != null || input.unit_number != null)) {
      input = Object.assign({}, input, { unit: str(input.unit_type) + str(input.unit_number) });
    }
    FIELDS.forEach(function (f) {
      if (keys && keys.indexOf(f.key) < 0) return;
      var v = str(input && input[f.key]);
      if (f.type === 'email') v = v.toLowerCase();
      if (!v) {
        if (f.required) errors.push({ field: f.key, message: f.label + ' is required.' });
        clean[f.key] = '';
        return;
      }
      if (f.max && v.length > f.max) errors.push({ field: f.key, message: f.label + ' is too long.' });
      if (f.type === 'email' && !isEmail(v)) errors.push({ field: f.key, message: f.label + ' is not a valid email address.' });
      if (f.type === 'unit') {
        var u = parseUnit(v);
        if (!u || !u.type) errors.push({ field: f.key, message: 'Unit: pick Troop, Crew or Ship and enter the number.' });
        else v = u.type + u.number;
      }
      if (f.type === 'bsaId' && !/^\d{6,12}$/.test(v)) errors.push({ field: f.key, message: 'BSA ID should be 6 to 12 digits (leave it blank if you don\'t know it).' });
      if (f.type === 'date') {
        var k = dateKey(v);
        if (!k) errors.push({ field: f.key, message: f.label + ' is not a valid date.' });
        else {
          var age = ageOn(k, today);
          if (age < 10 || age > 25) errors.push({ field: f.key, message: 'Please check the birth date.' });
          v = k;
        }
      }
      clean[f.key] = v;
    });
    // An adult is always copied (Jim W., 2026-11-08): the parent/guardian email can't be the Scout's own.
    if (clean.parent_email && clean.scout_email && clean.parent_email === clean.scout_email) {
      errors.push({ field: 'parent_email', message: 'Parent/guardian email must be a parent\'s or guardian\'s address, not the Scout\'s own.' });
    }
    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  /** The row has no parent/guardian email of its own (blank, or only the Scout's address): the Scout must add one. */
  function needsParent(fields) {
    var list = function (v) { return str(v).toLowerCase().split(/[\s,;]+/).filter(function (e) { return /@/.test(e); }); };
    var scout = list(fields && fields.scout_email);
    return !list(fields && fields.parent_email).some(function (e) { return scout.indexOf(e) < 0; });
  }

  function ageOn(dateK, now) {
    var p = dateK.split('-').map(Number);
    var age = now.getFullYear() - p[0];
    if (now.getMonth() + 1 < p[1] || (now.getMonth() + 1 === p[1] && now.getDate() < p[2])) age--;
    return age;
  }

  function extOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(str(name));
    return m ? m[1].toLowerCase() : '';
  }

  /** file: {name, tag, bytes}. Returns an error message or ''. */
  function checkFile(file, maxMB) {
    var ext = extOf(file && file.name);
    if (!EXT[ext]) return 'File type not accepted (' + (ext || 'none') + '). Use PDF, PPTX, DOCX, JPG, PNG or HEIC.';
    if (TAGS.indexOf(file.tag) < 0) return 'Pick what this file is: ' + TAGS.join(', ') + '.';
    var max = (Number(maxMB) || 20) * 1024 * 1024;
    if (!(file.bytes > 0)) return 'The file is empty.';
    if (file.bytes > max) return 'The file is larger than ' + (Number(maxMB) || 20) + ' MB.';
    return '';
  }

  function mimeFor(name) { return MIME[extOf(name)] || 'application/octet-stream'; }

  /** "Jane Q. Doe" -> "Jane_Q_Doe"; "T 101" -> "T101". */
  function namePart(s) {
    return str(s).replace(/[^A-Za-z0-9 _'-]+/g, ' ').replace(/'/g, '').trim().replace(/\s+/g, '_');
  }
  /** First unit as typed: a Scout in several units ("C967 T911") is filed under the primary one (2026-11-01). */
  function firstUnit(s) { return str(s).split(/\s*[\/,;&+\n]+\s*|\s+(?=[A-Za-z]+\s*-?\s*\d)/)[0] || ''; }
  function unitPart(s) { return firstUnit(s).replace(/[^A-Za-z0-9]+/g, ''); }

  /** Standard name: <Scout_Name>-<Unit>_<TAG>-V<n>.<ext> (current-process.md Q31). */
  function standardName(scoutName, unit, tag, version, originalName) {
    var ext = extOf(originalName);
    return namePart(scoutName) + '-' + unitPart(unit) + '_' + tag + '-V' + version + (ext ? '.' + ext : '');
  }

  /**
   * Name while waiting in the _Intake Queue folder: Queue ID first (sorts by
   * submission), then who it is, then the Scout's own filename, so a member
   * browsing the folder can tell the files apart.
   * Q-2610120930-K7Q_Scout_Nine-T109_ESSPP_my proposal.pdf
   */
  function queueFileName(queueId, scoutName, unit, tag, originalName) {
    var orig = str(originalName).replace(/[\/\\]+/g, '-').slice(0, 120);
    return queueId + '_' + namePart(scoutName) + '-' + unitPart(unit) + '_' + tag + '_' + orig;
  }

  /** Per-Scout folder name, the committee's convention: "<Name> - <Unit>" (inside the 202x folder). */
  function folderName(scoutName, unit) {
    var n = str(scoutName).replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ');
    var u = firstUnit(unit).replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ');
    return u ? n + ' - ' + u : n;
  }

  /**
   * Version per file type (proposed in element 4: ESSPP-V3 = third Proposal).
   * existing: [{tag, version}] already on the record; tags: tags of the new
   * files in order. Returns the version for each new file.
   */
  function assignVersions(existing, tags) {
    var top = {};
    (existing || []).forEach(function (e) {
      var v = Number(e.version) || 0;
      if (!top[e.tag] || v > top[e.tag]) top[e.tag] = v;
    });
    return (tags || []).map(function (t) { top[t] = (top[t] || 0) + 1; return top[t]; });
  }

  function normName(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /**
   * Unit = type + number, written T910 / C910 / S910 (Troop, Venturing Crew,
   * Sea Scout Ship). Troops and Crews often share a number, so the type matters.
   * Accepts "T910", "T 910", "Troop 910", "Venturing Crew #910", "Sea Scout Ship 910".
   * -> {type: 'T'|'C'|'S'|null, number: '910'} or null. A bare number has type null.
   */
  function parseUnit(s) {
    var u = str(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    var m = /^(venturingcrew|seascoutship|troop|crew|ship|t|c|s)?0*(\d{1,5})$/.exec(u);
    if (!m) return null;
    var w = m[1] || '';
    var type = w ? ({ t: 'T', c: 'C', s: 'S' })[w.slice(-4) === 'ship' ? 's' : w === 'venturingcrew' ? 'c' : w.charAt(0)] : null;
    return { type: type, number: m[2] };
  }

  /** Canonical for comparing units: "t910"; falls back to the squashed text. */
  function normUnit(s) {
    var p = parseUnit(s);
    if (p) return (p.type || '').toLowerCase() + p.number;
    return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /**
   * cand: clean submission. records: [{recordId, scout_name, unit, birth_date,
   * scout_email, bsa_id}] from the tracking tab. queue: [{queueId, status,
   * scout_email, bsa_id}] other Intake Queue entries.
   * Exact (BSA ID or Scout email) -> hold. Close (name + unit + birth date) -> promote, flag.
   */
  /** "Owen Patrick Fairbanks" -> "owen fairbanks" (first + last word): middle names come and go between forms. */
  function nameEnds(s) { var w = normName(s).split(' ').filter(Boolean); return w.length ? w[0] + ' ' + w[w.length - 1] : ''; }

  /**
   * exact: same Scout email or BSA ID. close: same unit and same first + last name, with the same birth date or no
   * birth date on the record (old-system rows often lack one) (2026-10-28: Owen Fairbanks / Owen Patrick Fairbanks).
   */
  function duplicateCheck(cand, records, queue) {
    var email = str(cand.scout_email).toLowerCase();
    var bsa = str(cand.bsa_id);
    var exact = [], close = [];
    (records || []).forEach(function (r) {
      var e = str(r.scout_email).toLowerCase();
      if ((email && e === email) || (bsa && str(r.bsa_id) === bsa)) { exact.push(r.recordId); return; }
      // Same names are common (e.g. Vietnamese names): a different birth date or BSA ID on both sides = a different Scout.
      var rb = dateKey(r.birth_date), rid = str(r.bsa_id);
      if (nameEnds(r.scout_name) && nameEnds(r.scout_name) === nameEnds(cand.scout_name) &&
          normUnit(r.unit) === normUnit(cand.unit) && (!rb || rb === dateKey(cand.birth_date)) &&
          !(rid && bsa && rid !== bsa)) close.push(r.recordId);
    });
    var live = [STATUS.CONFIRMED, STATUS.PROMOTED, STATUS.DUPLICATE];
    var known = {};
    (records || []).forEach(function (r) { known[r.recordId] = true; });
    (queue || []).forEach(function (q) {
      if (q.queueId === cand.queueId || live.indexOf(q.status) < 0) return;
      if (q.recordId && known[q.recordId]) return;   // promoted: its record was already checked
      if ((email && str(q.scout_email).toLowerCase() === email) || (bsa && str(q.bsa_id) === bsa)) exact.push(q.queueId);
    });
    return { exact: exact, close: close };
  }

  var B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  /** Q-yymmddhhmm-XXX, same shape as Record IDs. */
  function makeQueueId(randomFn, existing, now) {
    var rnd = randomFn || Math.random;
    var d = now || new Date();
    var stamp = pad2(d.getFullYear() % 100) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes());
    var taken = {};
    (existing || []).forEach(function (k) { taken[str(k)] = true; });
    for (var t = 0; t < 200; t++) {
      var s = 'Q-' + stamp + '-';
      for (var i = 0; i < 3; i++) s += B32.charAt(Math.floor(rnd() * B32.length));
      if (!taken[s]) return s;
    }
    throw new Error('Could not generate a unique Queue ID');
  }

  /**
   * rows: [{status, submitted: Date, note}]. Indexes of unfinished entries older than `days`. An unfinished upload
   * the committee emailed the family about ("Emailed" in its Note) is kept: it waits for the Scout's new submission
   * (which replaces it) or for the committee to dismiss it.
   */
  function purgeIndexes(rows, nowMs, days) {
    var cutoff = nowMs - days * 24 * 3600 * 1000;
    var out = [];
    (rows || []).forEach(function (r, i) {
      if (r.status !== STATUS.UPLOADING && r.status !== STATUS.UNCONFIRMED) return;
      if (r.status === STATUS.UPLOADING && /\bEmailed\b/.test(str(r.note))) return;
      var t = r.submitted instanceof Date ? r.submitted.getTime() : new Date(r.submitted).getTime();
      if (t < cutoff) out.push(i);
    });
    return out;
  }

  /** "ESSPP: proposal.pdf; Slides: deck.pptx" for the Files column. */
  function filesSummary(files) {
    return (files || []).map(function (f) { return f.tag + ': ' + f.name; }).join('; ');
  }

  function shortDate(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

  function confirmUrl(webOrigin, token) {
    var base = str(webOrigin).replace(/\/+$/, '');
    if (!base) throw new Error('Settings → webOrigin is empty');
    return base + '/confirm?c=' + encodeURIComponent(token);
  }

  var SIGN = '\n\nCoyote Creek District Advancement Committee';

  function confirmEmail(scoutName, url, days) {
    return {
      subject: 'Confirm your Eagle Project Proposal submission (' + scoutName + ')',
      body: 'We received an Eagle Project Proposal submission for ' + scoutName + '.\n\n' +
        'To finish, click this link (the Scout or a parent can click it; once is enough):\n\n' + url + '\n\n' +
        'The link works for ' + days + ' days. Until it is clicked, the committee does not start on the Proposal.\n' +
        'If you did not submit anything, ignore this email.' + SIGN
    };
  }

  /** "  Scout name: Testy McTest" lines for what was submitted (blank optional fields shown as "(not given)"). */
  function submittedList(cand) {
    return FIELDS.map(function (f) {
      var v = str(cand && cand[f.key]);
      if (v && f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { var p = v.split('-'); v = Number(p[1]) + '/' + Number(p[2]) + '/' + p[0]; }
      return f.label + ': ' + (v || '(not given)');
    });
  }

  function submittedLines(cand) { return submittedList(cand).map(function (l) { return '  ' + l; }).join('\n'); }

  function receiptEmail(scoutName, storedNames, signinUrl, cand) {
    return {
      subject: 'Eagle Project Proposal received: ' + scoutName,
      body: 'Thank you. The Coyote Creek District Advancement Committee has received the Proposal for ' + scoutName + '.\n\n' +
        (cand ? 'What you entered:\n' + submittedLines(cand) + '\n\n' +
          'To correct the project details (title, beneficiary, address, coach, BSA ID, phone), sign in at ' + signinUrl + '. ' +
          'If your name, unit, birth date or an email address is wrong, or you have a question, reply to this email.\n\n' : '') +
        'Files received:\n' + storedNames.map(function (n) { return '  - ' + n; }).join('\n') + '\n\n' +
        'What happens next: a committee member checks that everything is there (signatures, contact information). ' +
        'If something is missing, we will email you. When it is complete, you will be invited to book a short Pre-Review Call.\n\n' +
        'Check your status any time: ' + signinUrl + SIGN
    };
  }

  function heldEmail(scoutName, signinUrl) {
    return {
      subject: 'Eagle Project Proposal received: ' + scoutName,
      body: 'Thank you. We received the submission for ' + scoutName + ', and it looks like the committee may already have a record for this Scout.\n\n' +
        'A committee member will check and get back to you. If you are sending a new version of a Proposal you already sent, ' +
        'please sign in and send it as an update instead: ' + signinUrl + SIGN
    };
  }

  return {
    STATUS: STATUS, FIELDS: FIELDS, needsParent: needsParent, TAGS: TAGS, MAX_FILES: MAX_FILES,
    validate: validate, dateKey: dateKey, checkFile: checkFile, extOf: extOf, mimeFor: mimeFor,
    namePart: namePart, unitPart: unitPart, standardName: standardName, queueFileName: queueFileName, folderName: folderName, assignVersions: assignVersions,
    parseUnit: parseUnit, normUnit: normUnit, duplicateCheck: duplicateCheck, makeQueueId: makeQueueId,
    purgeIndexes: purgeIndexes, filesSummary: filesSummary, shortDate: shortDate,
    confirmUrl: confirmUrl, confirmEmail: confirmEmail, receiptEmail: receiptEmail, submittedLines: submittedLines, submittedList: submittedList, heldEmail: heldEmail
  };
})();

if (typeof module !== 'undefined') module.exports = Intake;
