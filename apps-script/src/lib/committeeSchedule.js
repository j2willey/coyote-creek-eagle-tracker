/**
 * CommitteeSchedule: pure rules for the committee's schedule page (/committee).
 *
 * The schedule sheet stays the master record (calendar-view-design.md). This
 * module turns its rows into calendar entries, checks a slot a member wants to
 * save, and decides where a new row goes (chronological order).
 *
 * Page input for a slot: { key?, type: 'Intake'|'ESSPPR'|'EBoR', date: 'YYYY-MM-DD',
 *   time: 'HH:MM' (24 h), minutes, location, address, reps: ['JW', ...], reserved?: bool, unit?: 'T945' }
 *
 * Reserved slots + "staffed before bookable" (reserved-slots-design.md, Jim W. 2026-10-28): a slot may be saved
 * with no committee member (a place secured, or the availability pattern to keep), but it is not bookable by
 * Scouts or units until a member is on it. Reserved = held by the committee (often for a unit), Scout assigned later.
 */
var CommitteeSchedule = (function () {
  function B() { return typeof Booking !== 'undefined' ? Booking : require('./booking.js'); }
  function U() { return typeof Units !== 'undefined' ? Units : require('./units.js'); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Types a member can create from the page (Blocked comes later). */
  var CREATE_TYPES = ['Intake', 'ESSPPR', 'EBoR'];
  var MINUTES_KEY = { Intake: 'intakeMinutes', ESSPPR: 'reviewMinutes', EBoR: 'eborMinutes' };

  /**
   * Create-and-book (committee puts a Scout straight into a slot): which Scouts each type offers.
   * Pre-Review Call / Proposal Review: every Scout whose Proposal is not approved yet.
   * EBoR: application verified and the board not held yet (Jim W., 2026-10-20).
   */
  var PRE_APPROVAL = ['proposal_received', 'proposal_incomplete', 'intake_to_book', 'intake_booked', 'intake_revisions',
    'review_to_book', 'review_booked', 'proposal_revisions'];
  var SCOUT_SECTIONS = { Intake: PRE_APPROVAL, ESSPPR: PRE_APPROVAL, EBoR: ['app_verified', 'ebor_booked', 'ebor_paused'] };
  // Booking from these stages moves the row to the type's "Booked" section; other stages stay where they are.
  var MOVE_FROM = {
    Intake: ['proposal_received', 'proposal_incomplete', 'intake_to_book'],
    ESSPPR: ['intake_booked', 'intake_revisions', 'review_to_book'],
    EBoR: ['app_verified', 'ebor_paused']
  };

  /** Section to move a record to when the committee books it into `type`, or null. */
  function moveOnBook(section, type) {
    var r = B().rules(type);
    return r && r.movesTo && (MOVE_FROM[type] || []).indexOf(section) >= 0 ? r.movesTo : null;
  }

  /**
   * records: [{recordId, scout_name, unit, section}]. labelFn(sectionKey) -> stage name.
   * bookingFn(recordId, type) -> text of the Scout's current booking of that type ('' if none).
   * -> { Intake: [{recordId, name, unit, stage, booked}], ESSPPR: [...], EBoR: [...] }
   *    Scouts at the stage that books the type first, then by name.
   */
  function scoutChoices(records, labelFn, bookingFn) {
    var out = {};
    CREATE_TYPES.forEach(function (type) {
      var list = (records || []).filter(function (r) { return SCOUT_SECTIONS[type].indexOf(r.section) >= 0 && str(r.scout_name); })
        .map(function (r) {
          return { recordId: r.recordId, name: str(r.scout_name), unit: str(r.unit), stage: labelFn ? labelFn(r.section) : r.section,
            booked: bookingFn ? str(bookingFn(r.recordId, type)) : '', first: B().bookableType(r.section) === type ? 0 : 1 };
        });
      list.sort(function (a, b) { return a.first - b.first || a.name.localeCompare(b.name); });
      out[type] = list.map(function (x) { delete x.first; return x; });
    });
    return out;
  }

  /** committee: [{name, initials, email}] -> the member with this email, or null. */
  function memberFor(committee, email) {
    var e = str(email).toLowerCase();
    if (!e) return null;
    return (committee || []).filter(function (c) { return str(c.email).toLowerCase() === e; })[0] || null;
  }

  /** "19:00" / "7:00 PM" -> "7:00 PM" ('' if unreadable). */
  function timeText(t) {
    var p = B().parseTime(t);
    if (!p) return '';
    var h = p.h % 12 === 0 ? 12 : p.h % 12;
    return h + ':' + pad2(p.m) + ' ' + (p.h < 12 ? 'AM' : 'PM');
  }

  /** "7:00 PM" -> "19:00" for <input type=time>. */
  function time24(t) {
    var p = B().parseTime(t);
    return p ? pad2(p.h) + ':' + pad2(p.m) : '';
  }

  var BLOCK = 'CCAC';                     // Booking.BLOCKING: "Blocked" rows (meetings, holidays); written as "Blocked"
  var FORM_TYPES = CREATE_TYPES.concat([BLOCK]);

  /** Type list + defaults for the page's form (bookable types, then Blocked). */
  function typeDefaults(settings) {
    var s = settings || {};
    var fallback = { Intake: 20, ESSPPR: 60, EBoR: 90 };
    return CREATE_TYPES.map(function (code) {
      var r = B().rules(code);
      return {
        code: code, label: B().label(code), virtual: !!r.virtual, canBeOnline: !r.virtual, block: false, shadow: B().isShadowType(code, s),
        minutes: Number(s[MINUTES_KEY[code]]) || fallback[code],
        leadHours: Number(s[r.lead]) || 0,                 // Settings lead time (a session's own Lead (h) replaces it)
        location: r.virtual ? '' : str(s.defaultLocation),
        address: r.virtual ? '' : str(s.defaultAddress)
      };
    }).concat([{ code: BLOCK, label: B().label(BLOCK), virtual: false, block: true, minutes: 120, location: '', address: '' }]);
  }

  function defaultStart(settings) { return time24((settings && settings.defaultStartTime) || '7:00 PM') || '19:00'; }

  /** Length of an existing row in minutes (blank cell -> the type's default). */
  function minutesFor(row, code, settings) {
    var n = Number(row.duration_min);
    if (n > 0) return n;
    if (code === BLOCK) return 120;
    var d = typeDefaults(settings).filter(function (t) { return t.code === code; })[0];
    return d ? d.minutes : 20;
  }

  /** Midnight of a date cell (Date, "2026-10-28", "10/28/2026"), or NaN. */
  function dayOf(dateCell) { return B().slotStart(dateCell, '12:00 AM'); }

  /**
   * When a row takes place: { start, end, allDay } or null. A Blocked row without a time is the whole day.
   */
  function windowOf(row, settings) {
    var code = B().typeCode(row.slot_type);
    var start = B().slotStart(row.date, row.time);
    if (!isNaN(start)) return { start: start, end: start + minutesFor(row, code, settings) * 60000, allDay: false };
    if (code === BLOCK && !str(row.time)) {
      var d = dayOf(row.date);
      if (!isNaN(d)) return { start: d, end: nextDay(d), allDay: true };
    }
    return null;
  }

  function nextDay(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }

  /**
   * Schedule rows -> calendar entries for the page.
   * -> [{ key, type, label, start, end, allDay, booked, scoutName, unit, reps:[...], location, address, minutes,
   *       reserved, unstaffed, editable }]   (unit: the Scout's when booked, the reserved-for unit when reserved)
   * Rows without a readable date (or time, except whole-day Blocked) are skipped.
   */
  function entries(rows, settings) {
    var out = [];
    (rows || []).forEach(function (r) {
      var key = str(r._key);
      var code = B().typeCode(r.slot_type);
      if (!key) return;
      var w = windowOf(r, settings);
      if (!w) return;
      var booked = !!(str(r.record_id) || str(r.scout_name));
      var reserved = !booked && CREATE_TYPES.indexOf(code) >= 0 && B().isReserved(r);
      out.push({
        key: key, type: code || 'Other', label: code ? B().label(code) : (str(r.slot_type) || 'Other'),
        start: w.start, end: w.end, allDay: w.allDay, minutes: w.allDay ? 0 : Math.round((w.end - w.start) / 60000),
        booked: booked, shadow: booked && B().isShadow(r.event_id), scoutName: str(r.scout_name), unit: str(r.unit),
        reps: B().splitWho(r.reps), location: str(r.location), address: str(r.address),
        reserved: reserved, unstaffed: CREATE_TYPES.indexOf(code) >= 0 && !B().isStaffed(r), leadHours: B().leadOf(r),
        editable: FORM_TYPES.indexOf(code) >= 0
      });
    });
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  /** "2026-10-28" + "19:00" -> ms (local time), or NaN. */
  function startOf(date, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(date));
    var t = B().parseTime(time);
    if (!m || !t) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], t.h, t.m).getTime();
  }

  function shortWhen(ms, allDay) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + (allDay ? '' : ' ' + timeText(pad2(d.getHours()) + ':' + pad2(d.getMinutes())));
  }

  /**
   * Check a slot before saving.
   * input: page slot (see top; Blocked: type 'CCAC', location = description, time '' = whole day).
   * rows: schedule rows. committee: Committee tab. nowMs.
   * -> { errors: [...], warnings: [...], start, minutes, reps, cells } where cells = schedule columns to write.
   * Errors block saving; warnings need "save anyway".
   */
  function check(input, rows, committee, nowMs, settings) {
    var errors = [], warnings = [];
    var x = input || {};
    var code = str(x.type);
    var block = code === BLOCK;
    if (FORM_TYPES.indexOf(code) < 0) errors.push('Pick a session type.');
    var allDay = block && !str(x.time);
    var start = allDay ? startOf(x.date, '00:00') : startOf(x.date, x.time);
    if (isNaN(start)) errors.push(block ? 'Pick a date.' : 'Pick a date and a start time.');
    else if ((allDay ? nextDay(start) : start) <= nowMs) errors.push('That time is in the past.');
    var minutes = allDay ? 0 : Math.round(Number(x.minutes));
    if (!allDay && !(minutes >= 5 && minutes <= 720)) errors.push('Length must be between 5 and 720 minutes.');
    var reps = (x.reps || []).map(str).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var reserved = !block && !!x.reserved;
    var unit = reserved ? str(x.unit) : '';
    if (!reps.length && !block) {
      if (str(x.recordId)) errors.push('Add a committee member before booking a Scout into this slot.');
      else warnings.push('No committee member on this session. Scouts and units can\'t book it until one signs up, and the digest lists it until then.');
    }
    var unknown = reps.filter(function (t) { return !B().findMember(t, committee); });
    if (unknown.length) errors.push('Not on the Committee tab: ' + unknown.join(', ') + '.');
    var r = CREATE_TYPES.indexOf(code) >= 0 ? B().rules(code) : {};
    var location = r.virtual ? '' : str(x.location);
    var address = r.virtual || block ? '' : str(x.address);
    // Lead (h): this session's own lead time; blank = the type's Settings value (Jim W. 2026-10-31).
    var leadOwn = null;
    if (!block && x.leadHours !== undefined && x.leadHours !== null && str(x.leadHours) !== '') {
      leadOwn = Number(x.leadHours);
      if (isNaN(leadOwn) || leadOwn < 0 || leadOwn > 720) { errors.push('Lead time must be blank or between 0 and 720 hours.'); leadOwn = null; }
    }
    if (block && !location) errors.push('Enter a description (e.g. "CCAC meeting", "Thanksgiving").');
    else if (!r.virtual && code && !location) errors.push('Enter a location.');

    if (!errors.length) {
      var end = allDay ? nextDay(start) : start + minutes * 60000;
      var mine = str(x.key);
      var openHit = 0;
      (rows || []).forEach(function (row) {
        if (mine && str(row._key) === mine) return;
        var w = windowOf(row, settings);
        if (!w || !(start < w.end && end > w.start)) return;
        var rc = B().typeCode(row.slot_type);
        if (block) {
          if (rc === BLOCK) return;
          if (str(row.record_id) || str(row.scout_name)) warnings.push(str(row.scout_name) + '\'s ' + B().label(rc) + ' is booked at ' + shortWhen(w.start) + '.');
          else if (CREATE_TYPES.indexOf(rc) >= 0) openHit++;
          return;
        }
        if (rc === BLOCK) { warnings.push('Overlaps "' + (str(row.location) || B().label(rc)) + '" (' + shortWhen(w.start, w.allDay) + ').'); return; }
        var theirs = B().splitWho(row.reps).map(function (t) { return t.toLowerCase(); });
        var both = reps.filter(function (t) { return theirs.indexOf(t.toLowerCase()) >= 0; });
        if (both.length) warnings.push(both.join('/') + ' already ' + (both.length > 1 ? 'have' : 'has') + ' a ' +
          (rc ? B().label(rc) : 'slot') + ' at ' + shortWhen(w.start) + '.');
      });
      if (openHit) warnings.push(openHit + ' open session' + (openHit > 1 ? 's overlap' : ' overlaps') + ' this time: Scouts will not be offered ' +
        (openHit > 1 ? 'them' : 'it') + ' while it is blocked.');
      if (str(x.recordId) && unit && str(x.scoutUnit) && U().codes(x.scoutUnit).indexOf(U().code(unit)) < 0) {   // any of the Scout's units
        warnings.push('This slot is reserved for ' + unit + ', but the Scout is in ' + str(x.scoutUnit) + '.');
      }
      var lead = leadOwn !== null ? leadOwn : (Number(settings && settings[r.lead]) || 0);
      if (lead && reps.length && !reserved && !str(x.recordId) && start - nowMs < lead * 3600 * 1000) {
        warnings.push('Scouts can\'t book this online (it is less than ' + lead + ' hours away). A committee member can still put a Scout in it.' +
          (leadOwn === null ? ' To offer it anyway, give this session a shorter lead time.' : ''));
      }
    }

    var d = isNaN(start) ? null : new Date(start);
    var out = {
      errors: errors, warnings: warnings, start: start, minutes: minutes, reps: reps, allDay: allDay, reserved: reserved, unit: unit,
      cells: d ? {
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        time: allDay ? '' : timeText(pad2(d.getHours()) + ':' + pad2(d.getMinutes())),
        reps: reps.join('/'), slot_type: block ? 'Blocked' : code, location: location, address: address,
        duration_min: allDay ? '' : minutes, lead_hours: leadOwn === null ? '' : leadOwn
      } : null
    };
    // Reserved / unit cells only when no Scout is being booked now (booking writes unit and clears Reserved itself).
    if (out.cells && !str(x.recordId)) { out.cells.reserved = reserved ? true : ''; out.cells.unit = unit; }
    return out;
  }

  /** Most new sessions one save may create (several sessions at once, 2026-10-31). */
  var BATCH_MAX = 20;

  /**
   * Several new sessions at once (Jim W., 2026-10-31): same type, length, members, place, reservation and lead time;
   * each its own date + start time. All or nothing: any error blocks the whole save.
   * shared: page slot without date/time (no key: new sessions only; no Scout: nobody is booked from a batch).
   * times: [{date: 'YYYY-MM-DD', time: 'HH:MM'}]. Each time is also checked against the earlier ones in the batch.
   * -> { errors, warnings, items: [{ start, cells }] } sorted by start. A message about only some of the times is
   *    prefixed with them ("10/31 9:00 AM: ..."); one that applies to every time is listed once.
   */
  function checkBatch(shared, times, rows, committee, nowMs, settings) {
    var x = Object.assign({}, shared || {}, { key: '', recordId: '' });
    var list = (times || []).filter(function (t) { return t && (str(t.date) || str(t.time)); });
    if (!list.length) return { errors: ['Add at least one date and start time.'], warnings: [], items: [] };
    if (list.length > BATCH_MAX) return { errors: ['At most ' + BATCH_MAX + ' sessions at a time.'], warnings: [], items: [] };
    if (str(x.type) === BLOCK && list.length > 1) return { errors: ['Blocked times are added one at a time.'], warnings: [], items: [] };
    var extra = [], items = [], seen = {};
    var errs = [], warns = [];   // [{text, when}]
    list.forEach(function (t) {
      var chk = check(Object.assign({}, x, { date: t.date, time: t.time }), (rows || []).concat(extra), committee, nowMs, settings);
      var when = isNaN(chk.start) ? (str(t.date) + ' ' + str(t.time)).trim() : shortWhen(chk.start);
      if (!isNaN(chk.start) && seen[chk.start]) chk.errors.push('This time is listed twice.');
      if (!isNaN(chk.start)) seen[chk.start] = true;
      chk.errors.forEach(function (e) { errs.push({ text: e, when: when }); });
      chk.warnings.forEach(function (w) { warns.push({ text: w, when: when }); });
      if (!chk.errors.length && chk.cells) {
        items.push({ start: chk.start, cells: chk.cells });
        extra.push(Object.assign({ _key: 'NEW_' + items.length }, chk.cells));
      }
    });
    function fold(arr) {
      var order = [], by = {};
      arr.forEach(function (m) { if (!by[m.text]) { by[m.text] = []; order.push(m.text); } if (by[m.text].indexOf(m.when) < 0) by[m.text].push(m.when); });
      return order.map(function (text) { return by[text].length === list.length && list.length > 1 || list.length === 1 ? text : by[text].join(', ') + ': ' + text; });
    }
    items.sort(function (a, b) { return a.start - b.start; });
    return { errors: fold(errs), warnings: fold(warns), items: items };
  }

  /**
   * What needs a committee member's attention on the schedule (digest, Self-check).
   * -> { unstaffed: [...] future sessions within 30 days with no committee member, booked first, then reserved, then open;
   *      reserved: [...] reserved slots with no Scout within 14 days }
   * Items: { key, type, label, start, booked, reserved, scoutName, unit, location }.
   */
  function attention(rows, nowMs, settings) {
    var DAY = 24 * 3600 * 1000;
    var list = entries(rows, settings).filter(function (x) { return CREATE_TYPES.indexOf(x.type) >= 0 && x.start > nowMs; })
      .map(function (x) { return { key: x.key, type: x.type, label: x.label, start: x.start, booked: x.booked, reserved: x.reserved,
        scoutName: x.scoutName, unit: x.unit, location: x.location, unstaffed: x.unstaffed }; });
    var rank = function (x) { return x.booked ? 0 : x.reserved ? 1 : 2; };
    return {
      unstaffed: list.filter(function (x) { return x.unstaffed && x.start < nowMs + 30 * DAY; })
        .sort(function (a, b) { return rank(a) - rank(b) || a.start - b.start; }),
      reserved: list.filter(function (x) { return x.reserved && x.start < nowMs + 14 * DAY; })
    };
  }

  /**
   * Where a slot starting at startMs goes: the sheet row number to insert BEFORE,
   * or 0 = after the last row. rows: schedule rows with _row (sheet order). skipKey: the row being moved.
   */
  function insertBefore(rows, startMs, skipKey) {
    var list = (rows || []).filter(function (r) { return !skipKey || str(r._key) !== skipKey; });
    for (var i = 0; i < list.length; i++) {
      var s = B().slotStart(list[i].date, list[i].time || '12:00 PM');
      if (!isNaN(s) && s > startMs) return list[i]._row;
    }
    return 0;
  }

  /**
   * Moving a BOOKED session (Jim W., 2026-10-29: change date, time or place on the committee page or by drag and drop,
   * instead of cancel + rebook = two emails). row: the booked schedule row now; input: the form ({type, date, time,
   * location, ...}); newStart: the form's start (ms). -> {errors, warnings} on top of check().
   */
  function checkMove(row, input, newStart, nowMs, settings) {
    var errors = [], warnings = [];
    var code = B().typeCode(row.slot_type);
    if (str(input.type) !== code) errors.push('A booked session can\'t change type. Cancel the booking instead.');
    var w = windowOf(row, settings);
    if (w && w.start <= nowMs) errors.push('This session has already started or is in the past.');
    if (!isNaN(newStart) && newStart > nowMs && newStart - nowMs < 24 * 3600 * 1000) {
      warnings.push('The new time is less than 24 hours away: the Scout' + (B().rules(code) && B().rules(code).notifyUnit ? ', family and unit get' : ' and family get') +
        ' very short notice.');
    }
    return { errors: errors, warnings: warnings };
  }

  return {
    CREATE_TYPES: CREATE_TYPES, FORM_TYPES: FORM_TYPES, BLOCK: BLOCK, windowOf: windowOf, SCOUT_SECTIONS: SCOUT_SECTIONS, moveOnBook: moveOnBook, scoutChoices: scoutChoices, memberFor: memberFor, timeText: timeText, time24: time24,
    typeDefaults: typeDefaults, defaultStart: defaultStart, minutesFor: minutesFor,
    entries: entries, startOf: startOf, check: check, checkBatch: checkBatch, BATCH_MAX: BATCH_MAX, checkMove: checkMove, insertBefore: insertBefore, attention: attention
  };
})();

if (typeof module !== 'undefined') module.exports = CommitteeSchedule;
