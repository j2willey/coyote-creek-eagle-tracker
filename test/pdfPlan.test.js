import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  planFolderFiles,
  roleLabel,
  fetchProblem,
  MAX_BYTES,
  detectNotOursSection,
  isProposalApprovalLandmark,
  analyzeWorkbookPages,
  describeTargetPage,
  SCRIPT_FONTS,
  fitTextFontSize,
  SIG_SCALE_MIN,
  SIG_SCALE_MAX,
  TEXT_FONT_MIN_PT,
  TEXT_FONT_MAX_PT,
  fitSignatureDimensions,
  resizeBoxInPage,
  defaultSignPlacement,
  canPlaceOnPage,
  approvalBanner,
  approvalBannerIsInfo,
  defaultItemSize,
  clampItemToPage,
  newItemAtPoint,
  hitTestItems,
  defaultItem,
  defaultItems,
  flattenPageIndices,
  capImageSize,
  isProposalPageHText,
  checkPlacement,
  hasTransparentPixel,
  describePageRanges,
  STAMP_DEFAULT_WIDTH_PT,
  SIGNATURE_BASE_WIDTH_PT,
  normalizeRotation,
  viewerSizeOf,
  viewerToUserPoint,
  userToViewerPoint,
  viewerRectToUser,
  userRectToViewer,
  markDrawSpec,
  textDrawSpec,
  inkBoundingBox,
  resizeImageBoxInPage,
  setImageItemWidth
} from '../web/js/pdfPlan.js';

describe('pdfPlan: classifyFile', () => {
  it('classifies signed copies, ESSPP versions, photos, slides, signatures, and odd files', () => {
    expect(classifyFile('Pat_Q-T999_ESSPP-ApprovedAndSignedBy-AB&CD.pdf')).toEqual({
      role: 'signed', version: 0, isPdf: true, isImage: false
    });
    expect(classifyFile('Pat_Q-T999_ESSPP-V3.pdf')).toEqual({
      role: 'esspp', version: 3, isPdf: true, isImage: false
    });
    expect(classifyFile('Pat_Q-T999_Photo-V2.jpg')).toEqual({
      role: 'photo', version: 2, isPdf: false, isImage: true
    });
    expect(classifyFile('Pat_Q-T999_Photo-V1.heic')).toEqual({
      role: 'photo', version: 1, isPdf: false, isImage: true
    });
    expect(classifyFile('Pat_Q-T999_Signatures-V1.pdf')).toEqual({
      role: 'signatures', version: 1, isPdf: true, isImage: false
    });
    expect(classifyFile('Pat_Q-T999_Slides-V1.pptx')).toEqual({
      role: 'slides', version: 1, isPdf: false, isImage: false
    });
    expect(classifyFile('before-yard.png')).toEqual({
      role: 'photo', version: 0, isPdf: false, isImage: true
    });
    expect(classifyFile('Draft proposal.pdf')).toEqual({
      role: 'other', version: 0, isPdf: true, isImage: false
    });
  });
});

describe('pdfPlan: planFolderFiles', () => {
  const sample = [
    { id: 'f-photo2', name: 'Pat_Q-T999_Photo-V2.jpg', bytes: 250000, date: '11/2/2026' },
    { id: 'f-v1', name: 'Pat_Q-T999_ESSPP-V1.pdf', bytes: 900000, date: '11/1/2026' },
    { id: 'f-photo1', name: 'Pat_Q-T999_Photo-V1.jpg', bytes: 200000, date: '11/1/2026' },
    { id: 'f-v2', name: 'Pat_Q-T999_ESSPP-V2.pdf', bytes: 1200000, date: '11/3/2026' },
    { id: 'f-sig', name: 'Pat_Q-T999_Signatures-V1.pdf', bytes: 150000, date: '11/3/2026' }
  ];

  it('orders files by role, newest ESSPP first, and marks the latest ESSPP as primary during review', () => {
    const out = planFolderFiles(sample, { signing: false });
    expect(out.map(x => x.id)).toEqual(['f-v2', 'f-v1', 'f-sig', 'f-photo1', 'f-photo2']);
    expect(out.filter(x => x.primary).map(x => x.id)).toEqual(['f-v2']);
  });

  it('marks the signed copy as primary when signatures are in progress', () => {
    const withSigned = [
      ...sample,
      { id: 'f-signed', name: 'Pat_Q-T999_ESSPP-ApprovedAndSignedBy-AB.pdf', bytes: 1300000, date: '11/8/2026' }
    ];
    const out = planFolderFiles(withSigned, { signing: true });
    expect(out[0].id).toBe('f-signed');
    expect(out.filter(x => x.primary).map(x => x.id)).toEqual(['f-signed']);
  });

  it('falls back to a non-standard PDF when no ESSPP or signed copy exists', () => {
    const odd = [
      { id: 'p1', name: 'site.jpg', bytes: 1000 },
      { id: 'd1', name: 'Proposal from 2025.pdf', bytes: 5000 }
    ];
    const out = planFolderFiles(odd);
    expect(out.find(x => x.primary)?.id).toBe('d1');
  });

  it('ignores empty entries and handles empty lists', () => {
    expect(planFolderFiles([])).toEqual([]);
    expect(planFolderFiles([{ id: '', name: 'x.pdf' }, { id: '1', name: '' }])).toEqual([]);
  });
});

