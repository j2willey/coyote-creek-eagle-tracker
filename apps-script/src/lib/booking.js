/**
 * Booking (M5): pure rules for Review Slots on the schedule sheet.
 *
 * Schedule rows (machine names, tools/fakeSchedule.js): date, time,
 * scout_name, unit, reps, board_members, slot_type, location, duration_min,
 * record_id, event_id, reserved, _key. Open slot = empty scout_name and record_id, staffed, not reserved.
 * Element 3: a Scout books only the session type their stage allows;
 * only committee members create slots.
 */
var Booking = (function () {
  /**
   * Slot Type codes in the schedule sheet (Jim W., 2026-10-12) -> what Scouts see.
   * Older long names are accepted as aliases.
   */
  var TYPES = {
    Intake: { label: 'Pre-Review Call', aliases: ['pre-review call', 'pre-review', 'prescreen'] },
    ESSPPR: { label: 'Proposal Review', aliases: ['proposal review'] },
    EBoR: { label: 'Eagle Board of Review', aliases: ['ebor', 'eagle board of review'] },
    // Follow-Up / Consult (Jim W., 2026-11-11): a meeting a member and a Scout agreed on outside the normal steps.
    // Made by the committee only, always for a Scout, never offered online. 'follow-up review' is the old label.
    Followup: { label: 'Follow-Up / Consult', aliases: ['follow-up', 'follow up', 'followup', 'consult', 'follow-up / consult', 'follow-up/consult', 'follow-up review'] },
    CCAC: { label: 'Blocked', aliases: ['blocked', 'committee meeting'] }   // blocks overlapping slots (meetings, holidays); no time = whole day
  };
  var PRE_REVIEW = 'Intake';
  var PROPOSAL_REVIEW = 'ESSPPR';
  var BLOCKING = 'CCAC';
  // Section (position = status) -> the slot type a Scout there may book.
  var EBOR = 'EBoR';
  var FOLLOWUP = 'Followup';
  var BOOKABLE_BY_SECTION = { intake_to_book: PRE_REVIEW, review_to_book: PROPOSAL_REVIEW, app_verified: EBOR };
  var BOOKABLE_SECTIONS = Object.keys(BOOKABLE_BY_SECTION);

  /**
   * How each bookable type behaves (element 3 + 5):
   *  virtual   Meet link (Pre-Review) vs in person with location (Proposal Review)
   *  showWho   Scout sees the members' names? (Proposal Review panel stays unnamed)
   *  adult     Scout must confirm a parent / adult 21+ will be present
   *  movesTo   section the row moves to when booked; cancelBackTo on cancel
   *  lead / dateCol / whoCol: Settings keys
   */
  var RULES = {
    Intake: { virtual: true, showWho: true, adult: true, movesTo: 'intake_booked', cancelBackTo: 'intake_to_book',
      lead: 'bookingLeadHours', dateCol: 'preReviewDateColumn', whoCol: 'preReviewWhoColumn' },
    ESSPPR: { virtual: false, showWho: false, adult: true, movesTo: 'review_booked', cancelBackTo: 'review_to_book',
      lead: 'reviewLeadHours', dateCol: 'proposalReviewDateColumn', whoCol: 'proposalReviewWhoColumn' },
    EBoR: { virtual: false, showWho: false, adult: false, movesTo: 'ebor_booked', cancelBackTo: 'app_verified',
      lead: 'eborLeadHours', dateCol: 'eborDateColumn', whoCol: 'eborWhoColumn', notifyUnit: true, boardOnInvite: true }
  };
  // Follow-Up / Consult: committee-made only (never in BOOKABLE: no open times, no online booking, no please-book).
  // It books a Scout at once, moves no tracking row and fills no tracking Date/Who column (no dateCol/whoCol/movesTo).
  // multiple: a Scout may have several. Online (Meet) by default on the committee page; in person when a place is given.
  RULES.Followup = { virtual: false, showWho: true, adult: true, committeeOnly: true, multiple: true };
  function rules(code) { return RULES[code] || null; }
  var BOOKABLE = [PRE_REVIEW, PROPOSAL_REVIEW, EBOR];
  // Every type that can be booked to a Scout (invites, moves, cancels, the Scout's and unit's pages): the types Scouts
  // book plus the committee-made one.
  var BOOKED_TYPES = BOOKABLE.concat([FOLLOWUP]);
  function isCommitteeOnly(code) { return !!(RULES[code] && RULES[code].committeeOnly); }

  /**
   * Did a booked slot move? row: schedule row now; ev: {startMs, location}
   * from the calendar event. -> {timeChanged, placeChanged}
   */
  function slotChanges(row, ev, code) {
    var start = slotStart(row.date, row.time);
    var virt = isVirtual(code, row);
    var placeNow = virt ? '' : place({ location: row.location, address: row.address });
    return {
      timeChanged: !isNaN(start) && ev && ev.startMs !== start,
      placeChanged: !virt && ev && str(ev.location) !== placeNow,
      start: start, place: placeNow
    };
  }

  function str(v) { return v == null ? '' : String(v).trim(); }

  /**
   * What a move changed, in words (Jim W., 2026-10-29: "the location was updated, not the date").
   * oldStart/newStart: ms (NaN = unknown); placeChanged: bool. Day and time of day in the script's time zone.
   * -> {text: 'new place' | 'new date' | 'new time' | 'new date and time' | 'new date, time and place' ...,
   *     subject: 'moved' | 'place changed' | 'moved, place changed', timeChanged}
   */
  function changeWords(oldStart, newStart, placeChanged) {
    var timeChanged = !isNaN(oldStart) && !isNaN(newStart) && oldStart !== newStart;
    var parts = [];
    if (timeChanged) {
      var a = new Date(oldStart), b = new Date(newStart);
      var sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      var sameClock = a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
      if (!sameDay) parts.push('date');
      if (!sameClock) parts.push('time');
    }
    if (placeChanged) parts.push('place');
    var text = !parts.length ? 'new date, time or place'
      : 'new ' + (parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);
    var subject = timeChanged && placeChanged ? 'moved, place changed' : placeChanged ? 'place changed' : 'moved';
    return { text: text, subject: subject, timeChanged: timeChanged };
  }

  /** Slot Type cell -> code ('Intake', ...) or '' if unknown. */
  function typeCode(cell) {
    var c = str(cell).toLowerCase();
    if (!c) return '';
    for (var k in TYPES) {
      if (k.toLowerCase() === c || TYPES[k].aliases.indexOf(c) >= 0) return k;
    }
    return '';
  }

  function label(code) { return TYPES[code] ? TYPES[code].label : code; }

  /** Multivalued Who / Reps / Board Members cell: "JW/AB, CD" -> ['JW', 'AB', 'CD']. */
  function splitWho(cell) {
    return str(cell).split(/\s*[,\/;\n]\s*/).map(str).filter(Boolean);
  }

  var B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Stable slot key SL_yymmdd_XXX from the date the slot was FIRST keyed.
   * It never changes, even if the slot later moves to another day.
   */
  function makeSlotKey(dateMs, existing, randomFn) {
    var d = new Date(dateMs);
    var rnd = randomFn || Math.random;
    var stamp = pad2(d.getFullYear() % 100) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var taken = {};
    (existing || []).forEach(function (k) { taken[str(k)] = true; });
    for (var t = 0; t < 200; t++) {
      var k = 'SL_' + stamp + '_';
      for (var i = 0; i < 3; i++) k += B32.charAt(Math.floor(rnd() * B32.length));
      if (!taken[k]) return k;
    }
    throw new Error('Could not generate a unique slot key');
  }

  /** Rows a committee member added without a key (have a date). -> [{index, key}] */
  function missingKeys(rows, randomFn) {
    var used = (rows || []).map(function (r) { return str(r._key); }).filter(Boolean);
    var out = [];
    (rows || []).forEach(function (r, i) {
      if (str(r._key)) return;
      var start = slotStart(r.date, r.time || '12:00 PM');
      if (isNaN(start)) return;
      var k = makeSlotKey(start, used, randomFn);
      used.push(k);
      out.push({ index: i, key: k });
    });
    return out;
  }

  /** "7:00 PM", "7 pm", "19:30" -> {h, m} or null. */
  function parseTime(t) {
    if (t instanceof Date) return { h: t.getHours(), m: t.getMinutes() };
    var m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(str(t));
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h: h, m: min };
  }

  /** Date cell (Date or "2026-10-14" / "10/14/2026") + time cell -> ms, or NaN. */
  function slotStart(dateCell, timeCell) {
    var d;
    if (dateCell instanceof Date) d = new Date(dateCell.getFullYear(), dateCell.getMonth(), dateCell.getDate());
    else {
      var s = str(dateCell), m;
      if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) d = new Date(+m[3], +m[1] - 1, +m[2]);
      else return NaN;
    }
    var t = parseTime(timeCell);
    if (!t) return NaN;
    d.setHours(t.h, t.m, 0, 0);
    return d.getTime();
  }

  function isType(row, code) { return typeCode(row.slot_type) === code; }

  /** Committee members on a slot (initials or names) from the Council/District Rep(s) cell. */
  function who(row) { return splitWho(row.reps); }

  function minutesOf(row, code) { return Number(row.duration_min) || (code === BLOCKING ? 120 : 20); }

  /** CCAC meeting windows [start, end) that block other slots. */
  function blocked(rows) {
    return (rows || []).filter(function (r) { return isType(r, BLOCKING); }).map(function (r) {
      var s = slotStart(r.date, r.time);
      if (isNaN(s) && !str(r.time)) {                    // no time = the whole day
        var d = slotStart(r.date, '12:00 AM');
        if (isNaN(d)) return [NaN, NaN];
        var x = new Date(d);
        return [d, new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1).getTime()];
      }
      return [s, s + minutesOf(r, BLOCKING) * 60000];
    }).filter(function (w) { return !isNaN(w[0]); });
  }

  /**
   * Reserved slot (reserved-slots-design.md, Jim W. 2026-10-28): the committee holds the time (often for a unit,
   * Schedule "Reserved" column) and assigns a Scout later. Never offered to Scouts or units.
   */
  function isReserved(row) {
    var v = row ? row.reserved : '';
    return v === true || /^(true|yes|y|x|reserved)$/i.test(str(v));
  }

  /** Staffed = at least one committee member in the Council/District Rep(s) cell. Unstaffed slots are not bookable. */
  function isStaffed(row) { return splitWho(row && row.reps).length > 0; }

  /**
   * Lead time of one session (schedule column "Lead (h)", Jim W. 2026-10-31): hours before the start that Scouts stop
   * being offered it. Blank = the type's Settings value. -> number of hours, or null when blank / not a number.
   */
  function leadOf(row) {
    var v = row ? row.lead_hours : '';
    if (v === '' || v == null || str(v) === '') return null;
    var n = Number(v);
    return isNaN(n) || n < 0 ? null : n;
  }

  /**
   * rows: schedule objects (with _key). -> open future slots of `type`, soonest first.
   * Open = no Scout, staffed, not reserved. opts.committee: a committee member is booking (reserved slots count too,
   * no lead time). opts.noLead: ignore lead times (committee views). leadHours: the type's Settings lead time; a
   * session's own Lead (h) replaces it.
   */
  function openSlots(rows, type, nowMs, leadHours, opts) {
    if (isCommitteeOnly(type) && !(opts && opts.committee)) return [];     // a Follow-Up / Consult is never offered
    var noLead = !!(opts && (opts.committee || opts.noLead));
    var windows = blocked(rows);
    var committee = !!(opts && opts.committee);
    return (rows || []).filter(function (r) {
      return str(r._key) && isType(r, type) && !str(r.scout_name) && !str(r.record_id) && isStaffed(r) && (committee || !isReserved(r));
    }).map(function (r) {
      var own = leadOf(r);
      return { key: str(r._key), start: slotStart(r.date, r.time), who: who(r),
        location: str(r.location), address: str(r.address), minutes: minutesOf(r, type),
        lead: noLead ? 0 : (own !== null ? own : (Number(leadHours) || 0)) };
    }).filter(function (s) {
      if (!(s.start >= nowMs + s.lead * 3600 * 1000)) return false;
      var end = s.start + s.minutes * 60000;
      return !windows.some(function (w) { return s.start < w[1] && end > w[0]; });
    }).sort(function (a, b) { return a.start - b.start; });
  }

  /** The record's booking of `type` that hasn't happened yet (latest if several), or null. */
  function currentBooking(rows, recordId, type, nowMs) {
    var mine = (rows || []).filter(function (r) {
      return str(r.record_id) === recordId && isType(r, type);
    }).map(function (r) {
      return { key: str(r._key), start: slotStart(r.date, r.time), who: who(r),
        location: str(r.location), address: str(r.address), eventId: str(r.event_id), minutes: minutesOf(r, type) };
    }).filter(function (b) { return b.start >= nowMs - 3600 * 1000; });   // still upcoming (or just started)
    mine.sort(function (a, b) { return b.start - a.start; });
    return mine[0] || null;
  }

  /** All of the record's upcoming bookings of `type` (a Scout may have several Follow-Ups), soonest first. */
  function upcomingBookings(rows, recordId, type, nowMs) {
    return (rows || []).filter(function (r) {
      return str(r.record_id) === recordId && isType(r, type);
    }).map(function (r) {
      return { key: str(r._key), start: slotStart(r.date, r.time), who: who(r),
        location: str(r.location), address: str(r.address), eventId: str(r.event_id), minutes: minutesOf(r, type) };
    }).filter(function (b) { return b.start >= nowMs - 3600 * 1000; }).sort(function (a, b) { return a.start - b.start; });
  }

  /** The record's booking in the schedule row with this key (any bookable type, past or future): {type, b} or null. */
  function bookingAt(rows, recordId, key) {
    var r = (rows || []).filter(function (x) { return str(x._key) === str(key) && str(x.record_id) === str(recordId); })[0];
    var type = r ? typeCode(r.slot_type) : '';
    if (!r || BOOKED_TYPES.indexOf(type) < 0) return null;
    return { type: type, b: { key: str(r._key), start: slotStart(r.date, r.time), who: who(r), location: str(r.location),
      address: str(r.address), eventId: str(r.event_id), minutes: minutesOf(r, type) } };
  }

  function canCancel(startMs, nowMs, cutoffHours) {
    return startMs - nowMs >= (Number(cutoffHours) || 24) * 3600 * 1000;
  }

  function bookableType(sectionKey) { return BOOKABLE_BY_SECTION[sectionKey] || null; }

  /**
   * Settings → onlineBooking: which bookable types Scouts book online (phased
   * rollout; the rest are scheduled the old way). "Pre-Review Call",
   * "Pre-Review Call, Proposal Review", "all", blank/"none" = none.
   * -> { codes: [...] } or { codes: [], error }
   */
  function parseOnline(value) {
    var s = str(value);
    if (!s || /^(none|off|no)$/i.test(s)) return { codes: [] };
    if (/^all$/i.test(s)) return { codes: BOOKABLE.slice() };
    var codes = [], bad = [];
    s.split(/\s*[,;\n]\s*/).filter(Boolean).forEach(function (t) {
      var c = typeCode(t);
      if (c && BOOKABLE.indexOf(c) >= 0) { if (codes.indexOf(c) < 0) codes.push(c); }
      else bad.push(t);
    });
    return bad.length ? { codes: codes, error: 'onlineBooking: unknown "' + bad.join('", "') + '" (use Pre-Review Call, Proposal Review, EBoR)' }
                      : { codes: codes };
  }

  /**
   * Shadow bookings (phased rollout, Jim W. 2026-10-22): a type not booked online yet is still scheduled on the
   * old system; a member mirrors the booking here so the switch-over is painless. Recorded only: no Calendar
   * invite, no emails, no unit notice. The schedule row's Calendar Event ID cell says "shadow".
   */
  var SHADOW = 'shadow';
  function isShadowType(code, settings) { return BOOKABLE.indexOf(code) >= 0 && parseOnline(settings && settings.onlineBooking).codes.indexOf(code) < 0; }
  function isShadow(eventId) { return str(eventId).toLowerCase() === SHADOW; }

  /** The type a Scout in this section books ONLINE now, or null (not bookable, or scheduled by the committee). */
  function onlineType(sectionKey, settings) {
    var t = bookableType(sectionKey);
    return t && parseOnline(settings && settings.onlineBooking).codes.indexOf(t) >= 0 ? t : null;
  }

  /** Bookable at this stage but not online yet: the committee schedules it (old schedule sheet). */
  function committeeType(sectionKey, settings) {
    var t = bookableType(sectionKey);
    return t && !onlineType(sectionKey, settings) ? t : null;
  }

  /**
   * A committee member typed a Scout's name into a schedule slot: which record is it?
   * records: [{recordId, scout_name, unit}]. typedUnit optional (narrows same-name Scouts). codeFn: unit normalizer.
   * -> { recordId } or { error } (shown as a note on the cell).
   */
  function matchScout(records, typedName, typedUnit, codeFn) {
    var norm = function (v) { return str(v).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
    var n = norm(typedName);
    if (!n) return { error: 'No name' };
    // Preferred Name (2026-11-04): "Teddy" or "Teddy Sample" finds Theodore Sample. A one-word preferred name gets the
    // record's last name. Every entry of the ";"-list counts.
    var namesOf = function (r) {
      var last = norm(r.scout_name).split(' ').slice(-1)[0] || '';
      return [norm(r.scout_name)].concat(str(r.preferred_name).split(';').map(norm).filter(Boolean)
        .map(function (p) { return p.indexOf(' ') < 0 && last ? p + ' ' + last : p; }));
    };
    var hits = (records || []).filter(function (r) { return namesOf(r).indexOf(n) >= 0; });
    if (!hits.length) {
      // Short forms: every typed word starts a later word of the name, in order ("Margaret Holloway", "Margaret Ann H").
      var typed = n.split(' ');
      hits = (records || []).filter(function (r) {
        return namesOf(r).some(function (full) {
          var words = full.split(' '), j = 0;
          for (var i = 0; i < typed.length; i++) {
            while (j < words.length && words[j].indexOf(typed[i]) !== 0) j++;
            if (j >= words.length) return false;
            j++;
          }
          return words[0] === typed[0];                           // first name must match in full
        });
      });
    }
    if (!hits.length) return { error: 'No Scout named "' + str(typedName) + '" on the tracking tab (check the spelling).' };
    var u = str(typedUnit);
    if (u && codeFn) {
      // The Unit cell may list several units ("C967 T911"): any one matching is enough.
      var codes = function (v) { return [codeFn(v)].concat(String(v || '').split(/[\s,;\/&+]+/).map(codeFn)).filter(Boolean); };
      var parts = codes(u);
      var byUnit = hits.filter(function (r) {
        var rc = codes(r.unit);
        return rc.some(function (c) { return parts.indexOf(c) >= 0; });
      });
      if (!byUnit.length) return { error: '"' + str(typedName) + '" is on the tracking tab, but not in unit ' + u + '.' };
      hits = byUnit;
    }
    if (hits.length > 1) return { error: hits.length + ' Scouts are named "' + str(typedName) + '": type the unit in the Unit column too.' };
    return { recordId: hits[0].recordId };
  }

  function committeeStatus(code) { return label(code) + ': the committee will contact you to schedule it'; }

  function norm(s) { return str(s).toLowerCase().replace(/\s+/g, ' '); }

  /** committee: [{name, initials, email}]. Token = initials (preferred) or full name. -> member or null. */
  function findMember(token, committee) {
    var t = norm(token);
    if (!t) return null;
    return (committee || []).filter(function (c) { return norm(c.initials) === t; })[0] ||
           (committee || []).filter(function (c) { return norm(c.name) === t; })[0] || null;
  }

  /** Who tokens -> {emails, names (full names for Scouts), unknown (tokens not on the Committee tab)}. */
  function resolveWho(tokens, committee) {
    var out = { emails: [], names: [], unknown: [] };
    (tokens || []).forEach(function (t) {
      var m = findMember(t, committee);
      if (!m) { out.unknown.push(t); out.names.push(t); return; }
      out.names.push(str(m.name) || t);
      if (str(m.email)) out.emails.push(str(m.email).toLowerCase());
    });
    return out;
  }

  var ADULT = 'Youth protection: a parent/guardian or another adult 21 or older must be with the Scout for the whole call.';
  var ADULT_IN_PERSON = 'Youth protection: a parent/guardian or another adult 21 or older must come with the Scout to the review.';
  var FOLLOWUP_ADULT = 'Youth protection: a parent/guardian or another adult 21 or older must be with the Scout for the whole meeting.';

  /** "East Valley YMCA, 123 Fake St" (address left out when blank or a placeholder). */
  /**
   * Online session? Pre-Review Calls always; any other type when its place is "Online …" (Jim W., 2026-10-26: an
   * In-Person Review or EBoR held online as an exception, e.g. a Scout who lives too far). Online = Google Meet link.
   */
  var ONLINE_PLACE = 'Online (Google Meet)';
  function isOnlinePlace(location) { return /^\s*online\b/i.test(str(location)); }
  function isVirtual(code, slotOrRow) {
    var r = rules(code) || {};
    return !!r.virtual || isOnlinePlace(slotOrRow && slotOrRow.location);
  }

  function place(slot) {
    var a = str(slot.address);
    return [str(slot.location), a].filter(Boolean).join(', ');
  }

  /** Invite text for any bookable type. member: names (Pre-Review only); slot for the place. */
  function inviteText(code, scoutName, unit, member, whenText, slot) {
    if (code === EBOR) {
      return {
        summary: label(code) + ': ' + scoutName + ' (' + unit + ')',
        description: 'Eagle Board of Review with the Coyote Creek District Advancement Committee.\n' +
          'When: ' + whenText + '\nWhere: ' + (isOnlinePlace(slot && slot.location) ? 'online: join with the Google Meet link in this invitation' : place(slot)) + '\n\n' +
          'Scout: wear your Field uniform and bring your Scout handbook and a copy of your Eagle application. ' +
          'Arrive 10 minutes early.\n' +
          'Unit: your Unit Board Members are added to this invitation when your unit enters them.\n\n' +
          'Questions or a change of date? Email the committee.'
      };
    }
    if (code === PROPOSAL_REVIEW) {
      return {
        summary: label(code) + ': ' + scoutName + ' (' + unit + ')',
        description: 'Eagle Project Proposal Review with the Coyote Creek District Advancement Committee.\n' +
          'When: ' + whenText + '\nWhere: ' + (isOnlinePlace(slot && slot.location) ? 'online: join with the Google Meet link in this invitation' : place(slot)) + '\n\n' +
          'Come ready to present your project (about 10 minutes), then answer the reviewers\' questions. ' +
          'Have your signed Proposal at hand (printed or on a device) and wear your Field uniform.\n' +
          (isOnlinePlace(slot && slot.location) ? ADULT : ADULT_IN_PERSON) + '\n\n' +
          'Need to change it? Use your Eagle Project page, or email the committee if it is less than 24 hours away.'
      };
    }
    if (code === FOLLOWUP) {
      var online = isOnlinePlace(slot && slot.location);
      return {
        summary: label(code) + ': ' + scoutName + ' (' + unit + ')',
        description: 'Follow-up / consult with the Coyote Creek District Advancement Committee.\n' +
          (member ? 'Committee member: ' + member + '\n' : '') + 'When: ' + whenText + '\n' +
          'Where: ' + (online ? 'online: join with the Google Meet link in this invitation' : place(slot)) + '\n\n' +
          FOLLOWUP_ADULT + '\n\nNeed to change it? Email the committee.'
      };
    }
    return eventText(label(code), scoutName, unit, member, whenText);
  }

  /** emails on the invite now vs who should be there -> emails to add. */
  function missingGuests(intended, current) {
    var have = {};
    (current || []).forEach(function (e) { have[str(e).toLowerCase()] = true; });
    var out = [];
    (intended || []).forEach(function (e) {
      var k = str(e).toLowerCase();
      if (k && !have[k] && out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /**
   * Keep a booked slot's invite in step with its sheet row, both ways.
   * intended: who should be invited now. current: emails on the invite.
   * committeeEmails: every Committee tab email. A committee member on the invite who is
   * no longer intended (initials removed from the slot) is removed; nobody else is ever removed.
   * -> { add: [...], remove: [...] }
   */
  function guestChanges(intended, current, committeeEmails) {
    var low = function (e) { return str(e).toLowerCase(); };
    var want = (intended || []).map(low).filter(Boolean);
    var members = (committeeEmails || []).map(low).filter(Boolean);
    var have = (current || []).map(low).filter(Boolean);
    return {
      add: missingGuests(want, have),
      remove: have.filter(function (e, i, a) { return a.indexOf(e) === i && members.indexOf(e) >= 0 && want.indexOf(e) < 0; })
    };
  }

  function eventText(type, scoutName, unit, member, whenText) {
    return {
      summary: type + ': ' + scoutName + ' (' + unit + ')',
      description: type + ' with the Coyote Creek District Advancement Committee.\n' +
        (member ? 'Committee member: ' + member + '\n' : '') + 'When: ' + whenText + '\n\n' + ADULT + '\n\n' +
        'Have your Proposal open. The call is about 20 minutes: we go over anything notable and help you get ready to present.\n' +
        'Need to change it? Use your Eagle Project page, or email the committee if it is less than 24 hours away.'
    };
  }

  var SIGN = '\n\nCoyote Creek District Advancement Committee';

  /** "book your <type>" email for the stage the Scout just reached. */
  /**
   * "Where do I stand" email (Action → ✉ Email status + page link) for stages without a booking to make.
   * Links to the sign-in PAGE (a fresh link is issued there), never a sign-in link itself (those expire).
   */
  function statusEmail(scoutName, statusText, bookingText, pageUrl) {
    return {
      subject: 'Your Eagle Project status (' + scoutName + ')',
      body: 'Here is where ' + scoutName + "'s Eagle Project stands: " + str(statusText) + '.' +
        (str(bookingText) ? '\n\n' + str(bookingText) : '') +
        '\n\nSign in to see your page, check your booking or send an update: ' + pageUrl + SIGN
    };
  }

  function bookingLinkEmail(code, scoutName, pageUrl) {
    if (code === EBOR) {
      return {
        subject: 'Next step: book your Eagle Board of Review (' + scoutName + ')',
        body: 'Council has verified the Eagle application for ' + scoutName + '. Congratulations!\n\n' +
          'Please sign in and pick a date for your Eagle Board of Review: ' + pageUrl + '\n\n' +
          'Your unit is notified when you book, so they can arrange the Unit Board Members. If your unit would like to hold ' +
          'the board on its own meeting night, have them email the committee.' + SIGN
      };
    }
    if (code === PROPOSAL_REVIEW) {
      return {
        subject: 'Next step: book your Proposal Review (' + scoutName + ')',
        body: 'The committee is ready for ' + scoutName + ' to present the Eagle Project Proposal at a Proposal Review.\n\n' +
          'Sign in and pick a date: ' + pageUrl + '\n\n' +
          'Reviews are in person. Come ready to present your project and answer questions.\n\n' + ADULT_IN_PERSON + SIGN
      };
    }
    return intakeOkEmail(scoutName, pageUrl);
  }

  function intakeOkEmail(scoutName, pageUrl) {
    return {
      subject: 'Next step: book your Pre-Review Call (' + scoutName + ')',
      body: 'Good news: the committee has checked the Proposal for ' + scoutName + ' and it is ready for the next step.\n\n' +
        'Please book a short (about 20 minute) Pre-Review Call with a committee member. It is an online call to go over ' +
        'anything notable and help you get ready to present your project.\n\n' +
        'Sign in and pick a time: ' + pageUrl + '\n\n' + ADULT + SIGN
    };
  }

  function bookedEmail(type, scoutName, whenText, member, meetUrl, pageUrl, where) {
    var inPerson = !!where;
    return {
      subject: type + ' booked: ' + scoutName + ', ' + whenText,
      body: 'Your ' + type + ' is booked.\n\n  When: ' + whenText + '\n' + (where ? '  Where: ' + where + '\n' : '') +
        (member ? '  With: ' + member + '\n' : '') + (meetUrl ? '  Join: ' + meetUrl + '\n' : '') +
        '\nA calendar invitation is on its way.\n\n' +
        (inPerson ? ADULT_IN_PERSON : ADULT) + '\n\n' +
        'To cancel or change (up to 24 hours before): ' + pageUrl + SIGN
    };
  }

  /** Follow-Up / Consult confirmation (built-in wording; template "Booked: Follow-Up / Consult"). Scouts can't change it themselves. */
  function followupBookedEmail(scoutName, whenText, member, meetUrl, where) {
    return {
      subject: label(FOLLOWUP) + ' booked: ' + scoutName + ', ' + whenText,
      body: 'A ' + label(FOLLOWUP) + ' is booked for ' + scoutName + '.\n\n  When: ' + whenText + '\n' + (where ? '  Where: ' + where + '\n' : '') +
        (member ? '  With: ' + member + '\n' : '') + (meetUrl ? '  Join: ' + meetUrl + '\n' : '') +
        '\nA calendar invitation is on its way.\n\n' + FOLLOWUP_ADULT + '\n\nNeed to change it? Reply to this email.' + SIGN
    };
  }

  function followupCancelledEmail(scoutName, whenText) {
    return {
      subject: label(FOLLOWUP) + ' cancelled: ' + scoutName + ', ' + whenText,
      body: 'The ' + label(FOLLOWUP) + ' on ' + whenText + ' for ' + scoutName + ' was cancelled. Questions? Reply to this email.' + SIGN
    };
  }

  /**
   * Log line for a Follow-Up / Consult ("Follow-up / consult booked Thu 11/12 5:00 PM with MB", Jim W. 2026-11-11).
   * kind: 'booked' | 'moved' (whenText = the new time) | 'cancelled'. who: initials list. by: who did it (optional).
   */
  function followupLog(kind, whenText, whoList, by) {
    var w = (whoList || []).filter(Boolean).join('/');
    return 'Follow-up / consult ' + kind + (kind === 'moved' ? ' to ' : ' ') + whenText + (kind === 'cancelled' ? '' : (w ? ' with ' + w : '')) +
      (str(by) ? ' (by ' + str(by) + ')' : '');
  }

  function movedEmail(type, scoutName, whenText, where, pageUrl) {
    return {
      subject: type + ' changed: ' + scoutName + ', now ' + whenText,
      body: 'The ' + type + ' for ' + scoutName + ' has a new date, time or place.\n\n  When: ' + whenText + '\n' +
        (where ? '  Where: ' + where + '\n' : '') + '\nThe calendar invitation has been updated. Your page: ' + pageUrl + SIGN
    };
  }

  function cancelledEmail(type, scoutName, whenText, pageUrl) {
    return {
      subject: type + ' cancelled: ' + scoutName + ', ' + whenText,
      body: 'The ' + type + ' on ' + whenText + ' for ' + scoutName + ' was cancelled. Pick a new time here: ' + pageUrl + SIGN
    };
  }

  return {
    TYPES: TYPES, PRE_REVIEW: PRE_REVIEW, PROPOSAL_REVIEW: PROPOSAL_REVIEW, BLOCKING: BLOCKING, ADULT: ADULT, ADULT_IN_PERSON: ADULT_IN_PERSON,
    ONLINE_PLACE: ONLINE_PLACE, isOnlinePlace: isOnlinePlace, isVirtual: isVirtual,
    EBOR: EBOR, FOLLOWUP: FOLLOWUP, BOOKABLE: BOOKABLE, BOOKED_TYPES: BOOKED_TYPES, isCommitteeOnly: isCommitteeOnly,
    upcomingBookings: upcomingBookings, bookingAt: bookingAt, followupBookedEmail: followupBookedEmail, followupCancelledEmail: followupCancelledEmail,
    followupLog: followupLog, FOLLOWUP_ADULT: FOLLOWUP_ADULT, BOOKABLE_SECTIONS: BOOKABLE_SECTIONS, rules: rules, slotChanges: slotChanges, place: place, inviteText: inviteText, missingGuests: missingGuests, guestChanges: guestChanges, SHADOW: SHADOW, isShadowType: isShadowType, isShadow: isShadow,
    bookingLinkEmail: bookingLinkEmail, movedEmail: movedEmail, changeWords: changeWords,
    typeCode: typeCode, label: label, splitWho: splitWho, makeSlotKey: makeSlotKey, missingKeys: missingKeys,
    parseTime: parseTime, slotStart: slotStart, who: who, openSlots: openSlots, leadOf: leadOf, isReserved: isReserved, isStaffed: isStaffed,
    currentBooking: currentBooking, canCancel: canCancel, bookableType: bookableType,
    parseOnline: parseOnline, onlineType: onlineType, statusEmail: statusEmail, matchScout: matchScout, committeeType: committeeType, committeeStatus: committeeStatus,
    findMember: findMember, resolveWho: resolveWho,
    eventText: eventText, intakeOkEmail: intakeOkEmail, bookedEmail: bookedEmail, cancelledEmail: cancelledEmail
  };
})();

if (typeof module !== 'undefined') module.exports = Booking;
