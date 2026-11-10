import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../apps-script/src/lib/templates.js');
const C = require('../apps-script/src/lib/templateCatalog.js');

const tab = (lines) => T.parseTab(T.linesToParas(lines));

describe('Templates', () => {
  it('reads the header and the body', () => {
    const x = tab(['Subject: Hi {scout}', 'Mode: Review', 'Cc: none', '----', 'Hello {scout}.']);
    expect(x).toMatchObject({ subject: 'Hi {scout}', mode: 'review', cc: 'none', errors: [] });
    expect(x.body).toHaveLength(1);
    expect(tab(['Subject: x', 'Hello']).errors[0]).toMatch(/----/);
    expect(tab(['Mode: Sometimes', '----', 'x']).errors.join(' ')).toMatch(/Mode must be/);
  });

  it('fills placeholders (escaped in HTML), drops lines whose placeholders are empty, lists array values', () => {
    const r = T.render(tab(['Subject: Booked: {scout}', '----', 'Hi {scout},', 'Where: {where}', 'Join: {meetLink}', '{files}']),
      { scout: 'Pat <B>', where: '', meetLink: 'https://meet.google.com/abc', files: ['a.pdf', 'b.pdf'] });
    expect(r.errors).toEqual([]);
    expect(r.subject).toBe('Booked: Pat <B>');
    expect(r.html).toContain('Hi Pat &lt;B&gt;,');
    expect(r.html).not.toContain('Where');
    expect(r.html).toContain('<a href="https://meet.google.com/abc">');
    expect(r.html).toContain('<li>a.pdf</li>');
    expect(r.text).toBe('Hi Pat <B>,\nJoin: https://meet.google.com/abc\n  - a.pdf\n  - b.pdf');
  });

  it('flags unknown placeholders', () => {
    expect(T.render(tab(['Subject: x', '----', 'Hi {scuot}']), { scout: 'P' }).errors[0]).toMatch(/\{scuot\}/);
  });

  it('keeps formatting: bold, colour, links, numbered lists, and placeholders split across runs', () => {
    const paras = [
      { runs: [{ text: 'Subject: x' }] }, { runs: [{ text: '----' }] },
      { runs: [{ text: 'Please ' }, { text: 'bring', bold: true, color: '#cc0000' }, { text: ' the ' }, { text: 'guide', link: 'https://x.org/g' }] },
      { runs: [{ text: 'Step one {sc' }, { text: 'out}', bold: true }], list: { ordered: true, level: 0, id: 'L' } },
      { runs: [{ text: 'Step two' }], list: { ordered: true, level: 0, id: 'L' } },
      { runs: [{ text: 'detail' }], list: { ordered: false, level: 1, id: 'L' } },
      { runs: [{ text: 'After' }], heading: 2 }
    ];
    const r = T.render(T.parseTab(paras), { scout: 'Pat' });
    expect(r.html).toContain('<span style="color:#cc0000"><b>bring</b></span>');
    expect(r.html).toContain('<a href="https://x.org/g">guide</a>');
    expect(r.html).toMatch(/<ol[^>]*><li>Step one Pat<\/li><li>Step two<\/li><ul[^>]*><li>detail<\/li><\/ul><\/ol>/);
    expect(r.html).toContain('font-size:17px');
    expect(r.text).toBe('Please bring the guide\n1. Step one Pat\n2. Step two\n  - detail\nAfter');
  });
});

describe('TemplateCatalog', () => {
  it('every starting template renders with its own placeholders and no errors', () => {
    C.LIST.forEach((x) => {
      const vars = {};
      x.vars.forEach((v) => { vars[v] = ['files', 'entries', 'changes'].includes(v) ? ['one'] : 'V_' + v; });
      const r = T.render(tab(C.seedLines(x)), vars);
      expect(r.errors, x.key).toEqual([]);
      expect(r.text.length, x.key).toBeGreaterThan(20);
    });
    expect(C.LIST.length).toBeGreaterThan(20);
    expect(new Set(C.LIST.map(x => x.key)).size).toBe(C.LIST.length);
  });

  it('sign-in and confirm emails are never copied to the group', () => {
    expect(C.get('Sign-in link').cc).toBe('none');
    expect(C.get('Confirm your submission').cc).toBe('none');
  });
});

