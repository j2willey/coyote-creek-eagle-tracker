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
  canSignPage,
  SCRIPT_FONTS,
  fitTextFontSize,
  SIG_SCALE_MIN,
  SIG_SCALE_MAX,
  TEXT_FONT_MIN_PT,
  TEXT_FONT_MAX_PT,
  fitSignatureDimensions,
  resizeBoxInPage,
  defaultSignPlacement
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

  it('enforces the hard ordering rule: only approval pages before the first Not-Ours landmark may be signed', () => {
    const pages = [
      { text: 'Proposal cover', fields: ['Candidates Full Name'] },
      { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] },
      { text: '11 Proposal Approval Council or District Approval (second copy)', fields: ['District or Council Approval Name'] },
      { text: '13 PROJECT PLAN Completing the project plan is mandatory', fields: ['Comments from Proposal Review'] },
      { text: '18 Project Plan Reviews Input from Beneficiary Input from Scoutmaster', fields: ['Candidate’s Promise Date'] },
      { text: '22 Certification of Completion ACCEPTANCE OF THE WORK', fields: ['Certification of Completion Signature'] },
      // Even if a page matching an approval landmark were somehow placed at the end of the PDF after Report, it is forbidden:
      { text: '11 Proposal Approval Council or District Approval', fields: ['District or Council Approval Name'] }
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

    expect(canSignPage(analysis, 1).ok).toBe(true);
    expect(canSignPage(analysis, 2).ok).toBe(true);
    expect(canSignPage(analysis, 0).ok).toBe(false); // cover page, not an approval page
    expect(canSignPage(analysis, 3).ok).toBe(false); // Project Plan
    expect(canSignPage(analysis, 4).ok).toBe(false); // Project Plan Reviews
    expect(canSignPage(analysis, 5).ok).toBe(false); // Certification of Completion
    expect(canSignPage(analysis, 6).ok).toBe(false); // after firstNotOursPageIndex
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
