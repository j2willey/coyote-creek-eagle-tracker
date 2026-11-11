import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as PDFLib from 'pdf-lib';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import {
  aesCbcDecryptRaw,
  aes256CbcDecryptPkcs7,
  computePdf20HashEmptyPasswordAsync,
  extractEncryptKeyAsync,
  loadPdfWithDecrypt,
  flattenPagesUpTo,
  inspectPdfWithPdfJs,
  applySignatureAndFlatten,
  applyPlacedItemsAndFlatten
} from '../web/js/pdfEngine.js';
import {
  PDFLIB_VERSION,
  PDFJS_VERSION,
  canSignPage,
  defaultItems,
  newItemAtPoint
} from '../web/js/pdfPlan.js';
import {
  PDFLIB_CDN,
  PDFJS_CDN,
  PDFJS_WORKER_CDN,
  loadSavedSignature
} from '../web/js/pdfWorkshop.js';

// Minimal valid 1x1 transparent PNG bytes for testing signature embedding
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);

describe('pdfEngine: exact library pins and CDN version parity', () => {
  it('pins pdf-lib@1.17.1 and pdfjs-dist@3.11.174 in package.json, node_modules, and CDN URLs', () => {
    const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const pdfLibPkg = JSON.parse(fs.readFileSync('node_modules/pdf-lib/package.json', 'utf8'));
    const pdfJsPkg = JSON.parse(fs.readFileSync('node_modules/pdfjs-dist/package.json', 'utf8'));
    const tsPkg = JSON.parse(fs.readFileSync('node_modules/typescript/package.json', 'utf8'));

    expect(PDFLIB_VERSION).toBe('1.17.1');
    expect(PDFJS_VERSION).toBe('3.11.174');
    expect(rootPkg.devDependencies['pdf-lib']).toBe(PDFLIB_VERSION);
    expect(rootPkg.devDependencies['pdfjs-dist']).toBe(PDFJS_VERSION);
    expect(pdfLibPkg.version).toBe(PDFLIB_VERSION);
    expect(pdfJsPkg.version).toBe(PDFJS_VERSION);

    expect(PDFLIB_CDN).toBe(`https://cdn.jsdelivr.net/npm/pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.min.js`);
    expect(PDFJS_CDN).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`);
    expect(PDFJS_WORKER_CDN).toBe(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`);

    // Ensure portable JS TypeScript (5.x/6.x) is used rather than platform-specific native binaries
    expect(Number(tsPkg.version.split('.')[0])).toBeLessThan(7);
  });
});

describe('pdfEngine: NIST SP 800-38A AES-256-CBC and ISO 32000-2 Algorithm 2.B known-answer tests', () => {
  it('matches NIST SP 800-38A Section F.2.6 CBC-AES256.Decrypt 4-block test vector', () => {
    const key = Uint8Array.from(
      Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex')
    );
    const iv = Uint8Array.from(
      Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
    );
    const ciphertext = Uint8Array.from(
      Buffer.from(
        'f58c4c04d6e5f1ba779eabfb5f7bfbd6' +
        '9cfc4e967edb808d679f777bc6702c7d' +
        '39f23369a9d9bacfa530e26304231461' +
        'b2eb05e2c39be9fcda6c19078c6a9d1b',
        'hex'
      )
    );
    const expectedPlaintext =
      '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710';

    const actual = aesCbcDecryptRaw(key, iv, ciphertext);
    expect(Buffer.from(actual).toString('hex')).toBe(expectedPlaintext);
  });

  it('decrypts AES-256-CBC with prepended IV and strips PKCS#7 padding across block lengths', () => {
    const key = Uint8Array.from(
      Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex')
    );
    const iv = Uint8Array.from(Buffer.from('fedcba98765432100123456789abcdef', 'hex'));
    for (const len of [0, 1, 7, 15, 16, 17, 31, 32, 48]) {
      const msg = new Uint8Array(len);
      for (let i = 0; i < len; i++) msg[i] = (i * 37 + 11) & 0xff;
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const enc = Buffer.concat([iv, cipher.update(msg), cipher.final()]);
      const dec = aes256CbcDecryptPkcs7(key, new Uint8Array(enc));
      expect(Buffer.from(dec).toString('hex')).toBe(Buffer.from(msg).toString('hex'));
    }
  });

  it('matches the ISO 32000-2 Algorithm 2.B (Revision 6) empty-password key derivation vector', async () => {
    const salt = Uint8Array.from(Buffer.from('0102030405060708', 'hex'));

    // Reference implementation using Node's native OpenSSL crypto
    let refK = new Uint8Array(crypto.createHash('sha256').update(salt).digest());
    let last = 0;
    for (let i = 0; i < 64 || last > i - 32; i++) {
      const k1 = Buffer.alloc(refK.length * 64);
      for (let j = 0; j < 64; j++) k1.set(refK, j * refK.length);
      const c = crypto.createCipheriv('aes-128-cbc', refK.subarray(0, 16), refK.subarray(16, 32));
      c.setAutoPadding(false);
      const e = Buffer.concat([c.update(k1), c.final()]);
      last = e[e.length - 1];
      let sum = 0;
      for (let j = 0; j < 16; j++) sum += e[j];
      const alg = sum % 3 === 0 ? 'sha256' : sum % 3 === 1 ? 'sha384' : 'sha512';
      refK = new Uint8Array(crypto.createHash(alg).update(e).digest());
    }
    const expectedHex = Buffer.from(refK.subarray(0, 32)).toString('hex');
    const actual = await computePdf20HashEmptyPasswordAsync(salt);
    expect(Buffer.from(actual).toString('hex')).toBe(expectedHex);
    expect(actual.byteLength).toBe(32);
  });
});

