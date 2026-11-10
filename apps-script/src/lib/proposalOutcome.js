/**
 * ProposalOutcome: pure rules for recording a Proposal Review outcome on the committee Review page
 * (/committee/review). Jim W., 2026-10-23.
 *
 * - Scouts offered: In-Person Review: Booked and Proposal Revisions Requested.
 * - Outcomes: Approved (signed PDF uploaded) · Revisions Requested · Not Approved.
 * - Signed copy name: <Scout_Name>-<Unit>_ESSPP-ApprovedAndSignedBy-AB&CD.pdf
 *   (initials typed "AB, CD" / "AB CD" / "ab&cd" all become "AB&CD").
 * - On approval every ESSPP-V<n> file (and an earlier signed copy) moves to Archive/.
 * - Signatures in progress (Jim W., 2026-11-08): Approved with "More signatures to come" moves the row to Proposal
 *   Approved with the copy signed so far (SignedBy-AB), sends it to the next signer(s) and does NOT email the Scout.
 *   Each next signer uploads their signed copy (SignedBy-AB&CD) and either names further signers or is the last:
 *   then the "Proposal approved" email to the Scout is drafted with the final copy. State: the Signing column
 *   ("Waiting on CD since 2026-11-08; signed AB"), blank when done. "Finish with the signatures we have" ends it early.
 * - Dates: the member picks the date (default today, or the Approved Date already on the row).
 *   A missing or later Proposal Review date is replaced by that date, with a warning first.
 */