describe('pdfPlan: roleLabel and fetchProblem', () => {
  it('labels roles clearly', () => {
    expect(roleLabel({ role: 'signed', version: 0 })).toBe('Signed copy');
    expect(roleLabel({ role: 'esspp', version: 3 })).toBe('Proposal V3');
    expect(roleLabel({ role: 'signatures', version: 1 })).toBe('Signatures V1');
    expect(roleLabel({ role: 'photo', version: 2 })).toBe('Photo V2');
    expect(roleLabel({ role: 'photo', version: 0 })).toBe('Photo');
    expect(roleLabel({ role: 'other', version: 0 })).toBe('File');
  });

  it('allows files up to the 20 MB limit and explains when a file is over it', () => {
    expect(fetchProblem({ name: 'ok.pdf', bytes: MAX_BYTES })).toBe('');
    expect(fetchProblem({ name: 'huge.pdf', bytes: MAX_BYTES + 1024 * 1024 })).toMatch(/21\.0 MB.*over the 20 MB limit/);
  });
});

describe('pdfPlan: Step 2 Our vs. Not-Ours page landmarks and hard ordering rule', () => {
  it('identifies 2026 Page 11 and 2023a Proposal Page H as our Proposal Approval pages', () => {
    expect(isProposalApprovalLandmark('11 Proposal Approval ... Council or District Approval', [])).toBe(true);
    expect(isProposalApprovalLandmark('', ['District or Council Approval Name'])).toBe(true);
    expect(isProposalApprovalLandmark('Candidate s Promise ... &ouncil or \'istrict $pproval ... 3roposal 3age H', [])).toBe(true);
    expect(isProposalApprovalLandmark('', ['Proposal-BSAName'])).toBe(true);
  });

  it('identifies Project Plan, Fundraising Application, and Project Report pages as Not-Ours and never treats them as approval pages', () => {
    expect(detectNotOursSection('18 Project Plan Reviews Input from Beneficiary Input from Scoutmaster', [])).toMatch(/Project Plan/);
    expect(detectNotOursSection('22 Certification of Completion ACCEPTANCE OF THE WORK', [])).toMatch(/Project Report/);
    expect(detectNotOursSection('Fundraising Application Page A', ['FundApp-telephone'])).toMatch(/Fundraising/);
    expect(detectNotOursSection('Project 5eport Page C', ['Report-Funding'])).toMatch(/Project Report/);
    expect(isProposalApprovalLandmark('22 Certification of Completion', ['Certification of Completion Signature'])).toBe(false);
  });

  it('enforces the hard ordering rule: approval pages are found before the first Not-Ours landmark and no mark may go on or after it', () => {
    const pages = [
      { text: 'Proposal cover', fields: ['Candidates Full Name'] },
      { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] },
      { text: '11 Proposal Approval Council or District Approval (second copy)', fields: ['District or Council Approval Name'] },
      { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] },
      { text: '18 Project Plan Reviews Input from Beneficiary Input from Scoutmaster', fields: ['Candidate’s Promise Date'] },
      { text: '22 Certification of Completion ACCEPTANCE OF THE WORK', fields: ['Certification of Completion Signature'] },
      // An ordinary page after the Plan pages is not locked itself, but asks for a confirm:
      { text: 'Some extra page', fields: [] }
    ];
    const analysis = analyzeWorkbookPages(pages);
    expect(analysis.edition).toBe('2026');
    expect(analysis.firstNotOursPageIndex).toBe(3);
    expect(analysis.approvalPageIndices).toEqual([1, 2]);
    // When multiple Proposal Approval pages exist, defaultTargetPageIndex targets the LAST one (index 2).
    expect(analysis.defaultTargetPageIndex).toBe(2);
    // Supporting pages go before the FIRST approval page (index 1); flattening ends at the LAST approval page (index 2).
    expect(analysis.insertBeforePageIndex).toBe(1);
    expect(analysis.proposalEndPageIndex).toBe(2);

    expect(canPlaceOnPage(analysis, 1).ok).toBe(true);
    expect(canPlaceOnPage(analysis, 2).ok).toBe(true);
    expect(canPlaceOnPage(analysis, 0).ok).toBe(true);  // v2: the member decides where marks go among Proposal pages
    expect(canPlaceOnPage(analysis, 3).ok).toBe(false); // Project Plan
    expect(canPlaceOnPage(analysis, 4).ok).toBe(false); // Project Plan Reviews
    expect(canPlaceOnPage(analysis, 5).ok).toBe(false); // Certification of Completion
    // Per page, not "everything after": an unidentified page after the Plan is allowed, with a one-time confirm
    expect(canPlaceOnPage(analysis, 6).ok).toBe(true);
    expect(canPlaceOnPage(analysis, 6).confirm).toBe('Page 6 looks like Project Report (it may be a blank template page left in). Place on page 7 anyway?');
    expect(canPlaceOnPage(analysis, 0).confirm).toBe('');
  });

  it('targets the last approval page by default and formats clear multi-approval-page descriptions', () => {
    const pages = Array.from({ length: 34 }, (_, idx) => {
      if (idx === 10 || idx === 11 || idx === 16) {
        return { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] };
      }
      if (idx >= 17) {
        return { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] };
      }
      return { text: 'Proposal page', fields: ['Candidates Full Name'] };
    });
    const analysis = analyzeWorkbookPages(pages);
    expect(analysis.approvalPageIndices).toEqual([10, 11, 16]);
    expect(analysis.defaultTargetPageIndex).toBe(16);
    expect(describeTargetPage(analysis, 16)).toBe('Page 17 of 34, the last of 3 approval pages');
    expect(describeTargetPage(analysis, 10)).toBe('Page 11 of 34, the 1st of 3 approval pages');
    expect(describeTargetPage(analysis, 11)).toBe('Page 12 of 34, approval page 2 of 3');
  });
});

