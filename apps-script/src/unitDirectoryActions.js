/**
 * Unit contacts on the web (rules in lib/unitDirectory.js).
 *   unitDirectory     {session}                                   committee -> {units:[...]}
 *   unitContactsGet   {session, unit}                             committee or that unit's contacts -> {unit, ..., key3, contacts, canEditKey3}
 *   unitContactSave   {session, unit, kind, row?, orig?, fields}  kind 'key3' (committee; edit only) | 'contact' (edit, or add without row)
 *   unitContactDelete {session, unit, row, orig}                  unit-provided contacts only
 *   unitMeetingSave   {session, unit, fields, orig}               meeting day/time/frequency/place/notes (Unit Info tab)
 * Key 3 edits are overwritten by the next Council import (Admin → Unit contacts: import Key 3); the panel says so.
 */
function unitAccess_(session, unit) {
  var code = Units.code(unit);
  if (!code) throw userError_('Pick a unit.');
  var email = sessionEmail_(session);
  var committee = null;
  try { committee = CommitteeSchedule.memberFor(committee_(), email); } catch (e) {}
  if (committee) return { code: code, email: email, committee: true, who: committee.initials || email };
  var mine = Units.forEmail(units_(), email).map(function (u) { return u.code; });
  if (mine.indexOf(code) < 0) throw userError_('You are not listed as a contact for ' + Units.label(code) + '.');
  return { code: code, email: email, committee: false, who: email };
}

/** Unit Contacts tab in unit order (T41 before T964), then role, then name. Values only; call under the lock. */
function sortUnitContacts_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_CONTACTS_TAB);
  if (!sh || sh.getLastRow() < 3) return false;
  var width = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var ui = head.indexOf('Unit'), ri = head.indexOf('Role'), ni = head.indexOf('Name');
  if (ui < 0) return false;
  var range = sh.getRange(2, 1, sh.getLastRow() - 1, width);
  var rows = range.getValues();
  var sorted = UnitDirectory.sortRows(rows, ui, ri, ni);
  if (JSON.stringify(sorted) === JSON.stringify(rows)) return false;
  range.setValues(sorted);
  return true;
}

/** Unit Contacts: the "Updated By" column (added at the right end if missing; any case/spacing matches). -> its header */
function ensureUpdatedByColumn_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_CONTACTS_TAB);
  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  var hit = head.filter(function (h) { return h.toLowerCase() === 'updated by'; })[0];
  if (hit) return hit;
  sh.getRange(1, width + 1).setValue('Updated By').setFontWeight('bold');
  return 'Updated By';
}

/** Setup / repair: delete Unit Contacts rows that hold nothing but a unit. Call under the lock. -> how many */
function removeBlankUnitContacts_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_CONTACTS_TAB);
  if (!sh || sh.getLastRow() < 2) return 0;
  var rows = UnitDirectory.blankContactRows(Tabs.read(UNIT_CONTACTS_TAB));
  if (rows.length) Tabs.remove(UNIT_CONTACTS_TAB, rows);
  return rows.length;
}

function actionUnitDirectory_(req) {
  committeeMe_(req.session);
  return { units: UnitDirectory.directory(units_(), key3Rows_(), readTabOrEmpty_(UNIT_CONTACTS_TAB)) };
}

function actionUnitContactsGet_(req) {
  var a = unitAccess_(req.session, req.unit);
  var u = Units.find(units_(), a.code) || {};
  return { code: a.code, unit: Units.label(a.code), underReview: !!u.underReview, canEditKey3: a.committee, roles: UnitDirectory.ROLES,
    // The Unit Leader's address is for the committee only (the unit's own contacts see the rest of the Key 3 rows).
    key3: UnitDirectory.key3For(key3Rows_(), a.code).map(function (x) {
      if (!a.committee) { x.address = ''; x.city = ''; x.state = ''; x.zip = ''; }
      return x;
    }), contacts: UnitDirectory.contactsFor(readTabOrEmpty_(UNIT_CONTACTS_TAB), a.code),
    meeting: UnitDirectory.meetingFor(unitInfoDisplayRows_(), a.code).fields, days: UnitDirectory.DAYS, frequencies: UnitDirectory.FREQUENCIES,
    eagles: UnitDirectory.eaglesFor(unitInfoDisplayRows_(), a.code),
    eaglesThisYear: (function () { try { return eaglesThisYear_()[a.code] || 0; } catch (e) { return null; } })() };
}

