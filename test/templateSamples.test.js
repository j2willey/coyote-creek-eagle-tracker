import { describe, it, expect } from 'vitest';
import S from '../apps-script/src/lib/templateSamples.js';
import C from '../apps-script/src/lib/templateCatalog.js';

describe('TemplateSamples', () => {
  it('has a sample for every placeholder in the catalog', () => {
    const missing = [];
    C.LIST.forEach(x => x.vars.forEach(n => { if (S.SAMPLE[n] === undefined && !missing.includes(n)) missing.push(n); }));
    expect(missing).toEqual([]);
  });
  it('wraps the email in TEST banners and says who it went to', () => {
    const w = S.wrap('Hello', 'Body', '<p>Body</p>', { id: '2.3.a', key: 'Proposal approved', source: 'built-in', mode: 'review', recipients: 'Scout', to: 'me@x.org' });
    expect(w.subject).toBe('[PREVIEW 2.3.a] Hello');
    expect(w.body.split('\n').slice(0, 3)).toEqual([S.BAR, S.TEST, S.BAR]);
    expect(w.body.trim().split('\n').slice(-3)).toEqual([S.BAR, S.TEST, S.BAR]);
    expect(w.body).toContain('sent only to me@x.org');
    expect(w.html).toContain('TEST TEST');
  });
});
