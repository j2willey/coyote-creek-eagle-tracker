/**
 * Activity feed + committee digest (adapter; logic in lib/digest.js).
 *
 *  Activity tab    one row per Life to Eagle Log line (the same events as each
 *                  Scout's log), written by addRecordNote_ and typed notes.
 *  Digest Log tab  one row per scheduled digest slot: sent, no changes, or the
 *                  error. "No email for 3 days" + rows saying "no changes" =
 *                  working; no rows = the trigger isn't running.
 *
 * Schedule: Settings → digestHours ("6 PM", "6 AM, 6 PM", blank = off).
 * Recipients: Settings → digestTo, else committeeGroupEmail. Test mode applies.
 * digestHourly (installed by Admin → Install sheet triggers) checks every hour,
 * so changing digestHours takes effect without reinstalling anything.
 */
var ACTIVITY_TAB = 'Activity';
var DIGEST_LOG_TAB = 'Digest Log';
var DIGEST_PROP_SINCE = 'DIGEST_LAST_UNTIL';   // ms: end of the window the last digest covered
var DIGEST_PROP_SLOT = 'DIGEST_LAST_SLOT';     // 'yyyy-MM-dd HH' of the last slot handled
var DIGEST_PROP_BAD = 'DIGEST_BAD_SETTING_DAY'; // day a bad digestHours was last logged

/** Never throws: a failure here must not stop the note itself. */
function recordActivity_(rec, line, by) {
  try {
    if (!rec || Digest.isNoise(line)) return;
    Tabs.append(ACTIVITY_TAB, {
      'When': new Date(), 'Scout': rec.fields.scout_name || '', 'Unit': rec.fields.unit || '',
      'Record ID': rec.recordId, 'Entry': String(line || ''), 'By': by || ''
    });
  } catch (e) { console.warn('Activity not recorded (run Setup / repair tabs?): ' + e); }
}

function digestTz_() { return Session.getScriptTimeZone() || 'America/Los_Angeles'; }

function digestFmt_(d) { return Utilities.formatDate(d, digestTz_(), 'EEE M/d h:mm a'); }

/** Hourly trigger. */
function digestHourly() {
  try { runDigest_({ scheduled: true }); }
  catch (e) { console.error('digestHourly: ' + (e && e.stack || e)); }
  try { outboxSendDue_(); } catch (e) { console.error('outboxSendDue_: ' + (e && e.stack || e)); }   // Outbox → Send later
  try { runReminders_(); } catch (e) { console.error('runReminders_: ' + (e && e.stack || e)); }    // EBoR reminder (4.3.c)
  try { runNudges_(); } catch (e) { console.error('runNudges_: ' + (e && e.stack || e)); }          // 4.1.h, 6.2.b, 6.2.c
  try { runCouncilApps_(); } catch (e) { console.error('runCouncilApps_: ' + (e && e.stack || e)); }  // Formsite → Scout folder
  try { healthCheck_(); } catch (e) { console.error('healthCheck_: ' + (e && e.stack || e)); }      // 6.9.e
}

/**
 * opts.scheduled: only if a slot is due (trigger). Otherwise send now (menu).
 * Returns { status, detail }.
 */