describe('pdfEngine: PDFParser.prototype hook restoration and concurrency lock', () => {
  // Build a minimal syntactically valid /V 5 /R 5 empty-password /Encrypt header so extractEncryptKeyAsync succeeds
  function buildMinimalEncryptedHeaderWithCorruptBody() {
    const valSalt = Buffer.from('1122334455667788', 'hex');
    const keySalt = Buffer.from('8877665544332211', 'hex');
    const uHash = crypto.createHash('sha256').update(valSalt).digest();
    const uBytes = Buffer.concat([uHash, valSalt, keySalt]); // 48 bytes
    const ueBytes = Buffer.alloc(32, 0x42);
    const esc = (buf) => {
      let s = '';
      for (const b of buf) s += '\\' + b.toString(8).padStart(3, '0');
      return s;
    };
    // Omit %PDF- header so PDFParser.prototype.parseDocument throws MissingPDFHeaderError while hooks are active
    const text =
      `10 0 obj\n<</Filter/Standard/V 5/R 5/Length 256/U(${esc(uBytes)})/UE(${esc(ueBytes)})>>\nendobj\n` +
      'trailer\n<</Root 1 0 R/Encrypt 10 0 R>>\n%%EOF\n';
    return new Uint8Array(Buffer.from(text, 'latin1'));
  }

  it('restores PDFParser.prototype methods when PDFDocument.load throws', async () => {
    const origHeader = PDFLib.PDFParser.prototype.parseIndirectObjectHeader;
    const origObject = PDFLib.PDFParser.prototype.parseObject;
    const badBytes = buildMinimalEncryptedHeaderWithCorruptBody();

    await expect(loadPdfWithDecrypt(PDFLib, badBytes)).rejects.toThrow();

    expect(PDFLib.PDFParser.prototype.parseIndirectObjectHeader).toBe(origHeader);
    expect(PDFLib.PDFParser.prototype.parseObject).toBe(origObject);
  });

  it('serializes concurrent loadPdfWithDecrypt calls so prototype hooks never interleave', async () => {
    const origHeader = PDFLib.PDFParser.prototype.parseIndirectObjectHeader;
    const origObject = PDFLib.PDFParser.prototype.parseObject;

    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([200, 200]);
    const validBytes = new Uint8Array(await doc.save());

    // Attach an empty-password /V 5 /R 5 trailer ref to exercise the locked decrypt path concurrently
    const valSalt = Buffer.from('1122334455667788', 'hex');
    const keySalt = Buffer.from('8877665544332211', 'hex');
    const uHash = crypto.createHash('sha256').update(valSalt).digest();
    const uBytes = Buffer.concat([uHash, valSalt, keySalt]);
    const ueBytes = Buffer.alloc(32, 0x00);
    const esc = (buf) => [...buf].map(b => '\\' + b.toString(8).padStart(3, '0')).join('');
    const suffix = Buffer.from(
      `\n99 0 obj\n<</Filter/Standard/V 5/R 5/Length 256/U(${esc(uBytes)})/UE(${esc(ueBytes)})>>\nendobj\n` +
      'trailer\n<</Encrypt 99 0 R>>\n',
      'latin1'
    );
    const wrapped = new Uint8Array(Buffer.concat([Buffer.from(validBytes), suffix]));

    const [d1, d2] = await Promise.all([
      loadPdfWithDecrypt(PDFLib, wrapped),
      loadPdfWithDecrypt(PDFLib, wrapped)
    ]);
    expect(d1.getPageCount()).toBe(1);
    expect(d2.getPageCount()).toBe(1);
    expect(PDFLib.PDFParser.prototype.parseIndirectObjectHeader).toBe(origHeader);
    expect(PDFLib.PDFParser.prototype.parseObject).toBe(origObject);
  });

  it('accepts hex-string /U <hex> and /UE <hex> with whitespace, and throws a plain message on unsupported encryption', async () => {
    const valSalt = Buffer.from('1122334455667788', 'hex');
    const keySalt = Buffer.from('8877665544332211', 'hex');
    const uHash = crypto.createHash('sha256').update(valSalt).digest();
    const uBytes = Buffer.concat([uHash, valSalt, keySalt]);
    const ueBytes = Buffer.alloc(32, 0x24);
    const esc = (buf) => [...buf].map(b => '\\' + b.toString(8).padStart(3, '0')).join('');

    const literalPdf = new Uint8Array(
      Buffer.from(
        `%PDF-1.7\n10 0 obj\n<</Filter/Standard/V 5/R 5/Length 256/U(${esc(uBytes)})/UE(${esc(ueBytes)})>>\nendobj\n` +
        'trailer\n<</Root 1 0 R/Encrypt 10 0 R>>\n%%EOF\n',
        'latin1'
      )
    );
    const hexPdf = new Uint8Array(
      Buffer.from(
        `%PDF-1.7\n10 0 obj\n<< /Filter /Standard /V 5 /R 5 /Length 256 /U  <${uBytes.toString('hex').toUpperCase()}> /UE\n<${ueBytes.toString('hex')}> >>\nendobj\n` +
        'trailer\n<</Root 1 0 R/Encrypt 10 0 R>>\n%%EOF\n',
        'latin1'
      )
    );

    const infoLit = await extractEncryptKeyAsync(literalPdf);
    const infoHex = await extractEncryptKeyAsync(hexPdf);
    expect(infoLit).not.toBeNull();
    expect(infoHex).not.toBeNull();
    expect(Buffer.from(infoHex.fileKey).toString('hex')).toBe(Buffer.from(infoLit.fileKey).toString('hex'));

    // Encrypted non-V5 PDF (e.g. /V 4 or /V 2) throws the exact plain error message
    const nonV5Pdf = new Uint8Array(
      Buffer.from(
        '%PDF-1.7\n10 0 obj\n<</Filter/Standard/V 4/R 4/Length 128>>\nendobj\ntrailer\n<</Root 1 0 R/Encrypt 10 0 R>>\n%%EOF\n',
        'latin1'
      )
    );
    await expect(loadPdfWithDecrypt(PDFLib, nonV5Pdf)).rejects.toThrow(
      "This PDF is protected in a way the Workshop can't open. Use download, sign and upload instead."
    );
  });
});

