/**
 * TemplateSamples (Jim W., 2026-10-24): preview any catalog email with fake but real-looking values and send it
 * only to the member asking, inside TEST banners. Pure. All names/addresses are invented.
 */
var TemplateSamples = (function () {
  var SITE = 'https://eagle-tracker.example.org';
  var SAMPLE = {
    scout: 'Alex Rivera', firstName: 'Alex', eagleNumberLine: 'You are the 110th Eagle Scout of Troop 999!',
    eagleNumber: '110th Eagle Scout of Troop 999', firstNames: 'Alex, Jordan and Sam',
    times: ['Sat 11/7 9:00 AM', 'Sat 11/7 9:30 AM', 'Sun 11/8 2:00 PM'], unit: 'Troop 999', unitName: 'Troop 999',
    link: SITE + '/confirm?t=SAMPLE-LINK-NOT-REAL', minutes: '15', code: '482 913', days: '7', hours: '6',
    pageLink: SITE + '/signin', scheduleLink: SITE + '/signin', committeeEmail: 'committee@example.org',
    entries: ['Project: Benches for the Riverside Community Garden', 'Beneficiary: Riverside Community Garden (Pat Lee)',
      'Project coach: Sam Ortiz', 'Unit: Troop 999'],
    files: ['Proposal.pdf (2.1 MB)', 'Signed pages.pdf (0.8 MB)'], file: 'Alex Rivera - Signed Proposal.pdf',
    changes: ['Project coach phone updated', 'Beneficiary contact added'],
    type: 'Proposal Review', session: 'Proposal Review',
    when: 'Tue 11/17 7:00 PM', was: 'Mon 11/16 7:00 PM', wasWhere: 'Grace Church, 1 Old Road, San Jose', change: 'moved', changeText: 'new date', boardLink: SITE + '/signin', where: 'Community Church, 123 Main St, San Jose (Room 4)', with: 'Pat Example (district)',
    meetLink: 'https://meet.google.com/abc-defg-hij', maxMB: '20',
    date: 'November 17, 2026', verifiedDate: 'November 3, 2026', signedBy: 'Pat Example',
    note: 'Please add the beneficiary\'s phone number on page 3, and a materials list with estimated costs.',
    notes: 'Second review: revisions were requested on 10/20.', status: 'Proposal Review: To Book',
    booking: 'Proposal Review booked: Tue 11/17 7:00 PM', board: 'Pat Example (district), Chris Sample (district), Jordan Test (unit)',
    members: 'Pat Example, Chris Sample', dayOfContact: 'Text Pat Example at 408-555-0100.',
    folderLink: 'https://drive.google.com/drive/folders/SAMPLE', logLink: 'https://docs.google.com/document/d/SAMPLE/edit',
    photosLine: 'Photos from your Board of Review are attached.', senderName: 'Pat Example',
    description: 'Added the beneficiary letter, fixed the materials list and moved the project date to March.',
    signer: 'Jordan Test', boardDate: '11/17/2026', member: 'Pat Example',
    boxes: '- Advancement Report: Board member\n- Eagle Application (Requirement 7): Board of review chair'
  };

  /** Sample values for a catalog entry's placeholders (unknown names get "[name]"). */
  function vars(entry) {
    var out = {};
    ((entry && entry.vars) || []).forEach(function (n) { out[n] = SAMPLE[n] !== undefined ? SAMPLE[n] : '[' + n + ']'; });
    return out;
  }

  var BAR = new Array(65).join('=');
  var TEST = 'TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /**
   * Put TEST banners around a rendered email. info: {id, key, source, mode, cc, recipients, to}.
   * -> {subject, body, html}
   */
  function wrap(subject, text, html, info) {
    info = info || {};
    var about = [info.id + ' ' + info.key + ' (' + info.source + ')',
      'Real email goes to: ' + (info.recipients || '?') + (info.cc ? '; Cc: ' + info.cc : '') + '. Mode: ' + (info.mode || '?') + '.',
      'Sample data only. This copy was sent only to ' + info.to + '.'];
    var top = [BAR, TEST, BAR].concat(about).concat([BAR, '']);
    var bottom = ['', BAR, TEST, BAR];
    var box = function (lines) {
      return '<pre style="margin:0;padding:8px 10px;background:#fff4c2;border:2px solid #c7891a;color:#4a3300;' +
        'font:12px/1.4 Consolas,Menlo,monospace;white-space:pre-wrap">' + lines.map(esc).join('\n') + '</pre>';
    };
    return {
      subject: '[PREVIEW ' + info.id + '] ' + subject,
      body: top.join('\n') + '\n' + text + '\n' + bottom.join('\n'),
      html: box(top.slice(0, -1)) + '<div style="padding:14px 2px">' + html + '</div>' + box(bottom.slice(1))
    };
  }

  return { SAMPLE: SAMPLE, vars: vars, wrap: wrap, BAR: BAR, TEST: TEST };
})();

if (typeof module !== 'undefined') module.exports = TemplateSamples;
