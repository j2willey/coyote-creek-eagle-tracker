/**
 * The Eagle earned page (/committee/eagle; Jim W., 2026-11-17; rules in lib/eagleBoards.js). Made for a phone at the
 * board: the member's own boards come first, a Scout picked from someone else's board gets a warning (never a silent
 * redirect), and the save can be undone for a few minutes. Saving itself is the dashboard's "Eagle earned…" action
 * (rowAction / uploadRowFile / rowFinish in rowActions.js), so both paths behave the same.
 *
 * Router actions:
 *   eagleBoards {session, recordId?}  -> {me, today, mine: [board], all: [board], decide: {mode, recordId, own}, scout, action}
 *   eagleUndo   {session, recordId}   -> {message}
 */
var EAGLE_UNDO_PREFIX = 'eu:';

/** EBoR slots (with a Scout) from yesterday through today, with what the page shows about each. */
function eagleWindowBoards_(today) {
  var tz = Session.getScriptTimeZone();
  var yesterday = Utilities.formatDate(new Date(new Date(today + 'T12:00:00').getTime() - 86400000), tz, 'yyyy-MM-dd');
  var committee = [];
  try { committee = committee_(); } catch (e) { /* names only */ }
  var out = [];
  readSchedule_().rows.forEach(function (r) {
    var id = String(r.record_id || '').trim();
    if (!id || Booking.typeCode(r.slot_type) !== 'EBoR') return;
    var start = Booking.slotStart(r.date, r.time);
    if (isNaN(start)) return;
    var ymd = Utilities.formatDate(new Date(start), tz, 'yyyy-MM-dd');
    if (ymd < yesterday || ymd > today) return;
    var rec = Records.get(id);
    if (!rec) return;
    var reps = Booking.splitWho(r.reps);
    out.push({ key: String(r._key || ''), recordId: id, ymd: ymd, start: start, reps: reps,
      when: Utilities.formatDate(new Date(start), tz, ymd === today ? "'Today' h:mm a" : "EEE M/d h:mm a"),
      where: String(r.location || r.place || '').trim(),
      scout: EagleDone.display(rec.fields.scout_name, rec.fields.preferred_name), unit: String(rec.fields.unit || ''),
      section: rec.section, district: Booking.resolveWho(reps, committee).names,
      unitMembers: Units.parseBoard(r.board_members).map(function (m) { return m.name; }).filter(String) });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

function actionEagleBoards_(req) {
  var c = committeeMe_(req.session);
  var today = todayYmd_();
  var all = [];
  try { all = eagleWindowBoards_(today); } catch (e) { console.warn('eagleBoards schedule: ' + e); }
  var mine = EagleBoards.mine(all, c.me.initials);
  var d = EagleBoards.decide(String(req.recordId || ''), mine);
  var scout = d.recordId ? eagleScout_(c, d.recordId, today) : null;
  return {
    me: { name: String(c.me.name || ''), initials: String(c.me.initials || ''), email: c.email }, today: today,
    mine: mine, all: all, decide: d, scout: scout, undoMinutes: EagleBoards.UNDO_MINUTES,
    action: StageActions.forSection('ebor_booked').filter(function (a) { return a.key === 'eagle_earned'; })[0] || null,
    testMode: getSettings_().testMode !== false
  };
}

/** The picked Scout: who, which board, whether the paperwork already went to Council, and an Undo still open. */
function eagleScout_(c, recordId, today) {
  var rec = Records.get(String(recordId));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab. Reload the dashboard.');
  var cols = stageColumns_();
  var board = null;
  try { board = EborPaperwork.boardFor(readSchedule_().rows, rec.recordId, today); } catch (e) { /* no board info */ }
  var committee = [];
  try { committee = committee_(); } catch (e) { /* names only */ }
  var ticket = eagleUndoTicket_(rec.recordId);
  var announce = '';
  try { announce = (eagleAnnounce_()[rec.recordId] || ''); } catch (e) { /* optional */ }
  return {
    recordId: rec.recordId, name: EagleDone.display(rec.fields.scout_name, rec.fields.preferred_name), unit: String(rec.fields.unit || ''),
    section: rec.section, stage: SettingsModel.sectionLabel(getSettings_(), rec.section),
    ebor: cols.ebor ? (Intake.dateKey(rec.fields[cols.ebor]) || '') : '',
    councilSent: cols.signedSent ? (Intake.dateKey(rec.fields[cols.signedSent]) || '') : '',
    board: board ? { ymd: board.ymd, time: board.time, district: Booking.resolveWho(board.reps, committee).names,
      unitMembers: Units.parseBoard(board.boardMembers).map(function (m) { return m.name; }).filter(String),
      onIt: EagleBoards.onBoard(board.reps, c.me.initials) } : null,
    eagleNumber: announce,
    undo: ticket && !EagleBoards.undoProblem(ticket, Date.now(), c.email, Access.isAdmin(c.me, c.email, getSettings_()), rec.section)
      ? { until: Number(ticket.at) + EagleBoards.UNDO_MINUTES * 60000 } : null
  };
}

function eagleUndoTicket_(recordId) {
  try { var raw = CacheService.getScriptCache().get(EAGLE_UNDO_PREFIX + recordId); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

/** rowActions.js calls this after "Eagle earned": what Undo needs (kept in the script cache for the undo window). */
function rememberEagleUndo_(recordId, t) {
  try { CacheService.getScriptCache().put(EAGLE_UNDO_PREFIX + recordId, JSON.stringify(t), EagleBoards.UNDO_MINUTES * 60 + 60); }
  catch (e) { console.warn('rememberEagleUndo_: ' + e); }
}

/**
 * Undo "Eagle earned": back to EBoR Booked, the EBoR date as it was (and not painted), Eagles to Date back where it still
 * shows the number given, the unsent drafts discarded. Files saved in the folder stay (the application, photos).
 */
function actionEagleUndo_(req) {
  var c = committeeMe_(req.session);
  var by = c.me.initials || c.email;
  var rec = Records.get(String(req.recordId || ''));
  if (!rec) throw userError_('That Scout is no longer on the tracking tab.');
  var t = eagleUndoTicket_(rec.recordId);
  var why = EagleBoards.undoProblem(t, Date.now(), c.email, Access.isAdmin(c.me, c.email, getSettings_()), rec.section);
  if (why) throw userError_(why);
  CacheService.getScriptCache().remove(EAGLE_UNDO_PREFIX + rec.recordId);
  var cols = stageColumns_(), notes = [];
  Records.move(rec.recordId, 'ebor_booked');
  if (cols.ebor) {
    var upd = {};
    upd[cols.ebor] = t.prevEbor ? ymdToDate_(t.prevEbor) : '';
    if (t.prevEbor !== t.ebor) Records.update(rec.recordId, upd);
    paintCell_(rec.recordId, cols.ebor, null);
  }
  try { var back = unbumpEagleCounts_(rec, t.nums || [], by); if (back.length) notes.push('Eagles to Date put back (' + back.map(function (x) { return EagleCount.unitWords(x.code) + ' ' + x.to; }).join(', ') + ')'); }
  catch (e) { notes.push('Eagles to Date not put back: ' + e.message); }
  if (Records.columns().indexOf('_eagle_no') >= 0) { try { Records.update(rec.recordId, { _eagle_no: '' }); } catch (e) { /* best effort */ } }
  var discarded = 0, sent = 0;
  (t.outboxIds || []).forEach(function (id) {
    try { outboxFinish_(id, function () { return { 'Status': Outbox.STATUS.DISCARDED, 'Done': new Date(), 'Done by': by }; }); discarded++; }
    catch (e) { sent++; }
  });
  if (discarded) notes.push(discarded + ' draft' + (discarded > 1 ? 's' : '') + ' discarded');
  if (sent) notes.push(sent + ' email' + (sent > 1 ? 's were' : ' was') + ' already sent or handled: check the Outbox');
  addRecordNote_(rec.recordId, Intake.shortDate(new Date()) + ' [' + by + '] Eagle earned undone' + (notes.length ? ': ' + notes.join('; ') : '') + '.');
  return { message: String(rec.fields.scout_name || '') + ' is back at EBoR Booked.' + (notes.length ? ' ' + notes.join('; ') + '.' : '') +
    ' Files already saved in the folder stay there.' };
}