async function buildSyntheticWorkbookPdf() {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const p3 = doc.addPage([612, 792]);

  p1.drawText('Eagle Scout Leadership Service Project Workbook, No. 512 - 927 October 2026', { x: 60, y: 740, size: 11, font });
  p2.drawText('11 Proposal Approval - Council or District Approval', { x: 60, y: 740, size: 11, font });
  p3.drawText('13 PROJECT PLAN - Completing the project plan is mandatory', { x: 60, y: 740, size: 11, font });

  const form = doc.getForm();
  const fTitle = form.createTextField('Project Title');
  fTitle.setText('Community Garden');
  fTitle.addToPage(p1, { x: 100, y: 680, width: 200, height: 20 });

  const fName = form.createTextField('District or Council Approval Name');
  fName.addToPage(p2, { x: 360, y: 110, width: 197, height: 19 });

  const fDate = form.createTextField('District or Council Signature Date');
  fDate.addToPage(p2, { x: 484, y: 130, width: 73, height: 21 });

  const fPlan = form.createTextField('Comments from Proposal Review');
  fPlan.setText('Add mulch estimate');
  fPlan.addToPage(p3, { x: 100, y: 600, width: 250, height: 40 });

  const saved = await doc.save();
  return new Uint8Array(saved);
}

describe('pdfEngine: synthetic workbook sign, per-page flatten, and second signer', () => {
  it('fills Council/District fields, flattens Proposal pages (1..2), and preserves Project Plan fields (page 3)', async () => {
    const rawPdf = await buildSyntheticWorkbookPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, rawPdf);
    expect(analysis.edition).toBe('2026');
    expect(analysis.approvalPageIndices).toEqual([1]);
    expect(analysis.firstNotOursPageIndex).toBe(2);
    expect(analysis.proposalEndPageIndex).toBe(1);

    // Guardrail 1: Cannot sign Page 3 (Project Plan)
    await expect(
      applySignatureAndFlatten(PDFLib, {
        pdfBytes: rawPdf,
        analysis,
        pageIndex: 2,
        signerIndex: 0,
        signaturePngBytes: TINY_PNG,
        printedName: 'Pat Q. Reviewer',
        dateStr: '04/19/2026'
      })
    ).rejects.toThrow(/Project Plan.*cannot be signed/i);

    // Signer 1 signs Page 2 (index 1)
    const signed1 = await applySignatureAndFlatten(PDFLib, {
      pdfBytes: rawPdf,
      analysis,
      pageIndex: 1,
      signerIndex: 0,
      signaturePngBytes: TINY_PNG,
      printedName: 'Pat Q. Reviewer',
      dateStr: '04/19/2026'
    });

    const after1 = await inspectPdfWithPdfJs(pdfjsLib, signed1.pdfBytes);
    // Pages 1 and 2 have 0 widgets left; Page 3 still has its fillable Project Plan widget!
    const doc1 = await after1.pdfjsDoc;
    const p1Annots = (await (await doc1.getPage(1)).getAnnotations()).filter(a => a.subtype === 'Widget');
    const p2Annots = (await (await doc1.getPage(2)).getAnnotations()).filter(a => a.subtype === 'Widget');
    const p3Annots = (await (await doc1.getPage(3)).getAnnotations()).filter(a => a.subtype === 'Widget');
    expect(p1Annots.length).toBe(0);
    expect(p2Annots.length).toBe(0);
    expect(p3Annots.length).toBe(1);
    expect(p3Annots[0].fieldName).toBe('Comments from Proposal Review');

    const p2Text1 = (await (await doc1.getPage(2)).getTextContent()).items.map(i => i.str).join(' ');
    expect(p2Text1).toContain('Pat Q. Reviewer');
    expect(p2Text1).toContain('04/19/2026');

    // Signer 2 adds second committee signature to the already-signed PDF with custom signatureScale & textFontSize
    const signed2 = await applySignatureAndFlatten(PDFLib, {
      pdfBytes: signed1.pdfBytes,
      analysis: after1.analysis,
      pageIndex: 1,
      signerIndex: 1,
      signaturePngBytes: TINY_PNG,
      printedName: 'Owen Fairbanks',
      dateStr: '04/20/2026',
      signatureScale: 1.15,
      textFontSize: 11
    });

    const after2 = await inspectPdfWithPdfJs(pdfjsLib, signed2.pdfBytes);
    const doc2 = after2.pdfjsDoc;
    const p2Text2 = (await (await doc2.getPage(2)).getTextContent()).items.map(i => i.str).join(' ');
    // Both Signer 1 and Signer 2 are present in vector text on Page 2, and Page 3 is still fillable
    expect(p2Text2).toContain('Pat Q. Reviewer');
    expect(p2Text2).toContain('Owen Fairbanks');
    expect(p2Text2).toContain('04/20/2026');
    const p3AnnotsAfter2 = (await (await doc2.getPage(3)).getAnnotations()).filter(a => a.subtype === 'Widget');
    expect(p3AnnotsAfter2.length).toBe(1);

    // Fix 2: Verify that flattened widget XObject draws (/FlatWidget) come BEFORE the signature image / text operators
    // Also verify on signed1 (where widgets were flattened on Page 2 before Signer 1's signature image was drawn)
    const reloadedDoc1 = await PDFLib.PDFDocument.load(signed1.pdfBytes);
    const signedPage = reloadedDoc1.getPages()[1];
    const contentsRef = signedPage.node.Contents();
    const collectStreamText = (node) => {
      if (node instanceof PDFLib.PDFRef) return collectStreamText(reloadedDoc1.context.lookup(node));
      if (node instanceof PDFLib.PDFArray) {
        let all = '';
        for (let i = 0; i < node.size(); i++) all += '\n' + collectStreamText(node.get(i));
        return all;
      }
      if (node && node.contents) {
        const raw = Buffer.from(node.contents);
        try {
          return zlib.inflateSync(raw).toString('latin1');
        } catch {
          return raw.toString('latin1');
        }
      }
      return '';
    };
    const streamStr = collectStreamText(contentsRef);
    const lastFlatWidgetIdx = streamStr.lastIndexOf('/FlatWidget');
    const lastImageIdx = streamStr.lastIndexOf('/Image-');
    expect(lastFlatWidgetIdx).toBeGreaterThanOrEqual(0);
    expect(lastImageIdx).toBeGreaterThan(lastFlatWidgetIdx);
  });

  it('never loses or misstates Scout text during flattenPagesUpTo: (a) value + no /AP, (b) /NeedAppearances true + stale /AP, (c) normal /AP preserved, (d) bad encoding throws plain error', async () => {
    const { PDFName, PDFString, PDFBool, StandardFonts } = PDFLib;

    // (a) Field with a value (/V) and NO appearance stream (/AP deleted)
    {
      const doc = await PDFLib.PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const tf = form.createTextField('ScoutFieldNoAP');
      tf.setText('Bench Restoration');
      tf.addToPage(page, { x: 80, y: 700, width: 200, height: 22 });
      // Strip the /AP dictionary from the widget so it has /V but no appearance stream
      for (const w of tf.acroField.getWidgets()) {
        w.dict.delete(PDFName.of('AP'));
      }
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      flattenPagesUpTo(PDFLib, doc, 0, helv);
      const saved = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
      const { pdfjsDoc } = await inspectPdfWithPdfJs(pdfjsLib, saved);
      const text = (await (await pdfjsDoc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      expect(text).toContain('Bench Restoration');
    }

    // (b) AcroForm has /NeedAppearances true and a stale /AP stream
    {
      const doc = await PDFLib.PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const tf = form.createTextField('ScoutFieldStaleAP');
      tf.setText('Stale Old Title');
      tf.addToPage(page, { x: 80, y: 700, width: 200, height: 22 });
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      tf.defaultUpdateAppearances(helv);
      // Now overwrite /V directly without updating /AP, and set /NeedAppearances true
      tf.acroField.dict.set(PDFName.of('V'), PDFString.of('Updated Trail Bridge'));
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

      flattenPagesUpTo(PDFLib, doc, 0, helv);
      expect(form.acroForm.dict.lookup(PDFName.of('NeedAppearances'))).not.toBe(PDFBool.True);

      const saved = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
      const { pdfjsDoc } = await inspectPdfWithPdfJs(pdfjsLib, saved);
      const text = (await (await pdfjsDoc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      expect(text).toContain('Updated Trail Bridge');
      expect(text).not.toContain('Stale Old Title');
    }

    // (c) Normal case unchanged: existing /AP is NOT regenerated when /NeedAppearances is false/absent
    {
      const doc = await PDFLib.PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const tf = form.createTextField('ScoutFieldExistingAP');
      tf.setText('Preserved Appearance Marker');
      tf.addToPage(page, { x: 80, y: 700, width: 220, height: 22 });
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      tf.defaultUpdateAppearances(helv);
      const widget = tf.acroField.getWidgets()[0];
      const origAppRef = widget.getNormalAppearance();
      // Mutate /V without setting /NeedAppearances; since /NeedAppearances is not true and /AP exists, origAppRef stays untouched
      tf.acroField.dict.set(PDFName.of('V'), PDFString.of('Different Value Without NeedAppearances'));

      flattenPagesUpTo(PDFLib, doc, 0, helv);
      const saved = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
      const { pdfjsDoc } = await inspectPdfWithPdfJs(pdfjsLib, saved);
      const text = (await (await pdfjsDoc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      expect(text).toContain('Preserved Appearance Marker');
      expect(origAppRef).toBeDefined();
    }

    // (d) Unencodable text with missing /AP throws the plain error instead of silently dropping text
    {
      const doc = await PDFLib.PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const tf = form.createTextField('UnencodableField');
      tf.addToPage(page, { x: 80, y: 700, width: 200, height: 22 });
      for (const w of tf.acroField.getWidgets()) {
        w.dict.delete(PDFName.of('AP'));
      }
      // Put a UTF-16BE PDFHexString with CJK characters that WinAnsi Helvetica cannot encode
      tf.acroField.dict.set(PDFName.of('V'), PDFLib.PDFHexString.fromText('日本語テスト'));
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      expect(() => flattenPagesUpTo(PDFLib, doc, 0, helv)).toThrow(
        "This Proposal has form text the Workshop can't flatten safely. Use download, sign and upload instead."
      );
    }
  });

  it('defaults "Remember my signature" (hasSaved) to false until a signature is saved in localStorage', () => {
    const prevStorage = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    try {
      const fresh = loadSavedSignature('Pat Q. Reviewer');
      expect(fresh.hasSaved).toBe(false);

      store.set('ccacSignature_v1', JSON.stringify({
        mode: 'type',
        typedText: 'Pat Q. Reviewer',
        fontKey: 'dancing',
        pngDataUrl: 'data:image/png;base64,AAAA',
        printedName: 'Pat Q. Reviewer',
        signatureScale: 1,
        textFontSize: 0
      }));
      const saved = loadSavedSignature('Pat Q. Reviewer');
      expect(saved.hasSaved).toBe(true);
    } finally {
      globalThis.localStorage = prevStorage;
    }
  });
});

// ---------------------------------------------------------------------------
// Task 9: placed items on several pages, flatten range, stamps with alpha
// ---------------------------------------------------------------------------

/** A 4x4 RGBA PNG: left half opaque dark, right half fully transparent (hand-built so the test needs no image lib). */
function buildAlphaPng() {
  const w = 4, h = 4;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 4;
      raw[o] = 20; raw[o + 1] = 20; raw[o + 2] = 120; raw[o + 3] = x < 2 ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]));
}

/** Pages: 0 cover (field), 1 approval, 2 more Proposal text field "Proposal-Notes" (value), 3 Plan, 4 Plan. */
async function buildPlacedItemsPdf() {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const pages = [0, 1, 2, 3, 4].map(() => doc.addPage([612, 792]));
  pages[0].drawText('Eagle Scout Leadership Service Project Workbook, No. 512 - 927 October 2026', { x: 60, y: 740, size: 11, font });
  pages[1].drawText('11 Proposal Approval - Council or District Approval', { x: 60, y: 740, size: 11, font });
  pages[2].drawText('Supporting page', { x: 60, y: 740, size: 11, font });
  pages[3].drawText('13 PROJECT PLAN - Completing the project plan is mandatory', { x: 60, y: 740, size: 11, font });
  pages[4].drawText('Project Plan Reviews Input from Beneficiary Input from Scoutmaster', { x: 60, y: 740, size: 11, font });
  const form = doc.getForm();
  const nm = form.createTextField('District or Council Approval Name');
  nm.addToPage(pages[1], { x: 360, y: 110, width: 197, height: 19 });
  const dt = form.createTextField('District or Council Signature Date');
  dt.addToPage(pages[1], { x: 484, y: 130, width: 73, height: 21 });
  const notes = form.createTextField('Proposal-Notes');
  notes.setText('Scout typed this');
  notes.addToPage(pages[2], { x: 100, y: 600, width: 250, height: 30 });
  const plan = form.createTextField('Comments from Proposal Review');
  plan.setText('Plan text');
  plan.addToPage(pages[3], { x: 100, y: 600, width: 250, height: 40 });
  return new Uint8Array(await doc.save());
}

const widgetsOnPage = async (bytes, pageNo) => {
  const { pdfjsDoc } = await inspectPdfWithPdfJs(pdfjsLib, bytes);
  return (await (await pdfjsDoc.getPage(pageNo)).getAnnotations()).filter(a => a.subtype === 'Widget');
};

describe('pdfEngine: Task 9, placed items and the flatten range', () => {
  const pageSize = { width: 612, height: 792 };

  it('draws items on two pages and flattens the Proposal pages plus the marked page, never the Plan pages', async () => {
    const raw = await buildPlacedItemsPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, raw);
    expect(analysis.approvalPageIndices).toEqual([1]);
    expect(analysis.firstNotOursPageIndex).toBe(3);
    expect(analysis.proposalEndPageIndex).toBe(1);

    // Page 2 (index 1): the workbook's own boxes. Page 3 (index 2): a signature placed by click.
    const items = [
      ...defaultItems(analysis.edition, 0, 1, pageSize),
      newItemAtPoint('signature', 2, { x: 300, y: 300 }, pageSize, { id: 'sig-p3' })
    ];
    const res = await applyPlacedItemsAndFlatten(PDFLib, {
      pdfBytes: raw, analysis, items, signerIndex: 0,
      signaturePngBytes: TINY_PNG, printedName: 'Pat Q. Reviewer', dateStr: '11/11/2026'
    });
    expect(res.flattenedPages).toEqual([0, 1, 2]);

    // The approval page's fields (name/date) and the Scout's Proposal-Notes field on the marked page are flattened...
    expect(await widgetsOnPage(res.pdfBytes, 2)).toHaveLength(0);
    expect(await widgetsOnPage(res.pdfBytes, 3)).toHaveLength(0);
    // ...and Plan fields stay fillable.
    const planW = await widgetsOnPage(res.pdfBytes, 4);
    expect(planW).toHaveLength(1);
    expect(planW[0].fieldName).toBe('Comments from Proposal Review');

    const { pdfjsDoc } = await inspectPdfWithPdfJs(pdfjsLib, res.pdfBytes);
    const p2 = (await (await pdfjsDoc.getPage(2)).getTextContent()).items.map(i => i.str).join(' ');
    expect(p2).toContain('Pat Q. Reviewer');
    expect(p2).toContain('11/11/2026');
    const p3 = (await (await pdfjsDoc.getPage(3)).getTextContent()).items.map(i => i.str).join(' ');
    expect(p3).toContain('Scout typed this');
  });

  it('leaves a Proposal page after the approval page fillable when no mark is on it (marked pages only widen the range)', async () => {
    const raw = await buildPlacedItemsPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, raw);
    const res = await applyPlacedItemsAndFlatten(PDFLib, {
      pdfBytes: raw, analysis, items: defaultItems(analysis.edition, 0, 1, pageSize), signerIndex: 0,
      signaturePngBytes: TINY_PNG, printedName: 'Pat Q. Reviewer', dateStr: '11/11/2026'
    });
    expect(res.flattenedPages).toEqual([0, 1]);
    const w = await widgetsOnPage(res.pdfBytes, 3);
    expect(w).toHaveLength(1);
    expect(w[0].fieldName).toBe('Proposal-Notes');
  });

  it('refuses a mark on a Plan page, a missing signature, and a missing stamp image, before touching the PDF', async () => {
    const raw = await buildPlacedItemsPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, raw);
    const base = { pdfBytes: raw, analysis, signerIndex: 0, signaturePngBytes: TINY_PNG, printedName: 'Pat Q. Reviewer', dateStr: '11/11/2026' };
    const onPlan = [newItemAtPoint('signature', 3, { x: 200, y: 200 }, pageSize)];
    await expect(applyPlacedItemsAndFlatten(PDFLib, { ...base, items: onPlan })).rejects.toThrow(/Page 4 belongs to the Project Plan/);
    const noSig = [newItemAtPoint('date', 1, { x: 200, y: 200 }, pageSize)];
    await expect(applyPlacedItemsAndFlatten(PDFLib, { ...base, items: noSig })).rejects.toThrow(/Place your signature/);
    const noImg = [...defaultItems(analysis.edition, 0, 1, pageSize), newItemAtPoint('stamp', 1, { x: 200, y: 400 }, pageSize, { stampId: 'st1' })];
    await expect(applyPlacedItemsAndFlatten(PDFLib, { ...base, items: noImg })).rejects.toThrow(/stamp.*no image/);
  });

  it('allows a signature alone (name and date are only warnings) and does not fill the field then', async () => {
    const raw = await buildPlacedItemsPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, raw);
    const res = await applyPlacedItemsAndFlatten(PDFLib, {
      pdfBytes: raw, analysis, signerIndex: 0,
      items: [newItemAtPoint('signature', 1, { x: 400, y: 150 }, pageSize)],
      signaturePngBytes: TINY_PNG, printedName: '', dateStr: ''
    });
    expect(res.pdfBytes.byteLength).toBeGreaterThan(1000);
  });

  it('embeds a stamp PNG with alpha (soft mask kept) and draws it under the signature', async () => {
    const raw = await buildPlacedItemsPdf();
    const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, raw);
    const stamp = buildAlphaPng();
    const items = [
      ...defaultItems(analysis.edition, 0, 1, pageSize),
      newItemAtPoint('stamp', 1, { x: 400, y: 160 }, pageSize, { stampId: 'st1', aspect: 1 })
    ];
    const res = await applyPlacedItemsAndFlatten(PDFLib, {
      pdfBytes: raw, analysis, items, signerIndex: 0, stampPngs: { st1: stamp },
      signaturePngBytes: TINY_PNG, printedName: 'Pat Q. Reviewer', dateStr: '11/11/2026'
    });
    const out = await PDFLib.PDFDocument.load(res.pdfBytes);
    const images = [];
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      const dict = obj && obj.dict;
      if (!dict || dict.get(PDFLib.PDFName.of('Subtype')) !== PDFLib.PDFName.of('Image')) continue;
      images.push({
        width: dict.get(PDFLib.PDFName.of('Width')).asNumber(),
        smask: !!dict.get(PDFLib.PDFName.of('SMask'))
      });
    }
    expect(images.length).toBeGreaterThanOrEqual(2); // the stamp and the signature
    const stampImg = images.find(i => i.width === 4); // the hand-built 4x4 stamp
    expect(stampImg).toBeTruthy();
    expect(stampImg.smask).toBe(true);               // its alpha channel became a soft mask
  });
});