describe('pdfPlan: SCRIPT_FONTS, sizing, and corner resize helpers', () => {
  it('defines 10 OFL Google Fonts with unique keys and families', () => {
    expect(SCRIPT_FONTS).toHaveLength(10);
    const keys = new Set(SCRIPT_FONTS.map(f => f.key));
    const families = new Set(SCRIPT_FONTS.map(f => f.family));
    expect(keys.size).toBe(10);
    expect(families.size).toBe(10);
    expect(families.has('Dancing Script')).toBe(true);
    expect(families.has('Great Vibes')).toBe(true);
    expect(families.has('Caveat')).toBe(true);
  });

  it('computes auto-fit or explicit font sizes and scales signature dimensions', () => {
    // Explicit font size clamps to the UI range [7, 16]
    expect(fitTextFontSize('Teddy Sample', 197, 19, 12)).toBe(12);
    expect(fitTextFontSize('Teddy Sample', 197, 19, 4)).toBe(TEXT_FONT_MIN_PT);
    expect(fitTextFontSize('Teddy Sample', 197, 19, 40)).toBe(TEXT_FONT_MAX_PT);
    // Auto-fit (requestedFontSize = 0) fits within box height and width
    const autoShort = fitTextFontSize('Teddy Sample', 197, 19, 0);
    const autoLong = fitTextFontSize('Teddy Sample — District Advancement Committee Chair', 100, 19, 0);
    expect(autoShort).toBeGreaterThan(autoLong);

    const box = { x: 346, y: 129, width: 114, height: 23 };
    const fit100 = fitSignatureDimensions(400, 100, box, 1);
    const fit125 = fitSignatureDimensions(400, 100, box, 1.25);
    expect(fit100.width).toBeCloseTo(92, 1);
    expect(fit100.height).toBeCloseTo(23, 1);
    expect(fit125.width).toBeCloseTo(fit100.width * 1.25, 1);
    expect(fit125.height).toBeCloseTo(fit100.height * 1.25, 1);
    // Scale clamps to the UI range [0.5, 1.4]; above 1.0 the image extends past its box, centered
    expect([SIG_SCALE_MIN, SIG_SCALE_MAX, TEXT_FONT_MIN_PT, TEXT_FONT_MAX_PT]).toEqual([0.5, 1.4, 7, 16]);
    expect(fitSignatureDimensions(400, 100, box, 0.1).width).toBeCloseTo(fit100.width * 0.5, 1);
    const big = fitSignatureDimensions(400, 100, box, 9);
    expect(big.width).toBeCloseTo(fit100.width * 1.4, 1);
    expect(big.x).toBeLessThan(box.x);
    expect(big.x + big.width / 2).toBeCloseTo(box.x + box.width / 2, 1);
  });

  it('resizes a placement box from its bottom-right corner while anchoring the top-left corner', () => {
    const orig = { x: 346, y: 129, width: 114, height: 23, fontSize: 10, fieldName: '' };
    const topBefore = orig.y + orig.height; // 152
    const resized = resizeBoxInPage(orig, 30, 10, { width: 612, height: 792 });
    expect(resized.x).toBe(346);
    expect(resized.width).toBe(144);
    expect(resized.height).toBe(33);
    // Top edge stays anchored at y + height = 152
    expect(resized.y + resized.height).toBe(topBefore);
  });
});

describe('pdfPlan: Step 2 defaultSignPlacement for Signer 1 and Signer 2', () => {
  it('places Signer 2 cleanly below Signer 1 without binding to Signer 1 AcroForm fields', () => {
    const s1_2026 = defaultSignPlacement('2026', 0);
    const s2_2026 = defaultSignPlacement('2026', 1);
    expect(s1_2026.printedName.fieldName).toBe('District or Council Approval Name');
    expect(s1_2026.date.fieldName).toBe('District or Council Signature Date');
    expect(s2_2026.printedName.fieldName).toBe('');
    expect(s2_2026.date.fieldName).toBe('');
    expect(s2_2026.signature.y).toBeLessThan(s1_2026.printedName.y);

    const s1_2023 = defaultSignPlacement('2023a', 0);
    const s2_2023 = defaultSignPlacement('2023a', 1);
    expect(s1_2023.printedName.fieldName).toBe('Proposal-BSAName');
    expect(s2_2023.printedName.fieldName).toBe('');
    expect(s2_2023.signature.y).toBeLessThan(s1_2023.printedName.y);
  });
});

