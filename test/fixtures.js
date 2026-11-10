// A small fake tracking tab shaped like "CC Eagles 2026" (group row, label row, sections).
// All names/emails are fake.
function W(cells, width = 14) {
  const r = cells.slice();
  while (r.length < width) r.push('');
  return r;
}

const GROUP = W(['Scout Info', '', '', '', '', '', '', '', '', '', 'Eagle Project Proposal', '', 'Proposal Review', '', 'Notes']);
const LABEL = W(['Eagle Candidate', 'Unit', 'Birth Date', 'Female?', 'Scout Email', 'Parent/Guardian Email',
  'Scout Phone', 'BSA ID #', 'Extension Needed?', 'Age', 'Eagle Proj', 'Beneficiary', 'Date', 'Who', 'Notes']);

function trackingRows() {
  return [
    W(['Coyote Creek Eagles']),
    GROUP,
    LABEL,
    W(['Beyond Age of Eligibility – Special Needs']),
    W(['Unapproved Proposals']),
    W(['Something missing from Scout before scheduling review']),
    W(['Scout 1', 'T 101', '2009-01-01', '', 'pat.tester+Scout_1@example.com', 'pat.tester+Parent_1@example.com']),
    W(['Scout 2', 'T 102', '2009-02-02']),
    W(['']),
    W(['Proposals Pending Review Date']),
    W(['Scout 3', 'T 103']),
    W(['Proposal Reviews scheduled']),
    W(['Proposal awaiting revisions before approval']),
    W(['Approved Proposals']),
    W(['Scout 4', 'T 104']),
    W(['Submitted Eagle Applications', '', 'EBoR Date', 'EBOR docs', 'Photos Allowed on Social Media', 'CAC Review']),
    W(['Scout 5', 'T 105'])
  ];
}

module.exports = { trackingRows, W };
