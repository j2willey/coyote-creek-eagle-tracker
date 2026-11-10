/**
 * Closed records (Jim W., 2026-11-10). Rules in lib/closing.js.
 *
 * A record that will not come back (withdrew, aged out with no extension, extension denied, moved away, duplicate)
 * moves to the terminal "Closed" stage: visible, reversible, cleared once a year by the January archive
 * (adminActions.js). Dashboard row actions, handled from actionRowAction_ (rowActions.js):
 *   close      Close record…   reason, date, optional note -> Closed; _closed remembers {reason, date, by, from, note}
 *   reopen     Reopen…         back to where it came from (or a chosen stage); a reason is required
 *   keep       Keep open       hides the "Close?" suggestion for Settings → closeSnoozeDays
 * None of them sends an email (members can still use Email…), clears "new files" and writes the Life to Eagle Log.
 * The Scout's folder does NOT move when a record is closed (the January archive moves it).
 */

/** The row actions above. c: committeeMe_ result; req: the rowAction request. */
function actionClosing_(c, req) {
  var a = StageActions.get(String(req.kind || ''));
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the page.');
  var s = getSettings_();
  if (a.sections.indexOf(rec.section) < 0) {
    throw userError_(rec.fields.scout_name + ' is now in ' + SettingsModel.sectionLabel(s, rec.section) + ', where "' + a.label.replace(/…$/, '') + '" does not apply. Reload the page.');
  }
  var cols = Records.columns();
  var needCol = a.closing === 'keep' ? Closing.SNOOZE_COLUMN : Closing.COLUMN;
  if (cols.indexOf(needCol) < 0) throw userError_('The tracking tab has no hidden ' + needCol + ' column yet. Run Admin → Setup / repair tabs, then try again.');
  var by = c.me.initials || c.email, today = todayYmd_(), short = Intake.shortDate(new Date());
  var scout = String(rec.fields.scout_name || '');
  var cleared = {};
  cleared[Closing.COLUMN] = '';
  if (cols.indexOf(Closing.SNOOZE_COLUMN) >= 0) cleared[Closing.SNOOZE_COLUMN] = '';

  if (a.closing === 'close') {
    var p = Closing.closePlan({ section: rec.section, reason: req.reason, reasonText: req.reasonText, date: req.date, today: today, note: req.note, by: by });
    if (p.errors.length) throw userError_(p.errors.join(' '));
    var cell = {};
    cell[Closing.COLUMN] = Closing.closedCell(p.closed);
    Records.update(rec.recordId, cell);
    try { Records.move(rec.recordId, Closing.SECTION); }
    catch (e) { Records.update(rec.recordId, cleared); throw e; }          // no Closed section yet: leave the record as it was
    clearPending_(rec.recordId);
    addRecordNote_(rec.recordId, Closing.closeLine(short, by, p.closed.r, p.closed.n));
    return { message: scout + ': closed (' + p.closed.r + '). No email was sent; the folder has not moved. Reopen is on the Closed row.', outboxId: '' };
  }

  if (a.closing === 'reopen') {
    var closed = Closing.parseClosed(rec.fields[Closing.COLUMN]);
    var keys = (s.sections || []).map(function (x) { return x.key; });
    var rp = Closing.reopenPlan({ closed: closed, to: req.to, reason: req.note, sectionKeys: keys });
    if (rp.errors.length) throw userError_(rp.errors.join(' '));
    Records.update(rec.recordId, cleared);
    Records.move(rec.recordId, rp.to);
    clearPending_(rec.recordId);
    addRecordNote_(rec.recordId, Closing.reopenLine(short, by, SettingsModel.sectionLabel(s, rp.to), req.note));
    return { message: scout + ': reopened in ' + SettingsModel.sectionLabel(s, rp.to) + '. No email was sent.', outboxId: '' };
  }

  // keep: snooze the "Close?" suggestion
  var days = Closing._util.posInt(s.closeSnoozeDays, Closing.DEFAULT_SNOOZE_DAYS);
  var until = Closing._util.addDays(today, days);
  var snz = {};
  snz[Closing.SNOOZE_COLUMN] = until;
  Records.update(rec.recordId, snz);
  var n = String(req.note || '').replace(/\s+/g, ' ').trim();
  addRecordNote_(rec.recordId, short + ' [' + by + '] Kept open: close review snoozed ' + days + ' days' + (n ? ' (' + n + ')' : ''));
  return { message: scout + ': kept open; no "Close?" suggestion for ' + days + ' days.', outboxId: '' };
}
