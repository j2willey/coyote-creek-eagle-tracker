// Xlsx (lib/xlsx.js) + the Key 3 import of the District Executive's export layout (2026-11-16). Fictional data only.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as Xlsx from '../web/js/xlsx.js';
const require = createRequire(import.meta.url);
const Key3 = require('../apps-script/src/lib/key3.js');

const fixtureRows = () => Xlsx.xlsxRows(fs.readFileSync('test/fixtures/key3-fake.xlsx'));

describe('Xlsx.read', () => {
  it('reads the first sheet of a real .xlsx (unzipped like the browser does; inline strings)', async () => {
    const x = { rows: await fixtureRows() };
    expect(x.rows[0].slice(0, 4)).toEqual(['displayname', 'fullname', 'address', 'citystate']);
    expect(x.rows[1][0]).toBe('Troop 0999');
    expect(x.rows[1][3]).toBe('Testville, CA');
    expect(x.rows[4][1]).toBe('Avery Advisor & Co');                  // entity unescaped
    expect(x.rows).toHaveLength(6);
  });
  it('shared strings, rich-text runs, numbers, booleans, gaps and the first sheet by its rels', () => {
    const parts = {
      'xl/workbook.xml': '<workbook><sheets><sheet name="Contacts" sheetId="3" r:id="rId7"/><sheet name="Other" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="/xl/worksheets/sheet3.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>unit</t></si><si><r><t>e</t></r><r><t xml:space="preserve">mail </t></r></si><si><t>T&amp;1</t><rPh><t>x</t></rPh></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet3.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>99999</v></c><c r="C3" t="b"><v>1</v></c><c r="D3"/></row></sheetData></worksheet>'
    };
    expect(Xlsx.firstSheetPath(parts['xl/workbook.xml'], parts['xl/_rels/workbook.xml.rels'])).toBe('xl/worksheets/sheet3.xml');
    expect(Xlsx.read(parts).rows).toEqual([['unit', '', 'email ', ''], ['T&1', '99999', 'TRUE', '']]);   // the empty row 2 is left out
  });
  it('a million styled empty rows are skipped, not built', () => {
    const blank = '<row r="9" customFormat="1"/>'.repeat(200000) + '<row r="300000"><c r="A300000" s="2"/></row>';
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>unit</t></is></c></row>' + blank + '</sheetData></worksheet>';
    const t = Date.now();
    expect(Xlsx.sheetRows(xml, [])).toEqual([['unit']]);
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('not an .xlsx: an error, no rows', async () => {
    expect(Xlsx.read({}).error).toMatch(/Excel/);
    await expect(Xlsx.xlsxRows(new TextEncoder().encode('unit,email\nT999,a@example.org'))).rejects.toThrow(/not an Excel/);
    expect(Xlsx.colIndex('AB12')).toBe(27);
    expect(Xlsx.wanted('xl/styles.xml')).toBe(false);
  });
});

describe('Key 3 from the District Executive export (displayname, fullname, citystate …)', () => {
  let p;
  beforeAll(async () => { p = Key3.parse(await fixtureRows()); });
  it('keeps Unit Leader + Committee Chair of troops and crews; drops packs and the Council Unit Representative', () => {
    expect(p.rows.map((r) => r.unit + ' ' + r.role)).toEqual(['C998 Unit Leader', 'T999 Committee Chair', 'T999 Unit Leader']);
    expect(p.skipped).toMatchObject({ 'Chartered Org Rep / Council Unit Rep': 1, 'packs / other unit types': 1 });
  });
  it('splits "City, ST" into the Unit Leader\'s city and state; the zip and street come along', () => {
    const ul = p.rows.find((r) => r.unit === 'T999' && r.role === 'Unit Leader');
    expect(ul).toMatchObject({ name: 'Pat Q Sample', email: 'sm999@example.org', address: '1 Fake St', city: 'Testville', state: 'CA', zip: '99999-0001' });
    expect(p.rows.find((r) => r.role === 'Committee Chair').city).toBe('');   // only the Unit Leader's row keeps an address
    expect(p.columns).toEqual({ name: true, position: true, phone: true, address: true, city: true, state: true, zip: true });
  });
  it('splitCityState', () => {
    expect(Key3.splitCityState('San Mock, CA')).toEqual({ city: 'San Mock', state: 'CA' });
    expect(Key3.splitCityState('Mocktown CA 99999')).toEqual({ city: 'Mocktown', state: 'CA' });
    expect(Key3.splitCityState('Mocktown')).toEqual({ city: 'Mocktown', state: '' });
  });
  it('an Exploring club or post is not a crew', () => {
    const q = Key3.parse([['displayname', 'position', 'email'], ['Club 0997', 'Exploring Sponsor', 'x@example.org'],
      ['Post 0996', 'Explorer Post Advisor', 'y@example.org'], ['Crew 0995', 'Venturing Crew Advisor', 'z@example.org']]);
    expect(q.rows.map((r) => r.unit + ' ' + r.role)).toEqual(['C995 Unit Leader']);
    expect(q.skipped['packs / other unit types']).toBe(2);
  });
  it('a file without addresses says so', () => {
    const q = Key3.parse([['Unit', 'Position', 'Email'], ['T999', 'Scoutmaster', 'a@example.org']]);
    expect(q.columns).toMatchObject({ address: false, city: false, zip: false, phone: false, name: false });
  });
});

describe('Key3.keepMissing: units left out of an import keep their rows (2026-11-16)', () => {
  const old = [
    { Unit: 'T999', Role: 'Unit Leader', Position: 'Scoutmaster', Name: 'Old SM', Email: 'old@example.org', Phone: '', address: '9 Old St', city: 'X', state: 'CA', zip: '1' },
    { Unit: 'T998', Role: 'Unit Leader', Position: 'Scoutmaster', Name: 'Kept SM', Email: 'kept@example.org', Phone: '555', address: '8 Kept St', city: 'Y', state: 'CA', zip: '2' },
    { Unit: 'T998', Role: 'Committee Chair', Position: 'Committee Chair', Name: 'Kept CC', Email: 'keptcc@example.org', Phone: '' }
  ];
  const fresh = [{ unit: 'T999', role: 'Unit Leader', position: 'Scoutmaster', name: 'New SM', email: 'new@example.org', phone: '', address: '', city: '', state: '', zip: '' }];
  const k = Key3.keepMissing(old, fresh);
  it('a unit in the file is replaced; a unit not in it is kept whole, address included', () => {
    expect(k.kept).toEqual(['T998']);
    expect(k.rows.map((r) => r.unit + ' ' + r.email)).toEqual(['T998 keptcc@example.org', 'T998 kept@example.org', 'T999 new@example.org']);
    expect(k.rows.find((r) => r.email === 'kept@example.org')).toMatchObject({ address: '8 Kept St', phone: '555' });
    expect(Key3.diff(old, k.rows)).toEqual({ added: ['T999 | Unit Leader | new@example.org'], removed: ['T999 | Unit Leader | old@example.org'] });
  });
});
