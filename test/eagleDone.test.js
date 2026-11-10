import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../apps-script/src/lib/eagleDone.js');
const Intake = require('../apps-script/src/lib/intake.js');

describe('EagleDone', () => {
  const s = { inProgressFolder: '202x', exceptionsFolder: '' };
  it('folder placement by stage and EBoR date', () => {
    expect(E.placeFor('proposal_received', '', s)).toBe('202x');
    expect(E.placeFor('app_verified', '', s)).toBe('202x');
    expect(E.placeFor('ebor_booked', '2027-01-09', s)).toBe('2027');
    expect(E.placeFor('ebor_booked', '', s)).toBeNull();
    expect(E.placeFor('eagle_earned', '2026-10-13', s)).toBe('2026');
    expect(E.placeFor('ebor_paused', '2026-10-13', s)).toBeNull();
    expect(E.placeFor('eagle_not_awarded', '2026-10-13', s)).toBe('Exceptions');
    expect(E.placeFor('proposal_not_approved', '', { exceptionsFolder: 'Not Eagles' })).toBe('Not Eagles');
    expect(E.placeFor('ebor_booked', '2026-12-01', {})).toBe('2026');
  });
  it('unit, date and names', () => {
    expect(E.unitName('T2019')).toBe('Troop 2019');
    expect(E.unitName('c917')).toBe('Crew 917');
    expect(E.unitName('Pack 5')).toBe('Pack 5');
    expect(E.longDate('2026-10-13')).toBe('October 13, 2026');
    expect(E.firstName('Scout Q. One')).toBe('Scout');
    const n = E.fileNames('Scout Q. One', 'T 101', '2026-10-13', Intake.namePart, Intake.unitPart);
    expect(n.application).toBe('Scout_Q_One-T101_EagleApplication-Signed.pdf');
    expect(n.report).toBe('Scout_Q_One-T101_AdvancementReport-Signed.pdf');
    expect(n.photo(3)).toBe('Scout_Q_One-T101_EBoR-20261013-03.jpg');
  });
  it('recipients de-duplicated', () => {
    expect(E.recipients([['A@x.org', 'b@x.org'], ['a@x.org', ''], ['not-an-email', 'c@x.org']])).toEqual(['a@x.org', 'b@x.org', 'c@x.org']);
  });
});
