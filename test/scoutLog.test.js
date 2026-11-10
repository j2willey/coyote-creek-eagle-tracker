import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../apps-script/src/lib/scoutLog.js');

describe('ScoutLog.noteLine', () => {
  it('adds date and initials', () => {
    expect(L.noteLine('Called the Scout, project on hold', '10/27', 'JW')).toBe('10/27 [JW] Called the Scout, project on hold');
  });
  it('keeps a typed date and tag', () => {
    expect(L.noteLine('10/25 [AB] met at roundtable', '10/27', 'JW')).toBe('10/25 [AB] met at roundtable');
    expect(L.noteLine('10/25/2026 [AB] x', '10/27', 'JW')).toBe('10/25/2026 [AB] x');
  });
  it('fills in whichever is missing', () => {
    expect(L.noteLine('10/25 met at roundtable', '10/27', 'JW')).toBe('10/25 [JW] met at roundtable');
    expect(L.noteLine('[AB] met', '10/27', 'JW')).toBe('10/27 [AB] met');
  });
  it('one line, trimmed, capped; empty -> empty', () => {
    expect(L.noteLine('  a\n b  ', '1/2', 'JW')).toBe('1/2 [JW] a b');
    expect(L.noteLine('   ', '1/2', 'JW')).toBe('');
    expect(L.noteLine('x'.repeat(5000), '1/2', 'JW').length).toBe(L.NOTE_MAX + 9);
  });
  it('a number that is not a date stays text', () => {
    expect(L.noteLine('3 board members confirmed', '1/2', 'JW')).toBe('1/2 [JW] 3 board members confirmed');
  });
  it('no initials -> committee', () => {
    expect(L.noteLine('hi', '1/2', '')).toBe('1/2 [committee] hi');
  });
});

describe('ScoutLog text', () => {
  it('cleans line ends and blank edges', () => {
    expect(L.cleanText('\r\n10/27 a  \r\n10/1 b\n\n')).toBe('10/27 a\n10/1 b');
    expect(L.same('a\r\nb ', 'a\nb')).toBe(true);
    expect(L.same('a\nb', 'a\nc')).toBe(false);
  });
  it('first non-blank line', () => {
    expect(L.firstLine('\n  \n10/27 [JW] x\n10/1 y')).toBe('10/27 [JW] x');
  });
  it('edit problems', () => {
    expect(L.editProblems('x')).toEqual([]);
    expect(L.editProblems('  \n ')).toHaveLength(1);
    expect(L.editProblems('x'.repeat(L.TEXT_MAX + 1))).toHaveLength(1);
  });
});