describe('pdfPlan: Task 9a, no silent fallback to an ordinary Proposal page', () => {
  const proposal = { text: 'Proposal page', fields: ['Proposal-Title'] };
  const scan = { text: '', fields: [] };
  const planPage = { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] };
  const approval = { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] };

  it('has NO default target when there is no approval page and no scan: never the last Proposal page', () => {
    const a = analyzeWorkbookPages([proposal, proposal, proposal, planPage]);
    expect(a.approvalPageIndices).toEqual([]);
    expect(a.scanCandidatePageIndices).toEqual([]);
    expect(a.defaultTargetPageIndex).toBe(-1);
    expect(describeTargetPage(a, a.defaultTargetPageIndex)).toBe('no page chosen yet');
    expect(approvalBanner(a)).toBe("Couldn't find the Proposal Approval page (Page H): scroll to it.");
    expect(approvalBannerIsInfo(a)).toBe(false);
  });

  it('treats image-only pages anywhere (also after Plan pages) as candidates and defaults to the last one', () => {
    const a = analyzeWorkbookPages([proposal, scan, proposal, scan, planPage, scan]);
    expect(a.scanCandidatePageIndices).toEqual([1, 3, 5]);
    expect(a.defaultTargetPageIndex).toBe(5);
    expect(a.pages[5].scanCandidate).toBe(true);
    expect(a.pages[4].scanCandidate).toBe(false); // a Plan page is never a candidate
    expect(describeTargetPage(a, 3)).toBe('Page 4 of 6 (a scanned page)');
    expect(approvalBanner(a)).toBe('Pages 2, 4, 6 look like scanned signature pages (the last one is opened).');
    expect(approvalBannerIsInfo(a)).toBe(true);
  });

  it('prefers the last approval page over scans, and gives no banner when one was found', () => {
    const a = analyzeWorkbookPages([proposal, approval, scan, approval, scan, planPage]);
    expect(a.approvalPageIndices).toEqual([1, 3]);
    expect(a.defaultTargetPageIndex).toBe(3);
    expect(approvalBanner(a)).toBe('');
  });

  it('names the page 11 of the 2026 edition in the banner', () => {
    const a = analyzeWorkbookPages([{ text: 'No. 512 - 927 October 2026', fields: [] }, proposal, planPage]);
    expect(a.edition).toBe('2026');
    expect(approvalBanner(a)).toMatch(/\(Page 11\)/);
  });

  it('keeps the Plan / Report guardrail a hard block for every page identified as one, approval page or not', () => {
    const a = analyzeWorkbookPages([proposal, approval, scan, planPage, scan]);
    expect(canPlaceOnPage(a, 0).ok).toBe(true);   // any ordinary Proposal page may take a mark
    expect(canPlaceOnPage(a, 2).ok).toBe(true);   // a scan
    expect(canPlaceOnPage(a, 3).ok).toBe(false);  // Project Plan
    expect(canPlaceOnPage(a, 3).reason).toMatch(/Page 4 belongs to the Project Plan/);
    expect(a.pages[4].scanCandidate).toBe(true);  // image-only page after the Plan: a signature-page candidate
    expect(canPlaceOnPage(a, 4)).toEqual({ ok: true, reason: '', confirm: '' }); // no confirm on a candidate
    const withText = analyzeWorkbookPages([proposal, approval, planPage, { text: 'Extra notes', fields: [] }]);
    expect(canPlaceOnPage(withText, 3).ok).toBe(true); // ordinary page after the Plan: allowed, but with a confirm
    expect(canPlaceOnPage(withText, 3).confirm).toMatch(/looks like Project Plan.*Place on page 4 anyway/);
    expect(canPlaceOnPage(a, 99).ok).toBe(false);
  });
});