/** Unit Info: add the meeting + stamp columns it lacks (any-case match, so a hand-typed "Last updated" is reused). -> headers */
function ensureUnitInfoColumns_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_INFO_TAB);
  if (!sh) throw userError_('The Unit Info tab is missing: run Setup / repair tabs.');
  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  var add = UnitDirectory.missingColumns(head);
  if (add.length) {
    sh.getRange(1, width + 1, 1, add.length).setValues([add]).setFontWeight('bold');
    head = head.concat(add);
  }
  return head;
}

/** Eagles to Date for one unit (committee or that unit's contacts): its own Edit/Save. Blank = unknown. */
function actionUnitEaglesSave_(req) {
  var a = unitAccess_(req.session, req.unit);
  var v = UnitDirectory.validateEagles(req.value);
  if (!v.ok) throw userError_(v.error);
  var was = withLock_(function () {
    var head = ensureUnitInfoColumns_();
    var cur = UnitDirectory.eaglesFor(unitInfoDisplayRows_(), a.code);
    if (cur !== String(req.orig == null ? '' : req.orig).trim()) throw userError_('The number changed meanwhile. Reload the page.');
    if (cur === v.clean) return null;
    var row = UnitDirectory.meetingFor(unitInfoDisplayRows_(), a.code).row || Tabs.append(UNIT_INFO_TAB, { 'Unit': Units.label(a.code) });
    var col = UnitDirectory.actualColumn(head, UnitDirectory.EAGLES);
    SpreadsheetApp.getActive().getSheetByName(UNIT_INFO_TAB).getRange(row, head.indexOf(col) + 1).setNumberFormat('@').setValue(v.clean);
    var upd = {};
    upd[UnitDirectory.actualColumn(head, 'Last Updated')] = new Date();
    upd[UnitDirectory.actualColumn(head, 'Updated By')] = a.who;
    Tabs.update(UNIT_INFO_TAB, row, upd);
    return { from: cur };
  });
  if (!was) return { message: 'No change.' };
  uncache_(['c:units']);
  unitLog_(a.code, 'Eagles to Date ' + (was.from || '(blank)') + ' → ' + (v.clean || '(blank)'), a.who);
  return { message: 'Saved.' };
}

/** Unit Info rows as the sheet shows them (text), keyed by header, with _row. [] when the tab is missing. */
function unitInfoDisplayRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_INFO_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getDisplayValues();
  var head = vals[0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  return vals.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { if (h && o[h] === undefined) o[h] = r[j]; });
    return o;
  });
}

/** Meeting info for one unit (Jim W., 2026-11-01): committee or that unit's contacts. Creates the unit's row if none. */
function actionUnitMeetingSave_(req) {
  var a = unitAccess_(req.session, req.unit);
  var v = UnitDirectory.validateMeeting(req.fields);
  if (!v.ok) throw userError_(v.errors.join(' '));
  var changed = withLock_(function () {
    var head = ensureUnitInfoColumns_();
    var col = function (name) { return UnitDirectory.actualColumn(head, name); };
    var cur = UnitDirectory.meetingFor(unitInfoDisplayRows_(), a.code);
    if (!UnitDirectory.sameMeeting(cur.fields, req.orig)) throw userError_('The meeting information changed meanwhile. Reload the page.');
    if (UnitDirectory.sameMeeting(cur.fields, v.clean)) return null;
    var row = cur.row || Tabs.append(UNIT_INFO_TAB, { 'Unit': Units.label(a.code) });
    // Plain text, so "7:00 PM" or "1st & 3rd" stays exactly as typed (Sheets would turn a time into a time value).
    var sh = SpreadsheetApp.getActive().getSheetByName(UNIT_INFO_TAB);
    var upd = {};
    UnitDirectory.MEETING.forEach(function (m) {
      var name = col(m.col);
      sh.getRange(row, head.indexOf(name) + 1).setNumberFormat('@');
      upd[name] = v.clean[m.key];
    });
    upd[col('Last Updated')] = new Date();
    upd[col('Updated By')] = a.who;
    Tabs.update(UNIT_INFO_TAB, row, upd);
    return UnitDirectory.MEETING.filter(function (m) { return String(cur.fields[m.key]) !== v.clean[m.key]; })
      .map(function (m) { return m.col.replace('Meeting ', '').toLowerCase() + ' "' + v.clean[m.key] + '"'; });
  });
  if (!changed) return { message: 'No change.' };
  uncache_(['c:units']);
  unitLog_(a.code, 'Meeting info: ' + changed.join(', '), a.who);
  return { message: 'Saved.' };
}

