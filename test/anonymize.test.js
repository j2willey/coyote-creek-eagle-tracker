import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../apps-script/src/lib/anonymize.js');

describe('Anonymize', () => {
  it('plus-addresses the test inbox and falls back to tester+<tag>@example.org when blank', () => {
    expect(A.plusAddress('tester@example.org', 'Scout_3')).toBe('tester+Scout_3@example.org');
    expect(A.plusAddress('tester+old@example.org', 'Scout_3')).toBe('tester+Scout_3@example.org');
    expect(A.plusAddress('nope', 'x')).toBe('');
    expect(A.testEmail('inbox@example.org', 'Member_A')).toBe('inbox+Member_A@example.org');
    expect(A.testEmail('', 'Member_A')).toBe('tester+Member_A@example.org');
  });

  it('makes the fake fields', () => {
    expect(A.fakeFields(7, 'tester@example.org', 'Some Coach')).toEqual({
      scout_name: 'Scout_7', scout_email: 'tester+Scout_7@example.org', parent_email: 'tester+Parent+Scout_7@example.org',
      scout_phone: '408-555-1212', bsa_id: '', proj_coach: 'Coach_7' });
    expect(A.fakeFields(1, 'tester@example.org', '').proj_coach).toBe('');
    expect(A.isFake('Scout_12')).toBe(true);
    expect(A.isFake('Scout 12')).toBe(false);
  });

  it('scrubs names (all forms), emails and phones from text', () => {
    const t = 'Called Pat Example (Example, Pat) at 408 555-0100; pat@family.example; file Pat_Example-T9_ESSPP-V1.pdf';
    const out = A.scrub(t, 'Pat Example', 'Scout_4', 'tester@example.org', 4);
    expect(out).toBe('Called Scout_4 (Scout_4) at 408-555-1212; tester+Other_4_1@example.org; file Scout_4-T9_ESSPP-V1.pdf');
    expect(A.scrub('mail tester+Scout_4@example.org', 'Pat Example', 'Scout_4', 'tester@example.org', 4)).toBe('mail tester+Scout_4@example.org');
  });
});