describe('EBoR: one email to the Scout and the unit (2026-10-29)', () => {
  const MailPlan = require('../apps-script/src/lib/mailPlan.js');
  const E = require('../apps-script/src/lib/emailMenu.js');
  const base = { scout: 'Scout Nine', unit: 'T910', type: 'Eagle Board of Review', when: 'Wed 11/4 7:30 PM', was: '',
    where: 'YMCA', pageLink: 'https://x/signin', boardLink: 'https://x/signin', committeeEmail: 'ccac@x.org' };
  const render = (key, v) => T.render(tab(C.seedLines(C.get(key))), Object.assign({}, base, v));

  it('booked: greets the Scout and the unit; the board request only when the unit fills its own board', () => {
    const yes = render('Booked: Eagle Board of Review', {});
    expect(yes.subject).toBe('Eagle Board of Review booked: Scout Nine (T910), Wed 11/4 7:30 PM');
    expect(yes.text).toMatch(/^Hello Scout Nine and T910 leaders,/);
    expect(yes.text).toContain('Unit leaders: please arrange your Unit Board Members');
    const underReview = render('Booked: Eagle Board of Review', { boardLink: '' });
    expect(underReview.errors).toEqual([]);
    expect(underReview.text).not.toContain('Unit Board Members');
    expect(underReview.text).toContain('ccac@x.org');
  });

  it('moved says what changed; cancelled tells the unit nothing is needed', () => {
    const mv = render('Moved: Eagle Board of Review', { was: 'Mon 11/2 7:30 PM', wasWhere: '', change: 'moved', changeText: 'new date' });
    expect(mv.subject).toBe('Eagle Board of Review moved: Scout Nine (T910), Wed 11/4 7:30 PM');
    expect(mv.text).toContain('has a new date.');
    expect(mv.text).toContain('Previous time: Mon 11/2 7:30 PM');
    expect(mv.text).not.toContain('Previous place');
    const pl = render('Moved: Eagle Board of Review', { was: '', wasWhere: 'Old Hall', change: 'place changed', changeText: 'new place' });
    expect(pl.subject).toBe('Eagle Board of Review place changed: Scout Nine (T910), Wed 11/4 7:30 PM');
    expect(pl.text).toContain('has a new place.');
    expect(pl.text).toContain('Previous place: Old Hall');
    expect(pl.text).not.toContain('Previous time');
    expect(render('Cancelled: Eagle Board of Review', {}).text).toContain('Unit leaders: no action needed');
  });

  it('the unit-only templates are retired (IDs kept in the catalog, not offered in the Email menu)', () => {
    ['Unit: EBoR booked', 'Unit: EBoR moved', 'Unit: EBoR cancelled', 'Unit: EBoR booked (unit under review)'].forEach((k) => expect(C.get(k), k).toBeNull());
    const rows = C.catalogRows(() => null);
    expect(rows.find(r => r.id === '4.1.d').status).toMatch(/Retired/);
    expect(E.ENTRIES.some(e => /^Unit: EBoR/.test(e.key))).toBe(false);
  });

  it('recipients: To the Scout and the unit contacts, Cc the parent and the committee', () => {
    const f = MailPlan.family('scout@x.org', 'mom@x.org', 'ccac@x.org', ['sm170@x.org', 'cc@x.org']);
    expect(f.to).toEqual(['scout@x.org', 'sm170@x.org', 'cc@x.org']);
    expect(f.cc).toEqual(['mom@x.org', 'ccac@x.org']);
    expect(f.keepCc).toEqual(['mom@x.org']);
  });
});