function unitLog_(code, entry, by) {
  try { Tabs.append(ACTIVITY_TAB, { 'When': new Date(), 'Scout': 'Unit ' + Units.label(code), 'Unit': Units.label(code), 'Record ID': '', 'Entry': entry, 'By': by || '' }); }
  catch (e) { console.warn('unitLog_: ' + e); }
}

function actionUnitContactSave_(req) {
  var a = unitAccess_(req.session, req.unit);
  var kind = req.kind === 'key3' ? 'key3' : 'contact';
  if (kind === 'key3' && !a.committee) throw userError_('The Unit Leader and Committee Chair come from Council\'s Key 3: ask the committee to correct them.');
  var v = UnitDirectory.validate(req.fields, kind);
  if (!v.ok) throw userError_(v.errors.join(' '));
  var c = v.clean, tab = kind === 'key3' ? KEY3_TAB : UNIT_CONTACTS_TAB, row = Number(req.row) || 0;
  var line = withLock_(function () {
    var by = kind === 'contact' ? ensureUpdatedByColumn_() : '';   // Unit Contacts: who changed the row (Jim W., 2026-11-01)
    if (!row) {
      if (kind === 'key3') throw userError_('Key 3 rows come from Council\'s import and can\'t be added here.');
      var add = { 'Unit': Units.label(a.code), 'Role': c.role, 'Name': c.name, 'Email': c.email, 'Phone': c.phone, 'Note': c.note, 'Updated': new Date() };
      add[by] = a.who;
      Tabs.append(UNIT_CONTACTS_TAB, add);
      sortUnitContacts_();                                  // keep the tab in unit order (Jim W., 2026-10-25)
      return 'added ' + c.role + ' ' + (c.name || c.email);
    }
    var cur = (kind === 'key3' ? key3Rows_() : Tabs.read(tab)).filter(function (r) { return r._row === row; })[0];
    if (!UnitDirectory.same(cur, a.code, req.orig)) throw userError_('That contact changed meanwhile. Reload the page.');
    var upd = kind === 'key3' ? { 'Name': c.name, 'Email': c.email, 'Phone': c.phone }
      : { 'Role': c.role, 'Name': c.name, 'Email': c.email, 'Phone': c.phone, 'Note': c.note, 'Updated': new Date() };
    if (by) upd[by] = a.who;
    Tabs.update(tab, row, upd);
    var addrNote = '';
    if (kind === 'key3' && Units.key3Role(cur['Role'], cur['Position']) === 'Unit Leader' && req.fields && req.fields.address !== undefined) {
      var oldAddr = [cur.address, cur.city, cur.state, cur.zip].join('|');
      if (oldAddr !== [c.address, c.city, c.state, c.zip].join('|')) {
        writeKey3Address_(row, c);
        addrNote = '; address ' + (c.address || c.city || c.zip ? 'changed' : 'cleared');
      }
    }
    return 'changed ' + (kind === 'key3' ? String(cur['Role']) + ' (Key 3)' : c.role) + ': ' + (req.orig.name || '') + ' <' + (req.orig.email || '') + '> → ' + c.name + ' <' + c.email + '>' + addrNote;
  });
  uncache_(['c:units']);
  unitLog_(a.code, 'Unit contacts: ' + line, a.who);
  return { message: kind === 'key3' ? 'Saved. Note: the next Key 3 import from Council replaces these two rows.' : 'Saved.' };
}

function actionUnitContactDelete_(req) {
  var a = unitAccess_(req.session, req.unit);
  var row = Number(req.row) || 0;
  var cur = withLock_(function () {
    var r = Tabs.read(UNIT_CONTACTS_TAB).filter(function (x) { return x._row === row; })[0];
    if (!UnitDirectory.same(r, a.code, req.orig)) throw userError_('That contact changed meanwhile. Reload the page.');
    if (!a.committee && String(r['Email']).trim().toLowerCase() === a.email) throw userError_('You can\'t remove yourself (you would lose access to this page). Ask the committee.');
    Tabs.remove(UNIT_CONTACTS_TAB, [row]);
    return r;
  });
  uncache_(['c:units']);
  unitLog_(a.code, 'Unit contacts: removed ' + cur['Role'] + ' ' + (cur['Name'] || '') + ' <' + cur['Email'] + '>', a.who);
  return { message: 'Removed.' };
}