function runDigest_(opts) {
  var s = getSettings_();
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var sched = Digest.parseHours(s.digestHours);
  var slot = '';
  if (opts.scheduled) {
    if (sched.error) {
      // Log a bad setting once a day, not every hour.
      var dayKey = Utilities.formatDate(now, digestTz_(), 'yyyy-MM-dd');
      if (props.getProperty(DIGEST_PROP_BAD) !== dayKey) {
        logDigest_(now, '', '', 0, '', 'ERROR: ' + sched.error);
        props.setProperty(DIGEST_PROP_BAD, dayKey);
      }
      return { status: 'error', detail: sched.error };
    }
    slot = Digest.dueSlot({ date: Utilities.formatDate(now, digestTz_(), 'yyyy-MM-dd'),
      hour: Number(Utilities.formatDate(now, digestTz_(), 'H')) }, sched.hours, props.getProperty(DIGEST_PROP_SLOT) || '');
    if (!slot) return { status: 'not due' };
  }

  var sinceMs = Number(props.getProperty(DIGEST_PROP_SINCE)) || (now.getTime() - 24 * 3600 * 1000);
  var since = new Date(sinceMs);
  var to = Digest.recipients(s);
  var result, count = 0;
  try {
    var events = Digest.select(Tabs.read(ACTIVITY_TAB), sinceMs, now.getTime());
    count = events.length;
    var aw = { groups: [], upcoming: [] };
    try { aw = digestAwaiting_(); } catch (x) { console.warn('digest awaiting: ' + x); }
    if (!count && !aw.groups.length) {
      result = 'no changes, nothing waiting (no email)';
    } else if (!to) {
      throw new Error('no recipients: set Settings → digestTo or committeeGroupEmail');
    } else {
      var shown = {};                                 // Record ID -> 'Theodore Sample ("Teddy")' (Preferred Name)
      try { Records.all(['scout_name', 'preferred_name']).forEach(function (r) { if (String(r.preferred_name || '').trim()) shown[r.recordId] = EagleDone.display(r.scout_name, r.preferred_name); }); }
      catch (x) { console.warn('digest names: ' + x); }
      var m = Digest.build(events, digestFmt_, {
        nameFor: function (id, name) { return shown[id] || name; },
        awaiting: aw.groups, upcoming: aw.upcoming, pageUrl: committeeUrl_(),
        sinceLabel: digestFmt_(since),
        sheetUrl: SpreadsheetApp.getActive().getUrl(),
        scheduleLabel: sched.error ? 'not set correctly' : Digest.scheduleLabel(sched.hours)
      });
      var p = sendMail_({ to: to, subject: m.subject, body: m.body, htmlBody: m.html });
      if (!p.send) throw new Error('mail not sent: ' + p.reason);
      result = 'sent to ' + p.to.join(', ') + (p.intended ? ' (TEST MODE; meant for ' + p.intended.to.join(', ') + ')' : '');
    }
  } catch (e) {
    logDigest_(now, slot || '(sent from menu)', since, count, to, 'ERROR: ' + e.message);
    throw e;                                        // window not advanced: the next run retries
  }
  props.setProperty(DIGEST_PROP_SINCE, String(now.getTime()));
  if (slot) props.setProperty(DIGEST_PROP_SLOT, slot);
  logDigest_(now, slot || '(sent from menu)', since, count, to, result);
  return { status: 'ok', detail: result, count: count };
}

function logDigest_(ranAt, slot, since, count, to, result) {
  try {
    Tabs.append(DIGEST_LOG_TAB, { 'Ran at': ranAt, 'Slot': slot, 'Covers since': since || '', 'Changes': count,
      'To': to, 'Result': result });
  } catch (e) { console.error('Digest Log not written: ' + e); }
}

function digestTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'digestHourly'; });
}

/** For Self-check: schedule, trigger, last run. */
function digestStatus_() {
  var s = getSettings_();
  var sched = Digest.parseHours(s.digestHours);
  var line = 'Digest: ' + (sched.error ? 'SETTING PROBLEM: ' + sched.error : Digest.scheduleLabel(sched.hours)) +
    ' → ' + (Digest.recipients(s) || 'NOBODY (set digestTo or committeeGroupEmail)') +
    '. Hourly trigger: ' + (digestTriggerInstalled_() ? 'installed' : 'NOT installed (Admin → Install sheet triggers)') + '.';
  try {
    var rows = Tabs.read(DIGEST_LOG_TAB);
    var last = rows[rows.length - 1];
    line += last ? ' Last run: ' + digestFmt_(new Date(last['Ran at'])) + ', ' + last['Result'] : ' No runs logged yet.';
  } catch (e) { line += ' No Digest Log tab (Setup / repair tabs).'; }
  return line;
}

function menuSendDigestNow() {
  if (!councilAccountOk_()) return;
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Send the digest now?', 'Covers everything since the last digest. The next scheduled digest then starts from now.',
    ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  try {
    var r = runDigest_({ scheduled: false });
    ui.alert('Digest: ' + r.detail + '\n\nSee the Digest Log tab.');
  } catch (e) { ui.alert('Digest failed: ' + e.message + '\n\nLogged on the Digest Log tab.'); }
}