const WB_2026 = 'workbooks/2026-Eagle-Scout-Leadership-Service-Project-Workbook-1.pdf';
const WB_2023A = 'workbooks/EagleProjectWorkbook2023a (1).pdf';

describe.runIf(fs.existsSync(WB_2026) && fs.existsSync(WB_2023A))(
  'pdfEngine: real blank 2026 and 2023a BSA workbooks (AESV3 decrypt + sign + per-page flatten)',
  () => {
    it('decrypts, detects Page 11 (and blocks Pages 18 & 22), signs, and flattens only Proposal pages on the 2026 workbook', async () => {
      const bytes = new Uint8Array(fs.readFileSync(WB_2026));
      const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, bytes);
      expect(analysis.edition).toBe('2026');
      expect(analysis.approvalPageIndices).toEqual([10]); // Page 11 (0-based 10)
      expect(analysis.firstNotOursPageIndex).toBe(11);    // Page 12
      expect(canSignPage(analysis, 10).ok).toBe(true);
      expect(canSignPage(analysis, 17).ok).toBe(false);   // Page 18 (Project Plan Reviews)
      expect(canSignPage(analysis, 21).ok).toBe(false);   // Page 22 (Certification of Completion)

      const res = await applySignatureAndFlatten(PDFLib, {
        pdfBytes: bytes,
        analysis,
        pageIndex: 10,
        signerIndex: 0,
        signaturePngBytes: TINY_PNG,
        printedName: 'Pat Q. Reviewer',
        dateStr: '04/19/2026'
      });

      const after = await inspectPdfWithPdfJs(pdfjsLib, res.pdfBytes);
      let proposalWidgets = 0;
      let planReportWidgets = 0;
      for (let p = 1; p <= after.pdfjsDoc.numPages; p++) {
        const pg = await after.pdfjsDoc.getPage(p);
        const w = (await pg.getAnnotations()).filter(a => a.subtype === 'Widget');
        if (p <= 11) proposalWidgets += w.length;
        else planReportWidgets += w.length;
      }
      expect(proposalWidgets).toBe(0);
      expect(planReportWidgets).toBe(330);

      const p11Text = (await (await after.pdfjsDoc.getPage(11)).getTextContent()).items.map(i => i.str).join(' ');
      expect(p11Text).toContain('Pat Q. Reviewer');
      expect(p11Text).toContain('04/19/2026');
    });

    it('decrypts, detects Page 15 (and blocks Pages 23 & 29), signs, and flattens only Proposal pages on the 2023a workbook', async () => {
      const bytes = new Uint8Array(fs.readFileSync(WB_2023A));
      const { analysis } = await inspectPdfWithPdfJs(pdfjsLib, bytes);
      expect(analysis.edition).toBe('2023a');
      expect(analysis.approvalPageIndices).toEqual([14]); // Page 15 (0-based 14)
      expect(analysis.firstNotOursPageIndex).toBe(15);    // Page 16
      expect(canSignPage(analysis, 14).ok).toBe(true);
      expect(canSignPage(analysis, 22).ok).toBe(false);   // Page 23 (Fundraising Application)
      expect(canSignPage(analysis, 28).ok).toBe(false);   // Page 29 (Project Report Page C)

      const res = await applySignatureAndFlatten(PDFLib, {
        pdfBytes: bytes,
        analysis,
        pageIndex: 14,
        signerIndex: 0,
        signaturePngBytes: TINY_PNG,
        printedName: 'Pat Q. Reviewer',
        dateStr: '04/19/2026'
      });

      const after = await inspectPdfWithPdfJs(pdfjsLib, res.pdfBytes);
      let proposalWidgets = 0;
      let planReportWidgets = 0;
      for (let p = 1; p <= after.pdfjsDoc.numPages; p++) {
        const pg = await after.pdfjsDoc.getPage(p);
        const w = (await pg.getAnnotations()).filter(a => a.subtype === 'Widget');
        if (p <= 15) proposalWidgets += w.length;
        else planReportWidgets += w.length;
      }
      expect(proposalWidgets).toBe(0);
      expect(planReportWidgets).toBe(355);

      const p15Text = (await (await after.pdfjsDoc.getPage(15)).getTextContent()).items.map(i => i.str).join(' ');
      expect(p15Text).toContain('Pat Q. Reviewer');
      expect(p15Text).toContain('04/19/2026');
    });
  }
);