describe('Sign-in link template: {code} line only when signinCode is on', () => {
  it('drops the code line when {code} is empty', () => {
    const tabX = tab(C.seedLines(C.get('Sign-in link')));
    expect(T.render(tabX, { link: 'https://x/s', minutes: '60', code: '482 913' }).text).toContain('482 913');
    const off = T.render(tabX, { link: 'https://x/s', minutes: '60', code: '' });
    expect(off.errors).toEqual([]);
    expect(off.text).not.toMatch(/code/i);
  });
});

describe('TemplateCatalog.fillPlan', () => {
  it('computes Docs API ranges for bullets, grey header lines and a heading', () => {
    const p = C.fillPlan(['Title', 'Subject: x', '----', '- one', 'end'], true);
    expect(p.text).toBe('Title\nSubject: x\n----\none\nend\n');
    expect(p.heading).toEqual([1, 7]);
    expect(p.grey).toEqual([[7, 17], [18, 22]]);
    expect(p.bullets).toEqual([[23, 27]]);
    expect(p.text.slice(23 - 1, 27 - 1)).toBe('one\n');
  });
});

describe('Template IDs and the catalog', () => {
  const C = require('../apps-script/src/lib/templateCatalog.js');
  it('every template has a unique, well-formed ID; planned/built-in IDs do not collide', () => {
    const ids = C.LIST.map(x => x.id).concat(C.OTHER.map(o => o.id));
    ids.forEach(id => expect(id).toMatch(/^[0-6]\.\d+\.[a-z]$/));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('finds a tab by its ID whatever the wording, else by the old title', () => {
    expect(C.idOf('2.3.a Approved, signed')).toBe('2.3.a');
    expect(C.idOf('Proposal approved')).toBe('');
    expect(C.findTab({ '2.3.a Approved, signed': 1, 'Sign-in link': 1 }, 'Proposal approved')).toBe('2.3.a Approved, signed');
    expect(C.findTab({ 'Sign-in link': 1 }, 'Sign-in link')).toBe('Sign-in link');
    expect(C.findTab({ 'Other': 1 }, 'Sign-in link')).toBe('');
    expect(C.get('2.3.a Whatever').key).toBe('Proposal approved');
    expect(C.tabTitle(C.get('Proposal approved'))).toBe('2.3.a Proposal approved');
  });
  it('catalog rows: sorted by ID, status from the tab Mode, planned rows included', () => {
    expect(C.cmpId('1.10.a', '1.2.b')).toBeGreaterThan(0);
    const rows = C.catalogRows((key) => key === 'Sign-in link' ? { mode: 'automatic', title: '0.1.a Sign-in link', tabId: 't.1' }
      : key === 'Proposal approved' ? { mode: 'off', title: '2.3.a', tabId: 't.2' } : null);
    expect(rows.map(r => r.id)).toEqual(rows.map(r => r.id).slice().sort(C.cmpId));
    expect(rows[0]).toMatchObject({ id: '0.1.a', status: 'Automatic', tabId: 't.1', phase: 'Sign-in', cc: 'none' });
    expect(rows.find(r => r.id === '2.3.a').status).toBe('Off (inactive)');
    expect(rows.find(r => r.id === '1.3.a').status).toBe('Template tab missing');
    expect(rows.find(r => r.id === '6.3.a')).toMatchObject({ status: 'Planned', phase: 'Committee / misc' });
    expect(rows.find(r => r.id === '6.2.b').phase).toBe('Committee / misc');
    expect(rows.find(r => r.id === '4.3.c').phase).toBe('EBoR');
    expect(rows.find(r => r.id === '3.2.a').phase).toBe('Project underway');
  });
  it('header lines split by a soft line break (Shift+Enter) still count', () => {
    const t = T.parseTab(T.linesToParas(['Subject: Next step ({scout})\rMode: Review', 'Cc: group', '----', 'Hi']));
    expect(t.subject).toBe('Next step ({scout})');
    expect(t.mode).toBe('review');
    expect(t.cc).toBe('group');
    expect(t.errors).toEqual([]);
  });
});
