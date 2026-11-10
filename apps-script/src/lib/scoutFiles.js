/**
 * ScoutFiles (M7): pure rules for a Scout's folder and Scout Updates.
 *
 * - Top level of <Name> <Unit>/ holds only the LATEST file of each type;
 *   superseded versions move to <Name> <Unit>/Archive/ (Jim W., 2026-10-12).
 * - Versions count per file type across top level + Archive (element 4).
 * - A Scout Update may correct project/contact fields; name, unit, birth
 *   date and the two email addresses stay with the committee for now.
 */
var ScoutFiles = (function () {
  var ARCHIVE = 'Archive';
  var EDITABLE = ['preferred_name', 'scout_phone', 'bsa_id', 'proj_title', 'beneficiary', 'proj_address', 'proj_coach', 'est_fundraising'];
  var READONLY = ['scout_name', 'unit', 'birth_date', 'scout_email', 'parent_email'];

  function str(v) { return v == null ? '' : String(v).trim(); }

  /** "Scout_Nine-T109_ESSPP-V2.pdf" -> {tag:'ESSPP', version:2}; anything else -> null. */
  function parseStandardName(name) {
    var m = /_([A-Za-z]+)-V(\d+)(\.[A-Za-z0-9]+)?$/.exec(str(name));
    return m ? { tag: m[1], version: Number(m[2]) } : null;
  }

  /** names: file names in the folder and its Archive. -> [{tag, version}] */
  function existingVersions(names) {
    return (names || []).map(parseStandardName).filter(Boolean);
  }

  /**
   * top: [{id, name}] files at the top level. newIds: files just added.
   * Returns ids to move to Archive: older standard-named files of a tag that
   * just got a new version. Files without a standard name are left alone.
   */
  function toArchive(top, newIds) {
    var newTags = {};
    (top || []).forEach(function (f) {
      if (newIds.indexOf(f.id) < 0) return;
      var p = parseStandardName(f.name);
      if (p) newTags[p.tag] = true;
    });
    return (top || []).filter(function (f) {
      if (newIds.indexOf(f.id) >= 0) return false;
      var p = parseStandardName(f.name);
      return p && newTags[p.tag];
    }).map(function (f) { return f.id; });
  }

  /** Compare as the Scout sees them (dates as YYYY-MM-DD). */
  function show(v, dateKeyFn) {
    if (v instanceof Date) {
      if (dateKeyFn) return dateKeyFn(v);
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };   // local date, not UTC
      return v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
    }
    return str(v);
  }

  /**
   * current: {key: value from the sheet}; edits: {key: new value} (already
   * validated). fields: Intake.FIELDS. -> [{key, label, from, to}] for keys that changed.
   */
  function diff(current, edits, fields) {
    var out = [];
    (fields || []).forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(edits || {}, f.key)) return;
      var from = show(current[f.key]);
      var to = str(edits[f.key]);
      if (from !== to) out.push({ key: f.key, label: f.label, from: from, to: to });
    });
    return out;
  }

  /**
   * A new project title on an Unapproved Proposal = a new project: the row goes
   * back to New Submissions and the process starts over (Jim W., 2026-10-18).
   */
  function restartsReview(sectionKey, changes) {
    return sectionKey === 'proposal_not_approved' && (changes || []).some(function (c) { return c.key === 'proj_title' && str(c.to); });
  }

  function describeChanges(changes) {
    return changes.map(function (c) {
      return c.label + ': "' + (c.from || '(blank)') + '" → "' + (c.to || '(blank)') + '"';
    });
  }

  /**
   * A new name or unit (Jim W., 2026-11-04): the tool's own files follow it. Only names that start with the old
   * "<Name>-<Unit>" prefix and then "_" or "-Application_" (ESSPP-V2, signed copies, EBoR scans and photos, Council
   * application files); anything else (files from before the tool) keeps its name.
   * files: [{id, name}]; prefixes from Intake.namePart + '-' + Intake.unitPart. -> [{id, from, to}]
   */
  function renamePlan(files, oldPrefix, newPrefix) {
    var o = str(oldPrefix), n = str(newPrefix);
    if (!o || !n || o === n) return [];
    return (files || []).filter(function (f) {
      var name = str(f.name);
      return name.indexOf(o + '_') === 0 || name.indexOf(o + '-Application_') === 0;
    }).map(function (f) { return { id: f.id, from: str(f.name), to: n + str(f.name).slice(o.length) }; });
  }

  /** Notes line, newest-first convention: "10/12 [tool] Update: ESSPP-V2, Slides-V1; Beneficiary ..." */
  function noteLine(shortDate, source, storedNames, changes) {
    var parts = [];
    var vers = (storedNames || []).map(function (n) {
      var p = parseStandardName(n); return p ? p.tag + '-V' + p.version : n;
    });
    if (vers.length) parts.push(vers.join(', '));
    if (changes && changes.length) parts.push(describeChanges(changes).join('; '));
    return shortDate + ' [tool] ' + source + ': ' + (parts.join('; ') || 'no changes');
  }

  /**
   * The Scout's "brief description of the changes" (Jim W., 2026-10-26): one line for the log, at most `max`
   * characters (default 500; longer text is cut with "…"). Line breaks become " / ".
   */
  var DESCRIPTION_MAX = 500;
  function cleanDescription(text, max) {
    var n = Number(max) || DESCRIPTION_MAX;
    var t = str(text).replace(/\r\n?/g, '\n').split('\n').map(str).filter(Boolean).join(' / ').replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
  }
  function descriptionLine(shortDate, text) {
    var t = cleanDescription(text);
    return t ? shortDate + ' Scout description of updates: "' + t + '"' : '';
  }

  /** A note typed in the sheet gets today's date unless it already starts with one ("10/9 ..."). */
  function datedNote(text, shortDate) {
    var t = str(text);
    if (!t) return '';
    return /^\d{1,2}\/\d{1,2}\b/.test(t) ? t : shortDate + ' ' + t;
  }

  /** Name of a Scout's log (in their folder; starts like the folder so it sorts with their files). */
  function notesDocName(scoutName, unit) { return str(scoutName) + ' - ' + str(unit) + ' - Life to Eagle Log'; }

  /** Prepend a line to an existing notes cell (newest on top). */
  function prependNote(existing, line) {
    var e = str(existing);
    return e ? line + '\n' + e : line;
  }

  var SIGN = '\n\nCoyote Creek District Advancement Committee';

  function updateReceipt(scoutName, storedNames, changes, signinUrl, description) {
    var lines = ['We received an update for ' + scoutName + '.', ''];
    if (cleanDescription(description)) lines.push('Your description: ' + cleanDescription(description), '');
    if (storedNames.length) {
      lines.push('Files added:');
      storedNames.forEach(function (n) { lines.push('  - ' + n); });
      lines.push('');
    }
    if (changes.length) {
      lines.push('Information changed:');
      describeChanges(changes).forEach(function (d) { lines.push('  - ' + d); });
      lines.push('');
    }
    lines.push('Earlier versions are kept by the committee. See your status any time: ' + signinUrl);
    return { subject: 'Eagle Project update received: ' + scoutName, body: lines.join('\n') + SIGN };
  }

  function attachedEmail(scoutName, storedNames, signinUrl) {
    return {
      subject: 'Eagle Project files received: ' + scoutName,
      body: 'Thank you. We matched this submission to the record we already have for ' + scoutName +
        ' and added the files to it:\n\n' + storedNames.map(function (n) { return '  - ' + n; }).join('\n') + '\n\n' +
        'Next time, please sign in and use "Send an update" instead of the first-time form. ' +
        'Signing in also lets you correct your project details: ' + signinUrl + SIGN
    };
  }

  /**
   * The committee's latest request to the family (an Incomplete / Revisions / Paused / Not approved note, which also
   * went into the email), kept in the hidden _request column as JSON {s: section it belongs to, t: text, d: 'YYYY-MM-DD'}.
   * Shown on the Scout's page while the row is still in that section (Jim W., 2026-10-24).
   */
  function requestCell(sectionKey, text, ymd) {
    var t = str(text);
    return t ? JSON.stringify({ s: sectionKey, t: t.slice(0, 2000), d: str(ymd) }) : '';
  }
  function requestFor(cell, sectionKey) {
    try {
      var o = JSON.parse(str(cell) || 'null');
      return o && o.t && o.s === sectionKey ? { text: str(o.t), date: str(o.d) } : null;
    } catch (e) { return null; }
  }

  return {
    requestCell: requestCell, requestFor: requestFor,
    DESCRIPTION_MAX: DESCRIPTION_MAX, cleanDescription: cleanDescription, descriptionLine: descriptionLine,
    restartsReview: restartsReview,
    ARCHIVE: ARCHIVE, EDITABLE: EDITABLE, READONLY: READONLY,
    parseStandardName: parseStandardName, existingVersions: existingVersions, toArchive: toArchive,
    diff: diff, show: show, renamePlan: renamePlan, describeChanges: describeChanges, noteLine: noteLine, prependNote: prependNote,
    datedNote: datedNote, notesDocName: notesDocName,
    updateReceipt: updateReceipt, attachedEmail: attachedEmail
  };
})();

if (typeof module !== 'undefined') module.exports = ScoutFiles;