var ProposalOutcome = (function () {
  var ELIGIBLE = ['review_booked', 'proposal_revisions'];
  var SIGNED_TAG = 'ESSPP-ApprovedAndSignedBy-';
  var OUTCOMES = {
    approved: { label: 'Approved (upload the signed Proposal)', section: 'proposal_approved', template: 'Proposal approved', file: true, past: 'Proposal approved' },
    revisions: { label: 'Revisions requested', section: 'proposal_revisions', template: 'Revisions requested', file: false, past: 'Revisions requested' },
    not_approved: { label: 'Not approved (a different project is needed)', section: 'proposal_not_approved', template: 'Proposal not approved', file: false, past: 'Proposal not approved' }
  };

  function str(v) { return v == null ? '' : String(v).trim(); }

  var SIGNING_COLUMN = 'signing', SIGNING_LABEL = 'Signatures pending';
  var SIGNING_STATUS = 'Proposal approved; committee signatures in progress';

  /** {waiting: ['CD'], since: 'YYYY-MM-DD', signed: ['AB']} -> "Waiting on CD since 2026-11-08; signed AB". */
  function signingText(x) {
    return 'Waiting on ' + (x.waiting || []).join(', ') + ' since ' + str(x.since) + '; signed ' + (x.signed || []).join('&');
  }

  /** The Signing cell -> {waiting, since, signed} or null (blank / not ours = no signatures in progress). */
  function parseSigning(text) {
    var m = /^Waiting on ([A-Za-z,& ]+?) since (\d{4}-\d{2}-\d{2})(?:; signed ([A-Za-z&, ]*))?$/.exec(str(text));
    if (!m) return null;
    var list = function (t) { return str(t).split(/[\s,&]+/).filter(Boolean).map(function (x) { return x.toUpperCase(); }); };
    return { waiting: list(m[1]), since: m[2], signed: list(m[3]) };
  }

  /** Status shown to the Scout: approved, but the family email waits for the last signature. */
  function scoutStatus(base, section, signing) {
    return section === 'proposal_approved' && parseSigning(signing) ? SIGNING_STATUS : base;
  }

  /** Signed so far + the new signer(s), in order, no repeats. */
  function addSigners(signed, more) {
    var out = (signed || []).slice();
    (more || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /**
   * Next signers: initials picked on the form, checked against the committee (who have an email) and those who signed.
   * members: [{initials, email}] -> {list, emails, errors}
   */
  function nextSigners(picked, members, signed) {
    var errors = [], list = [], emails = [];
    (picked || []).forEach(function (p) {
      var u = str(p).toUpperCase();
      if (!u || list.indexOf(u) >= 0) return;
      if ((signed || []).indexOf(u) >= 0) { errors.push(u + ' already signed.'); return; }
      var m = (members || []).filter(function (x) { return str(x.initials).toUpperCase() === u; })[0];
      if (!m || !str(m.email)) { errors.push(u + ' is not on the Committee tab with an email.'); return; }
      list.push(u); emails.push(str(m.email));
    });
    if (!list.length && !errors.length) errors.push('Pick who signs next.');
    return { list: list, emails: emails, errors: errors };
  }

  /** The email to the next signer(s). v: {scout, unit, date, signed, by, link, note} -> {subject, body}. */
  function signerEmail(v) {
    var who = str(v.scout) + (str(v.unit) ? ' (' + str(v.unit) + ')' : '');
    return {
      subject: 'Please sign: Eagle Project Proposal for ' + who,
      body: [
        'The committee approved the Eagle Scout Service Project Proposal for ' + who + ' on ' + str(v.date) + '.',
        'Signed so far: ' + str(v.signed) + '. The signed copy is attached.', '',
        'To add your signature:',
        '1. Sign the attached PDF.',
        '2. Upload it here: ' + str(v.link),
        '3. If you are the last to sign, leave "More signatures to come" unticked: the approval email to the Scout is then drafted in the Outbox with the fully signed Proposal attached. Otherwise tick it and pick who signs next.', '',
        'The Scout is not told yet: their page says "' + SIGNING_STATUS + '".'
      ].concat(str(v.note) ? ['', 'Note: ' + str(v.note)] : []).concat(['', 'Sent for ' + str(v.by) + ' by the Eagle Tracker.']).join('\n')
    };
  }

  /** Log line for a signature step: "11/8 [CD] Signature added (AB&CD, file.pdf); waiting on PQ" / "; signatures complete". */
  function signLogLine(shortDate, by, what, signedText, fileName, waiting) {
    return shortDate + ' [' + (str(by) || 'committee') + '] ' + what + ' (' + signedText + (fileName ? ', ' + fileName : '') + ')' +
      ((waiting || []).length ? '; waiting on ' + waiting.join(', ') : '; signatures complete');
  }

  /** Digest: signatures waiting too long. records: [{title, signing}] -> [{title, waiting, days}] (days >= after). */
  function signingOverdue(records, today, after) {
    var limit = Number(after) || 3;
    return (records || []).map(function (r) {
      var p = parseSigning(r.signing);
      if (!p) return null;
      var days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(p.since + 'T00:00:00Z')) / 86400000);
      return days >= limit ? { title: r.title, waiting: p.waiting.join(', '), days: days } : null;
    }).filter(Boolean);
  }

  /**
   * "AB, CD" / "AB CD" / "a.b. & cd" / "AB and CD" -> {text: 'AB&CD', list: ['AB','CD'], errors, unknown}.
   * known: initials on the Committee tab (unknown ones are a warning, not an error: helpers sign too).
   */
  function normalizeInitials(text, known) {
    var errors = [];
    var tokens = str(text).replace(/\./g, '').split(/(?:[\s,;&\/+]+|\band\b)+/i).filter(Boolean);
    var list = [];
    tokens.forEach(function (t) {
      var u = t.toUpperCase();
      if (!/^[A-Z]{1,4}$/.test(u)) { errors.push('"' + t + '" doesn\'t look like initials (letters only, e.g. AB).'); return; }
      if (list.indexOf(u) < 0) list.push(u);
    });
    if (!list.length && !errors.length) errors.push('Enter the initials of the committee member(s) who signed.');
    var k = (known || []).map(function (x) { return str(x).toUpperCase(); });
    var unknown = known ? list.filter(function (x) { return k.indexOf(x) < 0; }) : [];
    return { text: list.join('&'), list: list, errors: errors, unknown: unknown };
  }

  /** namePart / unitPart: Intake's file-name rules (passed in so this file has no load-time globals). */
  function signedFileName(scoutName, unit, initialsText, namePart, unitPart) {
    return namePart(scoutName) + '-' + unitPart(unit) + '_' + SIGNED_TAG + initialsText + '.pdf';
  }

  function isSignedName(name) { return str(name).indexOf('_' + SIGNED_TAG) >= 0; }
  function isProposalVersion(name) { return /_ESSPP-V\d+(\.[A-Za-z0-9]+)?$/.test(str(name)); }

  /** top: [{id, name}] at the folder's top level; keepId: the new signed copy. -> ids to move to Archive. */
  function archivePlan(top, keepId) {
    return (top || []).filter(function (f) {
      return f.id !== keepId && (isProposalVersion(f.name) || isSignedName(f.name));
    }).map(function (f) { return f.id; });
  }

  function isPdfName(name) { return /\.pdf$/i.test(str(name)); }

  /**
   * Dates as 'YYYY-MM-DD'. input: {outcome, date (picked), today, reviewDate, approvedDate}.
   * -> {errors, warnings, set: {reviewDate, approvedDate}} (null = leave the cell alone).
   */
  function datePlan(input) {
    var errors = [], warnings = [], set = { reviewDate: null, approvedDate: null };
    var d = str(input.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { errors.push('Pick the date of the decision.'); return { errors: errors, warnings: warnings, set: set }; }
    if (input.today && d > input.today) errors.push('The date can\'t be in the future.');
    var rd = str(input.reviewDate);
    if (!rd) {
      warnings.push('The row has no Proposal Review date. It will be set to ' + nice(d) + '.');
      set.reviewDate = d;
    } else if (rd > d) {
      warnings.push('The Proposal Review date on the row (' + nice(rd) + ') is after ' + nice(d) + '. It will be changed to ' + nice(d) + '.');
      set.reviewDate = d;
    }
    if (input.outcome === 'approved') {
      var ad = str(input.approvedDate);
      if (ad && ad !== d) warnings.push('The row already has Approved Date ' + nice(ad) + '. It will be changed to ' + nice(d) + '.');
      if (ad !== d) set.approvedDate = d;
    }
    return { errors: errors, warnings: warnings, set: set };
  }

  function nice(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
    return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : str(ymd);
  }

  /** Life to Eagle Log line: "10/23 [JW] Proposal approved, signed by AB&CD (file.pdf). Note: ..." */
  function logLine(shortDate, by, outcome, initialsText, fileName, note) {
    var o = OUTCOMES[outcome];
    var s = shortDate + ' [' + (str(by) || 'committee') + '] ' + (o ? o.past : outcome);
    if (outcome === 'approved') s += ', signed by ' + initialsText + (fileName ? ' (' + fileName + ')' : '');
    else if (initialsText) s += ' (' + initialsText + ')';
    var n = str(note).replace(/\s+/g, ' ');
    return s + (n ? '. Note: ' + n : '');
  }

  /**
   * Review page dropdown. records: [{recordId, section, scout_name, unit, who, reviewDate ('YYYY-MM-DD'), approvedDate}].
   * Reviews already held first (oldest first), then upcoming / undated.
   */
  function choices(records, labelFn, today) {
    return (records || []).filter(function (r) {
      return str(r.scout_name) && (ELIGIBLE.indexOf(r.section) >= 0 || (r.section === 'proposal_approved' && parseSigning(r.signing)));
    })
      .map(function (r) {
        return { recordId: r.recordId, name: str(r.scout_name), unit: str(r.unit), section: r.section,
          stage: labelFn ? labelFn(r.section) : r.section, who: str(r.who), reviewDate: str(r.reviewDate),
          approvedDate: str(r.approvedDate), upcoming: !!(r.reviewDate && today && str(r.reviewDate) > today), pending: !!r.pending,
          signing: r.section === 'proposal_approved' ? parseSigning(r.signing) : null };
      })
      .sort(function (a, b) {
        if (a.upcoming !== b.upcoming) return a.upcoming ? 1 : -1;
        return (a.reviewDate || '9999') < (b.reviewDate || '9999') ? -1 : (a.reviewDate || '9999') > (b.reviewDate || '9999') ? 1 : a.name.localeCompare(b.name);
      });
  }

  /**
   * Dashboard counts. records: [{section, reviewDate}]; slots: CommitteeSchedule.entries; outboxPending: number.
   */
  function homeCounts(records, slots, outboxPending, nowMs, today) {
    var DAY = 24 * 3600 * 1000;
    var recs = records || [];
    return {
      outbox: Number(outboxPending) || 0,
      upcoming: (slots || []).filter(function (x) { return x.booked && x.type !== 'CCAC' && x.start >= nowMs && x.start < nowMs + 14 * DAY; }).length,
      awaitingOutcome: recs.filter(function (r) { return r.section === 'review_booked' && str(r.reviewDate) && str(r.reviewDate) < today; }).length,
      revisions: recs.filter(function (r) { return r.section === 'proposal_revisions'; }).length,
      toApprove: recs.filter(function (r) { return ELIGIBLE.indexOf(r.section) >= 0; }).length,
      signing: recs.filter(function (r) { return r.section === 'proposal_approved' && parseSigning(r.signing); }).length,
      // New files waiting on the committee (state-model-v3): r.pending = ms of the oldest unchecked submission, 0 = none.
      pending: recs.filter(function (r) { return r.pending > 0; }).length,
      oldestPendingDays: recs.reduce(function (d, r) { return r.pending > 0 ? Math.max(d, Math.floor((nowMs - r.pending) / DAY)) : d; }, 0)
    };
  }

  return {
    ELIGIBLE: ELIGIBLE, OUTCOMES: OUTCOMES, SIGNED_TAG: SIGNED_TAG,
    normalizeInitials: normalizeInitials, signedFileName: signedFileName, isSignedName: isSignedName,
    isProposalVersion: isProposalVersion, archivePlan: archivePlan, isPdfName: isPdfName,
    datePlan: datePlan, nice: nice, logLine: logLine, choices: choices, homeCounts: homeCounts,
    SIGNING_COLUMN: SIGNING_COLUMN, SIGNING_LABEL: SIGNING_LABEL, SIGNING_STATUS: SIGNING_STATUS,
    signingText: signingText, parseSigning: parseSigning, scoutStatus: scoutStatus, addSigners: addSigners,
    nextSigners: nextSigners, signerEmail: signerEmail, signLogLine: signLogLine, signingOverdue: signingOverdue
  };
})();

if (typeof module !== 'undefined') module.exports = ProposalOutcome;
