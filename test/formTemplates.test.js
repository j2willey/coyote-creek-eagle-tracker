import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../apps-script/src/lib/formTemplates.js');

describe('FormTemplates: which folder', () => {
  it('formTemplatesFolderId wins; the older stampsFolderId is the fallback; neither = ""', () => {
    expect(F.folderId({ formTemplatesFolderId: ' NEW ', stampsFolderId: 'OLD' })).toBe('NEW');
    expect(F.folderId({ formTemplatesFolderId: '', stampsFolderId: ' OLD ' })).toBe('OLD');
    expect(F.folderId({})).toBe('');
    expect(F.folderId(undefined)).toBe('');
  });
  it('Setup copies the old key across only when the new one is blank', () => {
    expect(F.needsCopy({ formTemplatesFolderId: '', stampsFolderId: 'OLD' })).toBe(true);
    expect(F.needsCopy({ formTemplatesFolderId: 'NEW', stampsFolderId: 'OLD' })).toBe(false);
    expect(F.needsCopy({ formTemplatesFolderId: '', stampsFolderId: '' })).toBe(false);
  });
});

describe('FormTemplates: the blank forms', () => {
  const files = [
    { id: 's', name: 'Stamp_transparent.png', mime: 'image/png', modified: 5 },
    { id: 'r1', name: 'Advancement Form 34403.pdf', mime: 'application/pdf', modified: 100 },
    { id: 'r2', name: 'advancement report (old).PDF', mime: 'application/pdf', modified: 50 },
    { id: 'a', name: 'Blank Eagle Application.pdf', mime: 'application/pdf', modified: 10 },
    { id: 'v', name: 'Verified Eagle Application (demo).pdf', mime: 'application/pdf', modified: 900 },
    { id: 'n', name: 'Advancement notes.docx', mime: 'application/msword', modified: 999 }
  ];
  it('the report is the newest PDF with 34403 or Advancement in its name (any case)', () => {
    expect(F.pickReport(files).id).toBe('r1');
    expect(F.pickReport(files.filter(f => f.id !== 'r1')).id).toBe('r2');
    expect(F.pickReport([{ id: 'x', name: '34403.pdf', modified: 1 }, { id: 'y', name: 'Form 34403 v2.pdf', modified: 2 }]).id).toBe('y');
    expect(F.pickReport([files[0], files[5]])).toBeNull();
  });
  it('the Eagle Application has "Eagle Application" and not "Verified"; a Verified copy never counts', () => {
    expect(F.pickApplication(files).id).toBe('a');
    expect(F.pickApplication([files[4]])).toBeNull();
    expect(F.pickApplication([])).toBeNull();
    expect(F.pickApplication(undefined)).toBeNull();
  });
});
