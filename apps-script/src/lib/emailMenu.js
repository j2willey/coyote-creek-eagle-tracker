/**
 * EmailMenu (Jim W., 2026-10-25): the "Email…" action on a Scout. Which emails fit the Scout's stage, what each one
 * needs, and whether it went out recently. Every pick is drafted into the Outbox (never sent straight away), so a
 * member can (re)send the email a stage change would have produced, e.g. for Scouts who reached the stage before the
 * new system, or a reminder discarded by mistake. Pure.
 */
var EmailMenu = (function () {
  function str(v) { return v == null ? '' : String(v).trim(); }
  var DAY = 86400000;
  var NO_STATUS = ['eagle_earned', 'eagle_not_awarded', 'proposal_not_approved', 'beyond_age'];

  // needs: '' | 'Intake' / 'ESSPPR' / 'EBoR' (the Scout's next slot of that type) | 'booked' (next session of any type)
  //        | 'note' (the committee's note: prefilled from the Scout's last request, editable)
  var ENTRIES = [
    { key: 'Status + page link', sections: '*', needs: '' },
    { key: 'Proposal incomplete', sections: ['proposal_incomplete'], needs: 'note' },
    { key: 'Revisions before review', sections: ['intake_revisions'], needs: 'note' },
    { key: 'Revisions requested', sections: ['proposal_revisions'], needs: 'note' },
    { key: 'Booked: Pre-Review Call', sections: ['intake_booked'], needs: 'Intake' },
    { key: 'Booked: Proposal Review', sections: ['review_booked'], needs: 'ESSPPR' },
    { key: 'Book: Pre-Review Call', sections: ['intake_to_book'], needs: '' },
    { key: 'Book: Proposal Review', sections: ['review_to_book'], needs: '' },
    { key: 'Please book', sections: ['intake_to_book', 'review_to_book', 'app_verified'], needs: '' },
    { key: 'Application submitted: acknowledgement', sections: ['app_submitted'], needs: '' },
    { key: 'Book: Eagle Board of Review', sections: ['app_verified', 'ebor_paused'], needs: '' },
    { key: 'EBoR paused', sections: ['ebor_paused'], needs: 'note' },
    { key: 'Booked: Eagle Board of Review', sections: ['ebor_booked'], needs: 'EBoR' },
    { key: 'Unit Board Members missing', sections: ['ebor_booked'], needs: 'EBoR' },
    { key: 'EBoR reminder', sections: ['ebor_booked'], needs: 'EBoR' },
    { key: 'Session briefing', sections: ['intake_booked', 'review_booked', 'ebor_booked'], needs: 'booked' }
  ];

  // Retired templates whose drafts still count as "already waiting" / "sent" for the email that replaced them.
  var OLD = { 'EBoR reminder': ['EBoR reminder: Scout', 'EBoR reminder: board'] };   // merged 2026-11-02

  function fits(e, section) {
    if (e.sections === '*') return !!section && NO_STATUS.indexOf(section) < 0;
    return e.sections.indexOf(section) >= 0;
  }

  /**
   * section: the Scout's stage. ctx: {slots: {Intake, ESSPPR, EBoR: bool}, hasBooked, underReview, request (the
   * committee's last note for this stage, or ''), idOf(key) -> '4.3.c', history: [{template, status, at (ms)}] (Outbox
   * rows of this Scout), nowMs}. -> [{key, id, label, ready, why, recent, note, noteDefault}]
   */
  function choices(section, ctx) {
    ctx = ctx || {};
    var now = ctx.nowMs || Date.now();
    return ENTRIES.filter(function (e) { return fits(e, section); }).map(function (e) {
      var why = '';
      var slots = ctx.slots || { EBoR: !!ctx.hasEbor };
      var TYPE = { Intake: 'Pre-Review Call', ESSPPR: 'Proposal Review', EBoR: 'EBoR' };
      if (TYPE[e.needs] && !slots[e.needs]) why = 'No upcoming ' + TYPE[e.needs] + ' for this Scout on the schedule.';
      if (e.needs === 'booked' && !ctx.hasBooked) why = 'No upcoming session for this Scout on the schedule.';
      if (e.key === 'Unit Board Members missing' && ctx.underReview) why = 'The unit is under review: the committee fills the board.';
      var id = ctx.idOf ? str(ctx.idOf(e.key)) : '';
      return { key: e.key, id: id, label: (id ? id + ' ' : '') + e.key, ready: !why, why: why, recent: recent(e.key, ctx.history, now),
        note: e.needs === 'note', noteDefault: e.needs === 'note' ? str(ctx.request) : '' };
    });
  }

  /** "already waiting in the Outbox" / "sent 10/24" (last 14 days) / '' for one template. */
  function recent(key, history, nowMs) {
    var names = [key].concat(OLD[key] || []);
    var mine = (history || []).filter(function (h) { return names.indexOf(str(h.template)) >= 0; });
    if (mine.some(function (h) { return h.status === 'Pending' || h.status === 'Scheduled'; })) return 'already waiting in the Outbox';
    var sent = mine.filter(function (h) { return /^Sent/.test(str(h.status)) && h.at && nowMs - h.at < 14 * DAY; })
      .sort(function (a, b) { return b.at - a.at; })[0];
    if (!sent) return '';
    var d = new Date(sent.at);
    return 'sent ' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function get(key) { return ENTRIES.filter(function (e) { return e.key === key; })[0] || null; }

  return { ENTRIES: ENTRIES, choices: choices, recent: recent, get: get, fits: fits };
})();

if (typeof module !== 'undefined') module.exports = EmailMenu;
