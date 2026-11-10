import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../apps-script/src/lib/outbox.js');

describe('Outbox helpers', () => {
  it('reads address lists and flags bad ones', () => {
    expect(O.addresses('A@x.org, b@y.org; a@x.org')).toEqual({ list: ['a@x.org', 'b@y.org'], bad: [] });
    expect(O.addresses(['ok@x.org', 'nope']).bad).toEqual(['nope']);
  });
  it('turns email HTML into readable text', () => {
    const t = O.htmlToText('<div>Hi <b>Pat</b>,</div><div><br></div><ul><li>When: Wed</li><li>Where: Y</li></ul>' +
      '<div>Page: <a href="https://x.org/signin">https://x.org/signin</a> and <a href="https://g.org">the guide</a></div>');
    expect(t).toBe('Hi Pat,\n\n- When: Wed\n- Where: Y\n\nPage: https://x.org/signin and the guide (https://g.org)');
  });
  it('removes anything active from edited HTML', () => {
    expect(O.clean('<b onclick="x()">a</b><script>bad()</script><a href="javascript:alert(1)">l</a>'))
      .toBe('<b>a</b><a href="#">l</a>');
  });
  it('makes ids and log lines', () => {
    expect(O.makeId(1000, () => 0.5)).toMatch(/^OB-RS-/);
    expect(O.logLine('10/21', 'JW', 'Status + page link', 'sent')).toBe('10/21 [JW] "Status + page link" email sent');
  });
});

describe('Outbox attachments and built-in wording', () => {
  it('text to HTML keeps lines and links, escapes markup', () => {
    expect(O.textToHtml('Hi <b>\nSee https://x.org/a?b=1')).toBe('Hi &lt;b&gt;<br>See <a href="https://x.org/a?b=1">https://x.org/a?b=1</a>');
  });
  it('reads the Attachments cell safely', () => {
    expect(O.parseAttachments('[{"id":"f1","name":"a.pdf"}]')).toEqual([{ id: 'f1', name: 'a.pdf' }]);
    expect(O.parseAttachments('')).toEqual([]);
    expect(O.parseAttachments('nonsense')).toEqual([]);
  });
  it('a member adds and removes files on a waiting email (2026-11-02)', () => {
    const one = O.withAttachment([], { id: 'f1', name: 'denial.pdf' });
    expect(one).toEqual([{ id: 'f1', name: 'denial.pdf' }]);
    expect(O.withAttachment(one, { id: 'f1', name: 'denial.pdf' })).toEqual(one);          // same Drive file once
    const two = O.withAttachment(one, { id: 'f2', name: 'scan.pdf' });
    expect(two.map(a => a.id)).toEqual(['f1', 'f2']);
    expect(O.withoutAttachment(two, 0)).toEqual([{ id: 'f2', name: 'scan.pdf' }]);
    expect(O.withoutAttachment(two, '1')).toEqual([{ id: 'f1', name: 'denial.pdf' }]);   // index from the page
    expect(O.withoutAttachment(two, 5)).toEqual(two);
    expect(O.withAttachment(two, { id: '' })).toEqual(two);
  });
});

describe('Outbox reply-to', () => {
  const O = require('../apps-script/src/lib/outbox.js');
  it('mode: chosen, else me with attachments, else group', () => {
    expect(O.replyMode('me', false)).toBe('me');
    expect(O.replyMode('', true)).toBe('me');
    expect(O.replyMode('', false)).toBe('group');
    expect(O.replyMode('nonsense', false)).toBe('group');
    expect(O.replyMode('both', false)).toBe('group');
  });
  it('addresses', () => {
    expect(O.replyTo('group', 'jw@x.org', 'ccac@x.org')).toBe('ccac@x.org');
    expect(O.replyTo('me', 'jw@x.org', 'ccac@x.org')).toBe('jw@x.org');
    expect(O.replyTo('me', '', 'ccac@x.org')).toBe('');
  });
});

describe('Google Groups 8 MB (2026-11-04)', () => {
  const O = require('../apps-script/src/lib/outbox.js');
  const MB = 1000 * 1000;
  it('warns only when a group is on the email; counts the encoded size', () => {
    const g = ['committee-group@googlegroups.com'];
    expect(O.groupSize(7 * MB, 'scout@x.org', '', g).level).toBe('');                              // no group: Gmail's 25 MB rules
    expect(O.groupSize(4 * MB, 'scout@x.org', 'Committee-Group@googlegroups.com', g)).toMatchObject({ level: '' });
    expect(O.groupSize(5 * MB, 'scout@x.org', 'committee-group@googlegroups.com', g)).toMatchObject({ level: 'near', mb: 6.7 });
    expect(O.groupSize(6.5 * MB, 'scout@x.org', 'other@googlegroups.com', [])).toMatchObject({ level: 'over', groups: ['other@googlegroups.com'] });
    expect(O.groupSize(0, 'a@x.org', g[0], g).level).toBe('');
  });
  it('the page uses the same rule', async () => {
    const { groupSize } = await import('../web/js/outbox.js');
    for (const n of [0, 4, 5, 6.5, 9]) {
      expect(groupSize(n * MB, 'scout@x.org', 'committee-group@googlegroups.com', [])).toEqual(
        O.groupSize(n * MB, 'scout@x.org', 'committee-group@googlegroups.com', []));
    }
  });
});
