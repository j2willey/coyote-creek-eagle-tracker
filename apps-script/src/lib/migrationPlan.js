/**
 * MigrationPlan: work out, without writing anything, how to add the
 * Option B structure to a tracking tab:
 *   - hidden _key column (column A)
 *   - Action column (dropdown of sections), just left of Eagle Candidate, unless one exists
 *   - hidden machine header row (directly above the visible label row)
 *   - section keys on section label rows
 *   - Record IDs on Candidate Record rows
 *   - a new "Pre-Review Call" section row (before "Proposals Pending Review Date")
 *
 * Pure. Input = getValues() of the whole tab. Output = a plan the adapter
 * (tools/migrate.js) applies, and a human-readable report for the dry run.
 * Depends on SheetModel (global in Apps Script, require() in Node).
 */
var MigrationPlan = (function () {
  function SM() {
    return (typeof SheetModel !== 'undefined') ? SheetModel : require('./sheetModel');
  }
  function str(v) { return v == null ? '' : String(v).trim(); }

  /**
   * rows: 2D array (whole tab). settings: parsed Settings (sections).
   * randomFn: optional, for deterministic tests.
   */
  function plan(rows, settings, randomFn) {
    var sm = SM();
    var report = [];
    var warnings = [];

    var existing = sm.findMachineRow(rows.slice(0, 15));
    if (existing) {
      return { alreadyMigrated: true, machineRow: existing.row, keyCol: existing.keyCol,
               report: ['Already migrated: machine header row is row ' + (existing.row + 1) +
                        ', key column ' + sm.colLetter(existing.keyCol) + '.'], warnings: [] };
    }

    var labelRow = sm.findLabelRow(rows, 'Eagle Candidate', 15);
    if (labelRow < 0) {
      return { error: 'Could not find the header row (a cell reading "Eagle Candidate") in the first 15 rows.',
               report: [], warnings: [] };
    }
    var groupRow = labelRow > 0 ? rows[labelRow - 1] : [];
    var width = rows.reduce(function (m, r) { return Math.max(m, lastNonEmpty(r) + 1); }, 0);
    var names = sm.proposeMachineNames(pad(groupRow, width), pad(rows[labelRow], width));
    // The hidden _key column is inserted as column A; everything shifts right by one.
    // Row/column indexes in `rows` are pre-insert; the plan's output columns are post-insert.
    var nameCol = names.indexOf('scout_name');
    // Action column: inserted just left of Eagle Candidate (after the key column), unless the sheet has one.
    // addAction.col = 0-based column index in the final layout.
    var addAction = (names.indexOf('action') < 0) ? { col: (nameCol >= 0 ? nameCol : 0) + 1, label: 'Action' } : null;
    var machineRow = [sm.KEY_HEADER].concat(names);
    if (addAction) machineRow.splice(addAction.col, 0, 'action');
    // Final column (0-based) of a pre-insert column index.
    function finalCol(i) { var c = i + 1; return (addAction && c >= addAction.col) ? c + 1 : c; }

    report.push('Header row: ' + (labelRow + 1) + (labelRow > 0 ? ' (group row ' + labelRow + ')' : '') + ' (before the new hidden row)');
    report.push('New hidden _key column: A');
    if (addAction) report.push('New Action column: ' + sm.colLetter(addAction.col) + ' (left of Eagle Candidate)');
    else report.push('Action column: already there');
    report.push('Machine names (letters after the inserts):');
    names.forEach(function (n, i) {
      report.push('  ' + sm.colLetter(finalCol(i)) + '  ' + n + '   ← "' + str(rows[labelRow][i]) + '"');
    });

    var found = sm.detectSectionRows(rows, settings.sections, { startRow: labelRow + 1 });
    var sectionWrites = [];
    var labelColGuess = 0;
    settings.sections.forEach(function (s) {
      if (found[s.key] === undefined) return;
      var r = found[s.key];
      labelColGuess = firstNonEmpty(rows[r]);
      sectionWrites.push({ row: r, key: s.key, text: str(rows[r][labelColGuess]) });
    });
    sectionWrites.sort(function (a, b) { return a.row - b.row; });
    report.push('Sections found:');
    sectionWrites.forEach(function (w) { report.push('  row ' + (w.row + 1) + '  S:' + w.key + '   "' + w.text + '"'); });

    var missing = settings.sections.filter(function (s) { return found[s.key] === undefined; }).map(function (s) { return s.key; });
    var insertPreReview = null;
    if (missing.indexOf('intake_to_book') >= 0) {
      var before = found['review_to_book'];
      var sec = settings.sections.filter(function (s) { return s.key === 'intake_to_book'; })[0];
      var lbl = sec && sec.label ? sec.label : 'Intake Review: To Book';
      if (before === undefined) {
        warnings.push('Cannot add "' + lbl + '": the In-Person Review "To Book" section (review_to_book) was not found.');
      } else {
        insertPreReview = { beforeRow: before, labelCol: finalCol(firstNonEmpty(rows[before])),
                            text: lbl, copyFormatFrom: before };
        report.push('Will insert "' + lbl + '" section row above row ' + (before + 1));
      }
      missing = missing.filter(function (k) { return k !== 'intake_to_book'; });
    }
    // EBoR-workflow sections and New Submissions are added later by Admin → Setup / repair tabs (ensureSectionRows_), not by the migration.
    missing = missing.filter(function (k) { return ['app_verified', 'ebor_booked', 'ebor_paused', 'eagle_earned', 'eagle_not_awarded', 'proposal_received', 'intake_booked', 'intake_revisions'].indexOf(k) < 0; });
    missing.forEach(function (k) { warnings.push('Section not found on sheet: ' + k); });

    // Order check: not a blocker (the scripts don't care); the committee drags whole sections afterwards
    // (e.g. Beyond Age / Unapproved moved to the bottom, Jim W. 2026-10-18).
    var prev = -1, outOfOrder = [];
    settings.sections.forEach(function (s) {
      if (found[s.key] === undefined) return;
      if (found[s.key] < prev) outOfOrder.push(s.label || s.key);
      prev = Math.max(prev, found[s.key]);
    });
    if (outOfOrder.length) report.push('After migrating, drag these sections (header row + its Scouts) to match the Settings order: ' + outOfOrder.join(', '));

    // Records
    var sectionRowSet = {};
    sectionWrites.forEach(function (w) { sectionRowSet[w.row] = true; });
    var firstSection = sectionWrites.length ? sectionWrites[0].row : rows.length;
    var recordWrites = [];
    var skipped = [];
    var ids = [];
    var countBySection = {};
    var current = null;
    if (nameCol < 0) warnings.push('No "Eagle Candidate" column mapped to scout_name; no Record IDs will be assigned.');
    for (var r = labelRow + 1; r < rows.length; r++) {
      if (sectionRowSet[r]) {
        current = sectionWrites.filter(function (w) { return w.row === r; })[0].key;
        continue;
      }
      if (nameCol < 0) break;
      var name = str(rows[r][nameCol]);
      if (!name) continue;
      if (name.toLowerCase() === 'eagle candidate') { skipped.push({ row: r, why: 'repeated header row' }); continue; }
      if (r < firstSection) warnings.push('Row ' + (r + 1) + ' has a name but sits above the first section.');
      var id = sm.makeRecordId(randomFn, ids);
      ids.push(id);
      recordWrites.push({ row: r, id: id, section: current });
      countBySection[current || '(none)'] = (countBySection[current || '(none)'] || 0) + 1;
    }
    report.push('Candidate Records: ' + recordWrites.length);
    Object.keys(countBySection).forEach(function (k) { report.push('  ' + k + ': ' + countBySection[k]); });
    skipped.forEach(function (s) { report.push('Skipped row ' + (s.row + 1) + ': ' + s.why); });

    return {
      labelRow: labelRow,
      keyCol: 0,
      addAction: addAction,
      machineNames: machineRow,
      sectionWrites: sectionWrites,
      recordWrites: recordWrites,
      insertPreReview: insertPreReview,
      skipped: skipped,
      report: report,
      warnings: warnings
    };
  }

  function lastNonEmpty(row) {
    for (var i = row.length - 1; i >= 0; i--) if (str(row[i])) return i;
    return -1;
  }
  function firstNonEmpty(row) {
    for (var i = 0; i < row.length; i++) if (str(row[i])) return i;
    return 0;
  }
  function pad(row, n) {
    var out = (row || []).slice(0, n);
    while (out.length < n) out.push('');
    return out;
  }

  return { plan: plan };
})();

if (typeof module !== 'undefined') module.exports = MigrationPlan;