describe('pdfPlan: Task 9b, placed items', () => {
  const page = { width: 612, height: 792 };

  it('sizes each kind, keeping a stamp\'s aspect ratio at 1.6 in wide', () => {
    expect(defaultItemSize('signature').width).toBeGreaterThan(defaultItemSize('date').width);
    const st = defaultItemSize('stamp', 2);
    expect(st.width).toBe(STAMP_DEFAULT_WIDTH_PT);
    expect(st.height).toBeCloseTo(STAMP_DEFAULT_WIDTH_PT / 2, 1);
    expect(defaultItemSize('stamp').height).toBe(STAMP_DEFAULT_WIDTH_PT);
  });

  it('drops an item centered on the click and clamps it to the page', () => {
    const it = newItemAtPoint('signature', 4, { x: 300, y: 400 }, page, { id: 's1' });
    expect(it).toMatchObject({ id: 's1', kind: 'signature', pageIndex: 4 });
    expect(it.x + it.width / 2).toBeCloseTo(300, 0);
    expect(it.y + it.height / 2).toBeCloseTo(400, 0);
    const corner = newItemAtPoint('date', 0, { x: 2, y: 3 }, page);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    const far = newItemAtPoint('name', 0, { x: 9999, y: 9999 }, page);
    expect(far.x + far.width).toBeLessThanOrEqual(612);
    expect(far.y + far.height).toBeLessThanOrEqual(792);
    expect(newItemAtPoint('stamp', 1, { x: 100, y: 100 }, page, { stampId: 'st1', aspect: 1 }).stampId).toBe('st1');
  });

  it('shrinks an item bigger than the page and keeps a normal one where it is', () => {
    expect(clampItemToPage({ x: -5, y: 10, width: 700, height: 20 }, page)).toMatchObject({ x: 0, width: 612 });
    expect(clampItemToPage({ x: 50, y: 60, width: 70, height: 20 }, page)).toMatchObject({ x: 50, y: 60 });
  });

  it('hit-tests the topmost item on the right page only', () => {
    const a = { id: 'a', kind: 'stamp', pageIndex: 2, x: 100, y: 100, width: 100, height: 100 };
    const b = { id: 'b', kind: 'signature', pageIndex: 2, x: 150, y: 150, width: 100, height: 40 };
    const c = { id: 'c', kind: 'date', pageIndex: 3, x: 100, y: 100, width: 50, height: 14 };
    expect(hitTestItems([a, b, c], 2, { x: 160, y: 160 })?.id).toBe('b');
    expect(hitTestItems([a, b, c], 2, { x: 110, y: 110 })?.id).toBe('a');
    expect(hitTestItems([a, b, c], 2, { x: 500, y: 500 })).toBeNull();
    expect(hitTestItems([a, b, c], 3, { x: 110, y: 105 })?.id).toBe('c');
  });

  it('starts from the workbook\'s own boxes (signer index as before); a stamp has none', () => {
    const def = defaultSignPlacement('2026', 0, page);
    const sig = defaultItem('signature', '2026', 0, 10, page);
    expect(sig).toMatchObject({ kind: 'signature', pageIndex: 10, x: def.signature.x, y: def.signature.y, width: def.signature.width });
    expect(defaultItem('stamp', '2026', 0, 10, page)).toBeNull();
    const second = defaultItems('2026', 1, 10, page);
    expect(second.map(i => i.kind)).toEqual(['signature', 'name', 'date']);
    expect(second[0].y).toBeLessThan(sig.y);
  });

  it('requires a signature; a missing name or date only warns; forbidden pages are errors', () => {
    const analysis = analyzeWorkbookPages([
      { text: 'Proposal page', fields: ['Candidates Full Name'] },
      { text: '', fields: [] },
      { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] }
    ]);
    const sigOnly = [newItemAtPoint('signature', 1, { x: 200, y: 200 }, page)];
    const ok = { signaturePresent: true, printedName: 'Pat Q. Reviewer', dateStr: '11/11/2026' };
    expect(checkPlacement(analysis, sigOnly, ok)).toEqual({
      errors: [],
      warnings: ['No printed name placed.', 'No date placed.']
    });
    expect(checkPlacement(analysis, [], ok).errors[0]).toMatch(/Place your signature/);
    expect(checkPlacement(analysis, [newItemAtPoint('date', 1, { x: 9, y: 9 }, page)], ok).errors[0]).toMatch(/Place your signature/);
    expect(checkPlacement(analysis, sigOnly, { ...ok, signaturePresent: false }).errors[0]).toMatch(/Create or select your signature/);
    const withName = [...sigOnly, newItemAtPoint('name', 1, { x: 200, y: 100 }, page)];
    expect(checkPlacement(analysis, withName, { ...ok, printedName: ' ' }).errors[0]).toMatch(/printed name/);
    const bad = [...sigOnly, newItemAtPoint('signature', 2, { x: 200, y: 200 }, page)];
    expect(checkPlacement(analysis, bad, ok).errors.join(' ')).toMatch(/Page 3 belongs to the Project Plan/);
  });
});

describe('pdfPlan: Task 9.1, flatten range = marked pages (+ earlier Proposal pages on request)', () => {
  const proposal = { text: 'Proposal page', fields: ['Candidates Full Name'] };
  const approval = { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] };
  const planPage = { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] };
  const mk = (pageIndex) => ({ id: 'x' + pageIndex, kind: 'signature', pageIndex, x: 10, y: 10, width: 50, height: 20 });

  it('by default is only the marked page(s)', () => {
    const a = analyzeWorkbookPages([proposal, proposal, approval, planPage, planPage]);
    expect(flattenPageIndices(a, [mk(2)])).toEqual([2]);
    expect(flattenPageIndices(a, [mk(2), mk(1)])).toEqual([1, 2]);
    expect(flattenPageIndices(a, [])).toEqual([]);
  });

  it('with includeEarlier adds the Proposal pages before the first marked page, not the ones after it', () => {
    const a = analyzeWorkbookPages([proposal, approval, proposal, { text: '', fields: [] }, planPage]);
    expect(flattenPageIndices(a, [mk(1)], { includeEarlier: true })).toEqual([0, 1]);
    expect(flattenPageIndices(a, [mk(1), mk(3)], { includeEarlier: true })).toEqual([0, 1, 3]);
  });

  it('never includes a page identified as Plan / Report, even earlier than the signature page (Plan before Page H)', () => {
    const a = analyzeWorkbookPages([proposal, proposal, planPage, approval, planPage]);
    expect(flattenPageIndices(a, [mk(3)], { includeEarlier: true })).toEqual([0, 1, 3]);
    // a mark on a locked page is ignored by the range (the guardrail rejects it separately)
    expect(flattenPageIndices(a, [mk(3), mk(2), mk(4)])).toEqual([3]);
  });
});

