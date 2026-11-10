import fs from 'node:fs';
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { CDN_SCRIPTS } from '../web/js/cdnIntegrity.js';

const sha384 = (file) => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64');

describe('cdnIntegrity: SRI hashes', () => {
  it('pdf-lib and pdfjs-dist hashes equal the hash of the file in node_modules', () => {
    expect(CDN_SCRIPTS.pdfLib.integrity).toBe(sha384('node_modules/pdf-lib/dist/pdf-lib.min.js'));
    expect(CDN_SCRIPTS.pdfJs.integrity).toBe(sha384('node_modules/pdfjs-dist/build/pdf.min.js'));
  });

  it('every entry is a pinned jsDelivr URL with a sha384 hash', () => {
    for (const e of Object.values(CDN_SCRIPTS)) {
      expect(e.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^/]+@\d+\.\d+\.\d+\//);
      expect(e.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    }
  });

  it('the schedule page tag carries the FullCalendar hash', () => {
    const html = fs.readFileSync('web/committee/schedule.html', 'utf8');
    expect(html).toContain(CDN_SCRIPTS.fullCalendar.url);
    expect(html).toContain(`integrity="${CDN_SCRIPTS.fullCalendar.integrity}"`);
  });
});