describe('pdfPlan: Task 9.1, Proposal Page H after Plan Page A (2023a, instruction pages removed)', () => {
  // Fictional descriptor fixture reproducing the pattern: pages 0-7 ordinary Proposal pages, Plan Page A at index 8,
  // Proposal Page H at index 9 carrying a Candidate's Promise date field, then Plan / Report pages.
  const ord = (i) => ({ text: `Eagle Scout Service Project Workbook Proposal Page ${'ABCDEFG'[i % 7]}`, fields: ['Proposal-Notes' + i] });
  const pages = [
    ...Array.from({ length: 8 }, (_, i) => ord(i)),
    { text: 'Project Plan Page A Planned start date', fields: ['Plan-Summary'] },
    { text: 'Proposal Page H Council or District Approval Candidate’s Promise', fields: ['Proposal-BSAName', 'Candidate’s Promise Date'] },
    { text: 'Project Plan Reviews Input from Beneficiary Input from Scoutmaster', fields: ['Input from Beneficiary'] },
    { text: 'Project Report Page A', fields: ['Report-Hours'] }
  ];

  it('finds Page H as the approval page at 9, default target 9, page 9 placeable, Plan page 8 locked', () => {
    const a = analyzeWorkbookPages(pages);
    expect(a.edition).toBe('2023a');
    expect(a.approvalPageIndices).toEqual([9]);
    expect(a.defaultTargetPageIndex).toBe(9);
    expect(a.firstNotOursPageIndex).toBe(8);
    expect(a.pages[9].role).toBe('approval');
    expect(a.pages[9].forbidden).toBe(false);
    expect(canPlaceOnPage(a, 9)).toEqual({ ok: true, reason: '', confirm: '' });
    expect(canPlaceOnPage(a, 8).ok).toBe(false);
    expect(canPlaceOnPage(a, 8).reason).toMatch(/Page 9 belongs to the Project Plan/);
    expect(canPlaceOnPage(a, 10).ok).toBe(false);
    expect(canPlaceOnPage(a, 11).ok).toBe(false);
    expect(canPlaceOnPage(a, 0).ok).toBe(true);
    expect(approvalBanner(a)).toBe('');
  });

  it('wins even with only the footer text and the Candidate’s Promise date field (subset-font glyphs too)', () => {
    expect(isProposalApprovalLandmark('Proposal Page H', ['Candidate’s Promise Date'])).toBe(true);
    expect(detectNotOursSection('Proposal Page H', ['Candidate’s Promise Date'])).toBe('');
    expect(detectNotOursSection('3roposal 3age H', ["Candidate's Promise Date"])).toBe('');
    expect(isProposalApprovalLandmark('&ouncil or \'istrict $pproval ... &andidate s 3romise', ['Candidate’s Promise Date'])).toBe(true);
  });

  it('does not let a Candidate’s Promise date field alone make a page Project Plan (Plan Reviews)', () => {
    expect(detectNotOursSection('some page', ['Candidate’s Promise Date'])).toBe('');
    expect(detectNotOursSection("some page", ["Candidate's Promise Date"])).toBe('');
    // the Plan Reviews landmarks still do
    expect(detectNotOursSection('Project Plan Reviews', ['Candidate’s Promise Date'])).toMatch(/Plan Reviews/);
    expect(detectNotOursSection('x', ['Input from Beneficiary', 'Candidate’s Promise Date'])).toMatch(/Plan Reviews/);
  });

  it('has the confirm only on non-approval pages after a locked page', () => {
    const a = analyzeWorkbookPages([...pages, { text: 'Extra notes', fields: [] }]);
    expect(canPlaceOnPage(a, 12).ok).toBe(true);
    expect(canPlaceOnPage(a, 12).confirm).toMatch(/^Page \d+ looks like Project .*Place on page 13 anyway\?$/);
    expect(canPlaceOnPage(a, 9).confirm).toBe('');
  });
});

describe('pdfPlan: Task 9.1, image size on placement', () => {
  const page = { width: 612, height: 792 };
  it('places a stamp 115 pt wide (1.6 in) keeping its aspect, centered on the click', () => {
    expect(STAMP_DEFAULT_WIDTH_PT).toBe(115);
    const it = newItemAtPoint('stamp', 0, { x: 300, y: 400 }, page, { stampId: 's', aspect: 2.5 });
    expect(it.width).toBe(115);
    expect(it.height).toBeCloseTo(46, 1);
    expect(it.x + it.width / 2).toBeCloseTo(300, 1);
    expect(it.y + it.height / 2).toBeCloseTo(400, 1);
  });
  it('caps an image at 40% of the page width (aspect kept) on a small page, but not text marks', () => {
    const small = { width: 200, height: 260 };
    const st = newItemAtPoint('stamp', 0, { x: 100, y: 130 }, small, { stampId: 's', aspect: 2 });
    expect(st.width).toBe(80);
    expect(st.height).toBe(40);
    expect(newItemAtPoint('signature', 0, { x: 100, y: 130 }, small).width).toBe(80);
    expect(newItemAtPoint('name', 0, { x: 100, y: 130 }, small).width).toBe(170);
    expect(capImageSize('stamp', { width: 100, height: 50 }, page)).toEqual({ width: 100, height: 50 });
  });
});

describe('pdfPlan: Task 9.2, a scanned signature page after a blank Plan page', () => {
  // Fictional descriptor fixture of the pattern: Proposal pages 0-7, a blank Plan Page A left in at 8, the signed Page H
  // as a text-less scan at 9, then slides (text) at 10-25.
  const pages = [
    ...Array.from({ length: 8 }, (_, i) => ({ text: `Workbook Proposal Page ${'ABCDEFG'[i % 7]}`, fields: ['Proposal-Notes' + i] })),
    { text: 'Comments from Your Proposal Review Project Plan Page A', fields: [] },
    { text: '', fields: [] },
    ...Array.from({ length: 16 }, (_, i) => ({ text: `Slide ${i + 1} Project overview`, fields: [] }))
  ];

  it('offers the scan as the default target, with an info line instead of the "Couldn\'t find" banner', () => {
    const a = analyzeWorkbookPages(pages);
    expect(a.approvalPageIndices).toEqual([]);
    expect(a.pages[8].forbidden).toBe(true);
    expect(a.pages[8].lockedLabel).toBe('Project Plan Page A');
    expect(a.scanCandidatePageIndices).toEqual([9]);
    expect(a.defaultTargetPageIndex).toBe(9);
    expect(approvalBanner(a)).toBe('Page 10 looks like a scanned signature page.');
    expect(approvalBannerIsInfo(a)).toBe(true);
  });

  it('asks no confirm on the scan, and names the triggering page on an ordinary page after it', () => {
    const a = analyzeWorkbookPages(pages);
    expect(canPlaceOnPage(a, 9)).toEqual({ ok: true, reason: '', confirm: '' });
    expect(canPlaceOnPage(a, 11).confirm).toBe('Page 9 looks like Project Plan Page A (it may be a blank template page left in). Place on page 12 anyway?');
    expect(canPlaceOnPage(a, 3).confirm).toBe(''); // before the Plan page
    expect(canPlaceOnPage(a, 8).ok).toBe(false);
  });

  it('prefers a detected approval page over a scan', () => {
    const a = analyzeWorkbookPages([...pages.slice(0, 8), { text: 'Proposal Page H Council or District Approval Candidate’s Promise', fields: [] }, ...pages.slice(8)]);
    expect(a.approvalPageIndices).toEqual([8]);
    expect(a.defaultTargetPageIndex).toBe(8);
    expect(approvalBanner(a)).toBe('');
  });
});

describe('pdfPlan: Task 9.2, rotated pages (viewer <-> PDF user space)', () => {
  const W = 792, H = 612; // unrotated page (landscape scan); viewer is 612 x 792 at 90 / 270
  it('normalizes /Rotate and swaps the viewer size at 90 / 270', () => {
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(undefined)).toBe(0);
    expect(viewerSizeOf({ width: W, height: H }, 90)).toEqual({ width: 612, height: 792 });
    expect(viewerSizeOf({ width: W, height: H }, 270)).toEqual({ width: 612, height: 792 });
    expect(viewerSizeOf({ width: W, height: H }, 180)).toEqual({ width: 792, height: 612 });
  });

  it('maps a user-space point to the viewer for 0 / 90 / 180 / 270 (hand-computed)', () => {
    const u = { x: 100, y: 50 };
    const size = { width: W, height: H };
    expect(userToViewerPoint(u, size, 0)).toEqual({ x: 100, y: 50 });
    expect(userToViewerPoint(u, size, 90)).toEqual({ x: 50, y: 692 });
    expect(userToViewerPoint(u, size, 180)).toEqual({ x: 692, y: 562 });
    expect(userToViewerPoint(u, size, 270)).toEqual({ x: 562, y: 100 });
  });

  it('round-trips viewer <-> user for every rotation, also with a crop-box origin', () => {
    const size = { width: W, height: H };
    for (const rot of [0, 90, 180, 270]) {
      for (const origin of [{ x: 0, y: 0 }, { x: 12, y: 7 }]) {
        const vs = viewerSizeOf(size, rot);
        for (const v of [{ x: 0, y: 0 }, { x: 33.5, y: 410 }, { x: vs.width, y: vs.height }]) {
          const u = viewerToUserPoint(v, size, rot, origin);
          const back = userToViewerPoint(u, size, rot, origin);
          expect(back.x).toBeCloseTo(v.x, 9);
          expect(back.y).toBeCloseTo(v.y, 9);
        }
      }
    }
  });

  it('turns a viewer rectangle into the user-space rectangle it covers (width and height swap at 90 / 270)', () => {
    const size = { width: W, height: H };
    const r = { x: 50, y: 100, width: 200, height: 30 };
    expect(viewerRectToUser(r, size, 0)).toEqual(r);
    expect(viewerRectToUser(r, size, 90)).toEqual({ x: 662, y: 50, width: 30, height: 200 });
    expect(viewerRectToUser(r, size, 270)).toEqual({ x: 100, y: 362, width: 30, height: 200 });
    expect(viewerRectToUser(r, size, 180)).toEqual({ x: 542, y: 482, width: 200, height: 30 });
    // and back
    for (const rot of [0, 90, 180, 270]) {
      const back = userRectToViewer(viewerRectToUser(r, size, rot), size, rot);
      expect(back).toEqual(r);
    }
  });

  it('gives the draw anchor (user point of the viewer bottom-left corner) and the counter-clockwise angle', () => {
    const size = { width: W, height: H };
    const r = { x: 50, y: 100, width: 200, height: 30 };
    expect(markDrawSpec(r, size, 0)).toEqual({ x: 50, y: 100, angle: 0, width: 200, height: 30 });
    expect(markDrawSpec(r, size, 90)).toEqual({ x: 692, y: 50, angle: 90, width: 200, height: 30 });
    expect(markDrawSpec(r, size, 180)).toEqual({ x: 742, y: 512, angle: 180, width: 200, height: 30 });
    expect(markDrawSpec(r, size, 270)).toEqual({ x: 100, y: 562, angle: 270, width: 200, height: 30 });
    // text: baseline start 2 right and 8 up of the box corner, measured in the viewer
    expect(textDrawSpec(r, { dx: 2, dy: 8 }, size, 90)).toEqual({ x: 684, y: 52, angle: 90 });
  });

  it('puts the workbook boxes of a rotated approval page where they are displayed', () => {
    const viewer = { width: 612, height: 792 }; // what pdf.js reports for a 792 x 612 page with /Rotate 90
    const user = { width: 792, height: 612 };
    const it = defaultItem('date', '2023a', 0, 3, viewer, 'd', { rotation: 90 });
    const box = defaultSignPlacement('2023a', 0, user).date;
    const want = userRectToViewer(box, user, 90);
    for (const k of ['x', 'y', 'width', 'height']) expect(it[k]).toBeCloseTo(want[k], 1);
    expect(it.x + it.width).toBeLessThanOrEqual(612);
    expect(it.y + it.height).toBeLessThanOrEqual(792);
    expect(defaultItems('2023a', 0, 3, viewer, { rotation: 90 })).toHaveLength(3);
  });
});

describe('pdfPlan: Task 9.2, signature images', () => {
  it('finds the ink bounding box plus a margin, inside the image', () => {
    const w = 10, h = 6;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const ink = (x, y, a = 255) => { rgba[(y * w + x) * 4 + 3] = a; };
    ink(3, 2); ink(5, 3);
    expect(inkBoundingBox(rgba, w, h, { margin: 1 })).toEqual({ x: 2, y: 1, width: 5, height: 4 });
    expect(inkBoundingBox(rgba, w, h, { margin: 0 })).toEqual({ x: 3, y: 2, width: 3, height: 2 });
    expect(inkBoundingBox(rgba, w, h, { margin: 50 })).toEqual({ x: 0, y: 0, width: 10, height: 6 });
    expect(inkBoundingBox(rgba, w, h)).toEqual({ x: 0, y: 0, width: 10, height: 6 }); // default margin 4 px
  });
  it('ignores near-transparent noise and returns null for an empty image', () => {
    const w = 4, h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    expect(inkBoundingBox(rgba, w, h)).toBeNull();
    rgba[3] = 5; // faint, below the threshold
    expect(inkBoundingBox(rgba, w, h)).toBeNull();
    expect(inkBoundingBox([], 0, 0)).toBeNull();
  });

  it('sizes a signature from its aspect ratio and the size factor', () => {
    expect(SIGNATURE_BASE_WIDTH_PT).toBe(126);
    expect(defaultItemSize('signature', 5, 1)).toEqual({ width: 126, height: 25.2 });
    expect(defaultItemSize('signature', 5, 1.4)).toEqual({ width: 176.4, height: 35.3 });
    expect(defaultItemSize('signature', 5, 9).width).toBe(176.4); // clamped to SIG_SCALE_MAX
    expect(defaultItemSize('signature')).toEqual({ width: 126, height: 30 }); // no image yet
    const it = newItemAtPoint('signature', 0, { x: 300, y: 400 }, { width: 612, height: 792 }, { aspect: 4, scale: 1 });
    expect(it.width / it.height).toBeCloseTo(4, 1);
    expect(it.x + it.width / 2).toBeCloseTo(300, 1);
  });

  it('keeps the aspect ratio when the corner is dragged (whichever axis moves more)', () => {
    const page = { width: 612, height: 792 };
    const box = { x: 100, y: 600, width: 100, height: 25 };
    const a = resizeImageBoxInPage(box, 50, 0, page);
    expect(a).toMatchObject({ x: 100, width: 150, height: 37.5, y: 587.5 });
    const b = resizeImageBoxInPage(box, 0, 50, page);
    expect(b.width / b.height).toBeCloseTo(4, 1);
    expect(b.width).toBe(300);
    expect(b.y + b.height).toBeCloseTo(625, 1); // top edge stays
    const tiny = resizeImageBoxInPage(box, -500, 0, page);
    expect(tiny.width).toBe(24);
    const wide = resizeImageBoxInPage(box, 5000, 0, page);
    expect(wide.x + wide.width).toBeLessThanOrEqual(612);
    expect(wide.width / wide.height).toBeCloseTo(4, 1);
  });

  it('resizes an image to a new width around its center (the "Signature size" control)', () => {
    const page = { width: 612, height: 792 };
    const r = setImageItemWidth({ x: 100, y: 100, width: 100, height: 25 }, 200, page);
    expect(r.width).toBe(200);
    expect(r.height).toBe(50);
    expect(r.x + r.width / 2).toBeCloseTo(150, 1);
    expect(r.y + r.height / 2).toBeCloseTo(112.5, 1);
  });

  it('fits a signature of a given aspect inside the workbook box, centered', () => {
    const it = defaultItem('signature', '2023a', 0, 3, { width: 612, height: 792 }, 's', { aspect: 6 });
    expect(it.width / it.height).toBeCloseTo(6, 1);
    const box = defaultSignPlacement('2023a', 0, { width: 612, height: 792 }).signature;
    expect(it.x).toBeGreaterThanOrEqual(box.x - 0.1);
    expect(it.x + it.width).toBeLessThanOrEqual(box.x + box.width + 0.1);
    expect(it.y + it.height).toBeLessThanOrEqual(box.y + box.height + 0.1);
  });
});
