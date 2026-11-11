// @ts-check
/**
 * Pure browser rules for the Review page's Scout folder files panel and PDF Workshop (Jim W., 2026-11-09).
 *
 * Step 1: classify the top-level files in a Scout's folder (Signed copy, ESSPP Proposal, Photo, Slides, Signatures,
 * or other files), pick the primary PDF for review/signing, and check whether a file is small enough to fetch or open
 * in the Workshop.
 *
 * Step 2: detect the workbook edition (2023a vs 2026), locate our Proposal Approval signature page(s) vs. forbidden
 * post-Proposal pages (Project Plan, Fundraising Application, Project Report), default to the LAST Proposal Approval
 * page when multiple approval copies exist, and compute vector placement, resize, and size-fit math for Signer 1 and
 * Signer 2.
 */

export const MAX_MB = 20;
export const MAX_BYTES = MAX_MB * 1024 * 1024;
export const SIGNED_TAG = '_ESSPP-ApprovedAndSignedBy-';
export const PDFLIB_VERSION = '1.17.1';
export const PDFJS_VERSION = '3.11.174';

/**
 * Sign Workshop size limits. The UI sliders and the clamps in `fitSignatureDimensions` / `fitTextFontSize` both use
 * these, so they cannot drift apart. A signature above 100% may extend past its box (it stays centered on it): that is
 * by design, and the on-screen preview shows the same thing.
 */
export const SIG_SCALE_MIN = 0.5;
export const SIG_SCALE_MAX = 1.4;
export const TEXT_FONT_MIN_PT = 7;
export const TEXT_FONT_MAX_PT = 16;

/**
 * @typedef {'signed' | 'esspp' | 'photo' | 'slides' | 'signatures' | 'other'} FileRole
 * @typedef {'2026' | '2023a' | 'unknown'} WorkbookEdition
 * @typedef {'approval' | 'forbidden' | 'proposal'} PageRole
 * @typedef {'dancing' | 'greatvibes' | 'allura' | 'alexbrush' | 'sacramento' | 'satisfy' | 'pinyon' | 'mrdafoe' | 'homemade' | 'caveat'} ScriptFontKey
 *
 * @typedef {Object} ScriptFontSpec
 * @property {ScriptFontKey} key
 * @property {string} family
 * @property {string} label
 *
 * @typedef {Object} FolderFileInput
 * @property {string} id
 * @property {string} name
 * @property {string} [mime]
 * @property {number} [bytes]
 * @property {string} [date]
 *
 * @typedef {Object} FolderFile
 * @property {string} id
 * @property {string} name
 * @property {string} mime
 * @property {number} bytes
 * @property {string} date
 * @property {FileRole} role
 * @property {number} version
 * @property {boolean} isPdf
 * @property {boolean} isImage
 * @property {boolean} primary
 *
 * @typedef {Object} PageDescriptorInput
 * @property {number} [pageIndex]
 * @property {string} [text]
 * @property {string[]} [fields]
 * @property {Record<string, string>} [fieldValues]
 *
 * @typedef {Object} AnalyzedPage
 * @property {number} pageIndex
 * @property {number} pageNumber
 * @property {PageRole} role
 * @property {boolean} isApprovalLandmark
 * @property {boolean} forbidden  true only when THIS page is identified as Project Plan / Fundraising Application / Project Report
 * @property {boolean} afterNotOurs  not locked itself, but it comes after the first locked page (placing there needs a confirm)
 * @property {string} notOursSection
 * @property {boolean} scanCandidate  no text and no form fields, inside the Proposal section: probably a scanned page
 *
 * @typedef {Object} WorkbookAnalysis
 * @property {WorkbookEdition} edition
 * @property {AnalyzedPage[]} pages
 * @property {number[]} approvalPageIndices
 * @property {number[]} scanCandidatePageIndices
 * @property {number} defaultTargetPageIndex  -1 when no approval page and no scanned candidate was found: nothing is preselected
 * @property {number} firstNotOursPageIndex  index of the first locked page (pages.length when none); display / confirm only
 * @property {number} proposalEndPageIndex
 * @property {number} insertBeforePageIndex
 *
 * @typedef {Object} BoxPlacement
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} [fontSize]
 * @property {string} [fieldName]
 *
 * @typedef {Object} SignPlacement
 * @property {BoxPlacement} signature
 * @property {BoxPlacement} date
 * @property {BoxPlacement} printedName
 *
 * @typedef {'signature' | 'name' | 'date' | 'stamp'} ItemKind
 *
 * One mark the member placed on a page, in PDF points (bottom-left origin).
 * @typedef {Object} PlacedItem
 * @property {string} id
 * @property {ItemKind} kind
 * @property {number} pageIndex
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} [stampId]
 */

/**
 * 10 OFL-licensed script/handwriting Google Fonts for typed signatures in the Sign Workshop.
 * @type {ScriptFontSpec[]}
 */
export const SCRIPT_FONTS = [
  { key: 'dancing', family: 'Dancing Script', label: 'Dancing Script' },
  { key: 'greatvibes', family: 'Great Vibes', label: 'Great Vibes' },
  { key: 'allura', family: 'Allura', label: 'Allura' },
  { key: 'alexbrush', family: 'Alex Brush', label: 'Alex Brush' },
  { key: 'sacramento', family: 'Sacramento', label: 'Sacramento' },
  { key: 'satisfy', family: 'Satisfy', label: 'Satisfy' },
  { key: 'pinyon', family: 'Pinyon Script', label: 'Pinyon Script' },
  { key: 'mrdafoe', family: 'Mr Dafoe', label: 'Mr Dafoe' },
  { key: 'homemade', family: 'Homemade Apple', label: 'Homemade Apple' },
  { key: 'caveat', family: 'Caveat', label: 'Caveat' }
];

const str = (/** @type {unknown} */ v) => v == null ? '' : String(v).trim();

/**
 * Classify a file name into a role and version (0 when unversioned).
 * Standard names: `<Name>-<Unit>_<Tag>-V<n>.<ext>` or `<Name>-<Unit>_ESSPP-ApprovedAndSignedBy-<Initials>.pdf`.
 * @param {string} name
 * @param {string} [mime]
 * @returns {{ role: FileRole, version: number, isPdf: boolean, isImage: boolean }}
 */
export function classifyFile(name, mime = '') {
  const n = str(name);
  const m = str(mime).toLowerCase();
  const isPdf = /\.pdf$/i.test(n) || m === 'application/pdf';
  const isImage = /\.(jpe?g|png|heic|heif)$/i.test(n) || /^image\/(jpeg|png|heic|heif)$/.test(m);
  if (n.includes(SIGNED_TAG) && isPdf) {
    return { role: 'signed', version: 0, isPdf, isImage: false };
  }
  const std = /_([A-Za-z]+)-V(\d+)(?:\.[A-Za-z0-9]+)?$/.exec(n);
  if (std) {
    const tag = std[1].toLowerCase();
    const version = Number(std[2]) || 0;
    if (tag === 'esspp') return { role: 'esspp', version, isPdf, isImage };
    if (tag === 'photo') return { role: 'photo', version, isPdf, isImage };
    if (tag === 'slides') return { role: 'slides', version, isPdf, isImage };
    if (tag === 'signatures') return { role: 'signatures', version, isPdf, isImage };
    return { role: 'other', version, isPdf, isImage };
  }
  if (isImage) return { role: 'photo', version: 0, isPdf: false, isImage: true };
  return { role: 'other', version: 0, isPdf, isImage };
}

/** Sort priority for roles on the Review page. */
const ROLE_ORDER = /** @type {Record<FileRole, number>} */ ({
  signed: 0,
  esspp: 1,
  signatures: 2,
  photo: 3,
  slides: 4,
  other: 5
});

/**
 * Classify, sort, and mark the primary PDF among the top-level files of a Scout's folder.
 * - When `signing` is true (signatures in progress), the primary file is the newest `signed` PDF (falling back to the
 *   newest `esspp` PDF if none).
 * - Otherwise, the primary file is the highest-version `esspp` PDF (falling back to any `signed` PDF or the first PDF).
 *
 * @param {FolderFileInput[]} files
 * @param {{ signing?: boolean }} [opts]
 * @returns {FolderFile[]}
 */
export function planFolderFiles(files, opts = {}) {
  const signing = !!opts.signing;
  const list = (files || []).map((f, idx) => {
    const name = str(f && f.name);
    const mime = str(f && f.mime);
    const bytes = Math.max(0, Number(f && f.bytes) || 0);
    const date = str(f && f.date);
    const c = classifyFile(name, mime);
    return {
      id: str(f && f.id),
      name,
      mime: mime || (c.isPdf ? 'application/pdf' : ''),
      bytes,
      date,
      role: c.role,
      version: c.version,
      isPdf: c.isPdf,
      isImage: c.isImage,
      primary: false,
      _idx: idx
    };
  }).filter(f => f.id && f.name);

  list.sort((a, b) => {
    if (ROLE_ORDER[a.role] !== ROLE_ORDER[b.role]) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (a.role === 'esspp' && a.version !== b.version) return b.version - a.version;
    if (a.version !== b.version) return a.version - b.version;
    return a.name.localeCompare(b.name) || (a._idx - b._idx);
  });

  const pdfs = list.filter(f => f.isPdf);
  const signedPdf = pdfs.find(f => f.role === 'signed');
  const essppPdf = pdfs.find(f => f.role === 'esspp');
  const primary = signing
    ? (signedPdf || essppPdf || pdfs[0] || null)
    : (essppPdf || signedPdf || pdfs[0] || null);
  if (primary) primary.primary = true;

  return list.map(({ _idx, ...rest }) => rest);
}

/**
 * Short human-readable badge for a folder file's role.
 * @param {Pick<FolderFile, 'role' | 'version'>} file
 * @returns {string}
 */
export function roleLabel(file) {
  if (!file) return '';
  if (file.role === 'signed') return 'Signed copy';
  if (file.role === 'esspp') return file.version ? `Proposal V${file.version}` : 'Proposal';
  if (file.role === 'signatures') return file.version ? `Signatures V${file.version}` : 'Signatures';
  if (file.role === 'photo') return file.version ? `Photo V${file.version}` : 'Photo';
  if (file.role === 'slides') return file.version ? `Slides V${file.version}` : 'Slides';
  return file.version ? `V${file.version}` : 'File';
}

/**
 * Check whether a folder file can be fetched through Apps Script (<= maxMB, default 20 MB).
 * Returns '' if OK, or a user-facing reason if not.
 * @param {{ name?: string, bytes?: number }} file
 * @param {number} [maxMB]
 * @returns {string}
 */
export function fetchProblem(file, maxMB = MAX_MB) {
  const name = str(file && file.name) || 'File';
  const bytes = Number(file && file.bytes) || 0;
  const limit = (Number(maxMB) || MAX_MB) * 1024 * 1024;
  if (bytes > limit) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `${name} is ${mb} MB (over the ${Number(maxMB) || MAX_MB} MB limit). Open it in Drive to download it directly.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Step 2: Workbook edition, Our vs. Not-Ours page landmarks, and signing rules
// ---------------------------------------------------------------------------

/** Field names that uniquely identify the 2026 Proposal Approval page (Page 11). */
const APPROVAL_FIELDS_2026 = new Set([
  'District or Council Approval Name',
  'District or Council Approval Signature',
  'District or Council Signature Date'
]);

/** Field names that uniquely identify the 2023a Proposal Page H (Page 15). */
const APPROVAL_FIELDS_2023A = new Set([
  'Proposal-BSAName'
]);

/** Field names that appear ONLY on post-Proposal (Project Plan or Project Report) pages in the 2026 workbook. */
const NOT_OURS_FIELDS_2026 = new Set([
  'Comments from Proposal Review',
  'The Work Present Condition or Situation',
  'Project Plan Eagle Scout Hours',
  'Input from Beneficiary',
  'Input from Scoutmaster',
  'Certification of Completion Signature',
  'Beneficiary’s Signature',
  "Beneficiary's Signature",
  'Beneficiary Signature Date',
  'Scoutmaster’s Final Signature',
  "Scoutmaster's Final Signature"
]);

/**
 * Text landmarks of Proposal Page H (the approval page): the "Proposal Page H" footer, or the "Council or District
 * Approval" heading together with "Candidate's Promise". Handles the 2023a subset-font glyph mapping (P->3, C->&,
 * D->', A->$). Checked BEFORE the not-ours rules: Page H has a Candidate's Promise date field and may follow Plan
 * pages, but it is ours.
 * @param {string} text
 * @returns {boolean}
 */
export function isProposalPageHText(text) {
  const t = str(text);
  if (/\b[P3]roposal\s+[P3]age\s+H\b/i.test(t)) return true;
  // (?<![A-Za-z0-9]) instead of \b: the subset-font glyph "&" is not a word character, so \b would fail before it.
  return /(?<![A-Za-z0-9])[C&]ouncil\s+or\s+[D']istrict\s+[A$]pproval\b/i.test(t) && /(?<![A-Za-z0-9])[C&]andidate.?s\s+[P3]romise\b/i.test(t);
}

/**
 * Detect whether a single page matches a forbidden post-Proposal section (Project Plan, Fundraising Application, or
 * Project Report). Handles both normal ASCII text and the 2023a workbook's subset-font glyph mapping (where P->3,
 * R->5, C->&, D->', A->$, F->)).
 * @param {string} text
 * @param {string[]} fields
 * @returns {string} Non-empty section name when the page is a Not-Ours page, or '' otherwise.
 */
export function detectNotOursSection(text, fields) {
  const t = str(text);
  const fl = Array.isArray(fields) ? fields : [];

  // Page H wins over every not-ours rule.
  if (isProposalPageHText(t)) return '';

  // 0. If the page has explicit Proposal-only AcroForm fields, it is part of the Proposal
  for (const raw of fl) {
    const f = str(raw);
    if (
      APPROVAL_FIELDS_2026.has(f) ||
      APPROVAL_FIELDS_2023A.has(f) ||
      /^Proposal-/i.test(f) ||
      /^Contact-/i.test(f) ||
      f === 'Birth Date' ||
      f === 'Life Rank Board of Review Date'
    ) {
      return '';
    }
  }

  // 1. Check post-Proposal AcroForm field names
  for (const raw of fl) {
    const f = str(raw);
    if (/^FundApp-/i.test(f)) return 'Fundraising Application';
    if (/^Report-/i.test(f)) return 'Project Report';
    if (/^Plan-/i.test(f)) return 'Project Plan';
    if (
      f === 'Certification of Completion Signature' ||
      f === 'Beneficiary’s Signature' ||
      f === "Beneficiary's Signature" ||
      f === 'Scoutmaster’s Final Signature' ||
      f === "Scoutmaster's Final Signature" ||
      f === 'Beneficiary Signature Date'
    ) {
      return 'Project Report (Certification of Completion)';
    }
    // NOTE: a "Candidate's Promise Date" field alone does NOT identify the Plan Reviews page: the 2023a Proposal Page H
    // has one too. Plan Reviews needs its own landmarks (these fields, or the text landmarks below).
    if (f === 'Input from Beneficiary' || f === 'Input from Scoutmaster') {
      return 'Project Plan (Plan Reviews)';
    }
    if (NOT_OURS_FIELDS_2026.has(f)) {
      return 'Project Plan';
    }
  }

  // 2. Check text landmarks
  if (
    /\bACCEPTANCE\s+OF\s+THE\s+WORK\b/.test(t) ||
    /\bCertification\s+of\s+Completion\s+Candidate/i.test(t)
  ) {
    return 'Project Report (Certification of Completion)';
  }
  if (
    /\b[P3]ro[jM]ect\s+[R5]eport\s+[P3]age\s+[A-C]\b/i.test(t) ||
    (/\bEagle\s+Scout\s+Service\s+[P3]ro[jM]ect\s+[R5]eport\b/i.test(t) && /\bProject\s+start\s+date\b/i.test(t)) ||
    /\bPROJECT\s+REPORT\s*[•●-]/.test(t) ||
    /\b\d+\s+PROJECT\s+REPORT\b/.test(t)
  ) {
    return 'Project Report';
  }
  if (
    /\b[F)]undraising\s+[$A]pplication\s+[P3]age\b/i.test(t) ||
    /\bEagle\s+Scout\s+Leadership\s+Service\s+Project\s+Fundraising\b/i.test(t)
  ) {
    return 'Fundraising Application';
  }
  if (/\bProject\s+Plan\s+Reviews\b/i.test(t) || (/\bInput\s+from\s+Beneficiary\b/i.test(t) && /\bInput\s+from\s+Scoutmaster\b/i.test(t))) {
    return 'Project Plan (Plan Reviews)';
  }
  if (
    /\b[P3]ro[jM]ect\s+[P3]lan\s+[P3]age\s+[A-F]\b/i.test(t) ||
    (/\bEagle\s+Scout\s+Service\s+[P3]ro[jM]ect\s+[P3]lan\b/i.test(t) && /\bPlanned\s+start\s+date\b/i.test(t)) ||
    (/\bPROJECT\s+PLAN\b/.test(t) && /\bCompleting\s+the\s+project\s+plan\s+is\s+mandatory\b/i.test(t)) ||
    /\bComments\s+from\s+Your\s+Proposal\s+Review\b/i.test(t) ||
    /\b[C&]omments\s+[F)]rom\s+[<Y]our\s+[P3]roposal\s+[R5]evie[wZ]\b/i.test(t)
  ) {
    return 'Project Plan';
  }
  return '';
}

/**
 * Detect whether a single page matches our Proposal Approval signature page landmark (2026 Page 11 or 2023a Page H).
 * Returns false if the page matches any Not-Ours landmark.
 * @param {string} text
 * @param {string[]} fields
 * @returns {boolean}
 */
export function isProposalApprovalLandmark(text, fields) {
  if (isProposalPageHText(text)) return true;
  if (detectNotOursSection(text, fields)) return false;
  const t = str(text);
  const fl = Array.isArray(fields) ? fields : [];

  for (const raw of fl) {
    const f = str(raw);
    if (APPROVAL_FIELDS_2026.has(f) || APPROVAL_FIELDS_2023A.has(f)) return true;
  }

  // 2026 Page 11 text landmark
  if (/\bProposal\s+Approval\b/i.test(t) && /\bCouncil\s+or\s+District\s+Approval\b/i.test(t)) {
    return true;
  }
  // 2023a Proposal Page H text landmark (handles both normal ASCII and 2023a subset font where P->3, C->&, D->', A->$)
  if (/\b[P3]roposal\s+[P3]age\s+H\b/i.test(t)) {
    return true;
  }
  if (/\b[C&]ouncil\s+or\s+[D']istrict\s+[A$]pproval\b/i.test(t) && /\b[C&]andidate.?s\s+[P3]romise\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Analyze all pages of a workbook PDF to determine:
 * - `edition`: `'2026' | '2023a' | 'unknown'`
 * - `approvalPageIndices`: 0-based indices of Proposal Approval signature pages (Page H may follow Plan pages)
 * - `scanCandidatePageIndices`: pages with no text and no form fields before the first Not-Ours page (probably scans)
 * - `defaultTargetPageIndex`: the LAST approval page, else the LAST scanned candidate, else -1 (no default)
 * - `firstNotOursPageIndex`: 0-based index of the first Project Plan / Fundraising / Project Report page (display and confirm only)
 * - `proposalEndPageIndex`: 0-based index of the last Proposal page (fields on `0..proposalEndPageIndex` get flattened)
 * - `insertBeforePageIndex`: 0-based index right before the first Proposal Approval page (where supporting pages go)
 *
 * @param {PageDescriptorInput[]} pages
 * @returns {WorkbookAnalysis}
 */
export function analyzeWorkbookPages(pages) {
  const list = Array.isArray(pages) ? pages : [];
  /** @type {WorkbookEdition} */
  let edition = 'unknown';

  for (const p of list) {
    const fl = Array.isArray(p && p.fields) ? p.fields : [];
    const t = str(p && p.text);
    if (fl.some(f => APPROVAL_FIELDS_2026.has(f) || f === 'Candidates Full Name') || /\bNo\.\s*512\s*-\s*927\b/i.test(t) || /\bOctober\s+2026\b/i.test(t)) {
      edition = '2026';
      break;
    }
    if (fl.some(f => APPROVAL_FIELDS_2023A.has(f) || f === 'Workbook-EagleName' || /^Proposal-/i.test(f)) || /\bNo\.\s*202\s*3\s*a\b/i.test(t) || /\b[P3]roposal\s+[P3]age\s+[A-H]\b/i.test(t)) {
      edition = '2023a';
      break;
    }
  }

  let firstNotOursPageIndex = list.length;
  const rawPages = list.map((p, idx) => {
    const text = str(p && p.text);
    const fields = Array.isArray(p && p.fields) ? p.fields : [];
    const notOursSection = detectNotOursSection(text, fields);
    if (notOursSection && idx < firstNotOursPageIndex) {
      firstNotOursPageIndex = idx;
    }
    const isApprovalLandmark = !notOursSection && isProposalApprovalLandmark(text, fields);
    return {
      noContent: !text && fields.length === 0,
      pageIndex: idx,
      pageNumber: idx + 1,
      text,
      fields,
      notOursSection,
      isApprovalLandmark
    };
  });

  /** @type {number[]} */
  const approvalPageIndices = [];
  /** @type {number[]} */
  const scanCandidatePageIndices = [];
  /** @type {AnalyzedPage[]} */
  const analyzedPages = rawPages.map(p => {
    // Locked is decided per page: only a page identified as Project Plan / Fundraising / Report is forbidden.
    const forbidden = Boolean(p.notOursSection);
    const afterNotOurs = !forbidden && p.pageIndex > firstNotOursPageIndex;
    const isApproval = p.isApprovalLandmark && !forbidden;
    if (isApproval) approvalPageIndices.push(p.pageIndex);
    // A page with no text and no form fields, before the first locked page, is probably a scan (a signed Page H).
    const scanCandidate = !forbidden && !afterNotOurs && !isApproval && p.noContent;
    if (scanCandidate) scanCandidatePageIndices.push(p.pageIndex);
    /** @type {PageRole} */
    const role = isApproval ? 'approval' : forbidden ? 'forbidden' : 'proposal';
    return {
      pageIndex: p.pageIndex,
      pageNumber: p.pageNumber,
      role,
      isApprovalLandmark: isApproval,
      forbidden,
      afterNotOurs,
      notOursSection: p.notOursSection,
      scanCandidate
    };
  });

  const lastProposalIdx = firstNotOursPageIndex < list.length
    ? Math.max(0, firstNotOursPageIndex - 1)
    : Math.max(0, list.length - 1);
  const proposalEndPageIndex = approvalPageIndices.length > 0
    ? Math.max(...approvalPageIndices)
    : lastProposalIdx;
  const insertBeforePageIndex = approvalPageIndices.length > 0
    ? Math.min(...approvalPageIndices)
    : proposalEndPageIndex;
  // Default target: the LAST Proposal Approval page; else the LAST scanned candidate; else NO default (-1). Never an
  // ordinary Proposal page: the member scrolls to the signature page and places the marks there.
  const defaultTargetPageIndex = approvalPageIndices.length > 0
    ? approvalPageIndices[approvalPageIndices.length - 1]
    : scanCandidatePageIndices.length > 0
      ? scanCandidatePageIndices[scanCandidatePageIndices.length - 1]
      : -1;

  return {
    edition,
    pages: analyzedPages,
    approvalPageIndices,
    scanCandidatePageIndices,
    defaultTargetPageIndex,
    firstNotOursPageIndex,
    proposalEndPageIndex,
    insertBeforePageIndex
  };
}

/**
 * Format a clear description of which page is currently targeted for signing, e.g.
 * `"Page 17 of 34, the last of 3 approval pages"` when multiple Proposal Approval pages exist.
 * @param {WorkbookAnalysis} analysis
 * @param {number} pageIndex
 * @returns {string}
 */
export function describeTargetPage(analysis, pageIndex) {
  if (!(pageIndex >= 0)) return 'no page chosen yet';
  const total = analysis && Array.isArray(analysis.pages) ? analysis.pages.length : 0;
  const pNum = pageIndex + 1;
  const apps = (analysis && analysis.approvalPageIndices) || [];
  if (apps.length > 1) {
    const pos = apps.indexOf(pageIndex);
    if (pos === apps.length - 1) {
      return `Page ${pNum} of ${total}, the last of ${apps.length} approval pages`;
    }
    if (pos === 0) {
      return `Page ${pNum} of ${total}, the 1st of ${apps.length} approval pages`;
    }
    if (pos > 0) {
      return `Page ${pNum} of ${total}, approval page ${pos + 1} of ${apps.length}`;
    }
  }
  if (apps.length === 1 && apps[0] === pageIndex) {
    return `Page ${pNum} of ${total} (Proposal Approval)`;
  }
  const pg = analysis && analysis.pages && analysis.pages[pageIndex];
  if (pg && pg.scanCandidate) return `Page ${pNum} of ${total} (a scanned page)`;
  return `Page ${pNum} of ${total}`;
}

/**
 * Compute the effective font size (in PDF points) for a Printed Name or Date box.
 * - When `requestedFontSize` is `0` or omitted ("Auto-fit"), fits the text to the box's height and width.
 * - When `requestedFontSize > 0` is specified by the user, clamps it to `[TEXT_FONT_MIN_PT, TEXT_FONT_MAX_PT]` (7 to 16 pt, the same range the UI offers).
 *
 * @param {string} text
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number} [requestedFontSize]
 * @returns {number}
 */
export function fitTextFontSize(text, boxWidth, boxHeight, requestedFontSize = 0) {
  const req = Number(requestedFontSize) || 0;
  if (req > 0) {
    return Math.max(TEXT_FONT_MIN_PT, Math.min(TEXT_FONT_MAX_PT, Math.round(req * 10) / 10));
  }
  const clean = str(text);
  const w = Math.max(12, Number(boxWidth) || 100);
  const h = Math.max(8, Number(boxHeight) || 16);
  const byHeight = Math.min(14, Math.max(7, h * 0.58));
  if (!clean) return Math.round(byHeight * 10) / 10;
  const approxCharWidth = 0.52;
  const byWidth = Math.max(6, (w - 4) / (clean.length * approxCharWidth));
  return Math.round(Math.min(byHeight, byWidth) * 10) / 10;
}

/**
 * Compute the aspect-fitted `{ x, y, width, height }` for drawing a signature image inside a signature `box`,
 * applying an optional `scaleFactor` (`SIG_SCALE_MIN` to `SIG_SCALE_MAX`, i.e. 0.5 to 1.4, default `1.0` = fit box). Above 1.0 the signature may extend
 * past its box on every side (centered on it); that is by design and the preview shows it.
 *
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {BoxPlacement} box
 * @param {number} [scaleFactor]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function fitSignatureDimensions(imgWidth, imgHeight, box, scaleFactor = 1) {
  const iw = Math.max(1, Number(imgWidth) || 1);
  const ih = Math.max(1, Number(imgHeight) || 1);
  const factor = Math.max(SIG_SCALE_MIN, Math.min(SIG_SCALE_MAX, Number(scaleFactor) || 1));
  const baseScale = Math.min(box.width / iw, box.height / ih);
  const drawW = Math.round(iw * baseScale * factor * 100) / 100;
  const drawH = Math.round(ih * baseScale * factor * 100) / 100;
  const drawX = Math.round((box.x + (box.width - drawW) / 2) * 100) / 100;
  const drawY = Math.round((box.y + (box.height - drawH) / 2) * 100) / 100;
  return { x: drawX, y: drawY, width: drawW, height: drawH };
}

/**
 * Resize a placement box (`signature`, `date`, or `printedName`) when dragging its bottom-right corner handle by
 * `(dxPt, dyPt)` in screen-direction PDF points (`dxPt > 0` = wider to the right, `dyPt > 0` = taller downward while
 * keeping the top-left corner anchored).
 *
 * @param {BoxPlacement} origBox
 * @param {number} dxPt
 * @param {number} dyPt
 * @param {{ width: number, height: number }} pageSize
 * @param {{ minWidth?: number, minHeight?: number }} [limits]
 * @returns {BoxPlacement}
 */
export function resizeBoxInPage(origBox, dxPt, dyPt, pageSize, limits = {}) {
  const minW = Number(limits.minWidth) || 24;
  const minH = Number(limits.minHeight) || 10;
  const pw = Math.max(100, Number(pageSize && pageSize.width) || 612);
  const topEdge = origBox.y + origBox.height;

  const newWidth = Math.max(minW, Math.min(pw - origBox.x, Math.round((origBox.width + dxPt) * 10) / 10));
  const maxPossibleHeight = Math.max(minH, topEdge);
  const newHeight = Math.max(minH, Math.min(maxPossibleHeight, Math.round((origBox.height + dyPt) * 10) / 10));
  const newY = Math.max(0, Math.round((topEdge - newHeight) * 10) / 10);

  return {
    ...origBox,
    y: newY,
    width: newWidth,
    height: newHeight
  };
}

/**
 * Compute default PDF placement rectangles (bottom-left origin, in PDF points) for the Council/District Approval
 * signature, date, and printed name.
 * - `signerIndex === 0`: places Signature, Date, and Printed Name in the Council/District Approval boxes (and maps to
 *   the workbook's AcroForm fields when present).
 * - `signerIndex >= 1`: places Signer 2 cleanly below Signer 1's line with empty `fieldName` so Signer 1's marks and
 *   fields are never overwritten.
 *
 * @param {WorkbookEdition} [edition]
 * @param {number} [signerIndex]
 * @param {{ width?: number, height?: number }} [pageSize]
 * @returns {SignPlacement}
 */
export function defaultSignPlacement(edition = 'unknown', signerIndex = 0, pageSize = { width: 612, height: 792 }) {
  const w = Number(pageSize && pageSize.width) || 612;
  const h = Number(pageSize && pageSize.height) || 792;
  const sx = w / 612;
  const sy = h / 792;
  const scaleBox = (/** @type {BoxPlacement} */ b) => ({
    x: Math.round(b.x * sx * 10) / 10,
    y: Math.round(b.y * sy * 10) / 10,
    width: Math.round(b.width * sx * 10) / 10,
    height: Math.round(b.height * sy * 10) / 10,
    fontSize: b.fontSize || 10,
    fieldName: b.fieldName || ''
  });

  const isSecond = Number(signerIndex) >= 1;

  if (edition === '2026') {
    if (!isSecond) {
      return {
        signature: scaleBox({ x: 346, y: 129, width: 114, height: 23 }),
        date: scaleBox({ x: 484, y: 130, width: 73, height: 21, fontSize: 10, fieldName: 'District or Council Signature Date' }),
        printedName: scaleBox({ x: 360, y: 110, width: 197, height: 19, fontSize: 10, fieldName: 'District or Council Approval Name' })
      };
    }
    return {
      signature: scaleBox({ x: 346, y: 65, width: 114, height: 20 }),
      date: scaleBox({ x: 484, y: 67, width: 73, height: 14, fontSize: 9.5, fieldName: '' }),
      printedName: scaleBox({ x: 360, y: 52, width: 197, height: 13, fontSize: 9.5, fieldName: '' })
    };
  }

  // 2023a workbook (and unknown fallback)
  if (!isSecond) {
    return {
      signature: scaleBox({ x: 338, y: 378, width: 126, height: 22 }),
      date: scaleBox({ x: 492, y: 379, width: 65, height: 14, fontSize: 10, fieldName: '' }),
      printedName: scaleBox({ x: 368, y: 364, width: 182, height: 12, fontSize: 9.5, fieldName: 'Proposal-BSAName' })
    };
  }
  return {
    signature: scaleBox({ x: 338, y: 316, width: 126, height: 22 }),
    date: scaleBox({ x: 492, y: 318, width: 65, height: 14, fontSize: 9.5, fieldName: '' }),
    printedName: scaleBox({ x: 368, y: 302, width: 182, height: 12, fontSize: 9.5, fieldName: '' })
  };
}

// ---------------------------------------------------------------------------
// Sign Workshop v2: the member PLACES marks (signature, printed name, date, stamps) on pages
// ---------------------------------------------------------------------------

/** Default stamp width (1.6 in); the height follows the image's aspect ratio. */
export const STAMP_DEFAULT_WIDTH_PT = 115;

/** Default sizes (PDF points) of a mark dropped with a click. */
const ITEM_DEFAULT_SIZE = /** @type {Record<ItemKind, { width: number, height: number }>} */ ({
  signature: { width: 126, height: 30 },
  name: { width: 170, height: 14 },
  date: { width: 70, height: 14 },
  stamp: { width: STAMP_DEFAULT_WIDTH_PT, height: STAMP_DEFAULT_WIDTH_PT }
});

/**
 * Default `{ width, height }` for a mark of this kind. A stamp keeps its image's aspect ratio (width / height).
 * @param {ItemKind} kind
 * @param {number} [aspect]
 * @returns {{ width: number, height: number }}
 */
export function defaultItemSize(kind, aspect = 0) {
  const base = ITEM_DEFAULT_SIZE[kind] || ITEM_DEFAULT_SIZE.signature;
  if (kind === 'stamp' && aspect > 0 && Number.isFinite(aspect)) {
    const a = Math.max(0.1, Math.min(10, aspect));
    return { width: base.width, height: Math.round((base.width / a) * 10) / 10 };
  }
  return { width: base.width, height: base.height };
}

/** A placed image (signature or stamp) is at most this fraction of the page width when it is dropped. */
export const IMAGE_MAX_PAGE_FRACTION = 0.4;

/**
 * Cap an image mark's width at 40% of the page width (aspect kept); text marks are returned unchanged.
 * @param {ItemKind} kind
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} pageSize
 * @returns {{ width: number, height: number }}
 */
export function capImageSize(kind, size, pageSize) {
  if (kind !== 'signature' && kind !== 'stamp') return size;
  const pw = Math.max(1, Number(pageSize && pageSize.width) || 612);
  const max = pw * IMAGE_MAX_PAGE_FRACTION;
  if (size.width <= max) return size;
  const f = max / size.width;
  return { width: Math.round(max * 10) / 10, height: Math.round(size.height * f * 10) / 10 };
}

/**
 * Keep an item's box inside the page (shrinking it only if it is bigger than the page).
 * @template {{ x: number, y: number, width: number, height: number }} T
 * @param {T} item
 * @param {{ width: number, height: number }} pageSize
 * @returns {T}
 */
export function clampItemToPage(item, pageSize) {
  const pw = Math.max(1, Number(pageSize && pageSize.width) || 612);
  const ph = Math.max(1, Number(pageSize && pageSize.height) || 792);
  const width = Math.min(item.width, pw);
  const height = Math.min(item.height, ph);
  const x = Math.max(0, Math.min(pw - width, item.x));
  const y = Math.max(0, Math.min(ph - height, item.y));
  return { ...item, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, width, height };
}

/**
 * A new mark centered on a click at `point` (PDF points, bottom-left origin), kept inside the page.
 * @param {ItemKind} kind
 * @param {number} pageIndex
 * @param {{ x: number, y: number }} point
 * @param {{ width: number, height: number }} pageSize
 * @param {{ id?: string, aspect?: number, stampId?: string }} [opts]
 * @returns {PlacedItem}
 */
export function newItemAtPoint(kind, pageIndex, point, pageSize, opts = {}) {
  const size = capImageSize(kind, defaultItemSize(kind, opts.aspect), pageSize);
  /** @type {PlacedItem} */
  const item = {
    id: opts.id || `${kind}-${pageIndex}-${Math.round(point.x)}-${Math.round(point.y)}`,
    kind,
    pageIndex,
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height
  };
  if (opts.stampId) item.stampId = opts.stampId;
  return clampItemToPage(item, pageSize);
}

/**
 * The topmost (last in the list) item on `pageIndex` whose box contains `point`, or null.
 * @param {PlacedItem[]} items
 * @param {number} pageIndex
 * @param {{ x: number, y: number }} point
 * @returns {PlacedItem | null}
 */
export function hitTestItems(items, pageIndex, point) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (it.pageIndex !== pageIndex) continue;
    if (point.x >= it.x && point.x <= it.x + it.width && point.y >= it.y && point.y <= it.y + it.height) return it;
  }
  return null;
}

/**
 * The workbook's own box for a signature / name / date on a detected approval page, as an item (Signer 1 uses the
 * Council/District boxes, later signers go below). Returns null for a stamp (it has no workbook box).
 * @param {ItemKind} kind
 * @param {WorkbookEdition} edition
 * @param {number} signerIndex
 * @param {number} pageIndex
 * @param {{ width: number, height: number }} pageSize
 * @param {string} [id]
 * @returns {PlacedItem | null}
 */
export function defaultItem(kind, edition, signerIndex, pageIndex, pageSize, id) {
  if (kind === 'stamp') return null;
  const dp = defaultSignPlacement(edition, signerIndex, pageSize);
  const box = kind === 'signature' ? dp.signature : kind === 'name' ? dp.printedName : dp.date;
  return {
    id: id || `${kind}-${pageIndex}-default`,
    kind,
    pageIndex,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  };
}

/**
 * Signature + name + date at the workbook's own boxes on one page.
 * @param {WorkbookEdition} edition
 * @param {number} signerIndex
 * @param {number} pageIndex
 * @param {{ width: number, height: number }} pageSize
 * @returns {PlacedItem[]}
 */
export function defaultItems(edition, signerIndex, pageIndex, pageSize) {
  return /** @type {PlacedItem[]} */ (
    /** @type {ItemKind[]} */ (['signature', 'name', 'date'])
      .map(k => defaultItem(k, edition, signerIndex, pageIndex, pageSize))
      .filter(Boolean)
  );
}

/**
 * Hard guardrail for ONE page: a page is locked only if IT is identified as Project Plan, Fundraising Application or
 * Project Report. Any other page may take marks; one that comes after a locked page (and is not a Proposal Approval
 * page) carries a `confirm` text the UI asks about once.
 * @param {WorkbookAnalysis} analysis
 * @param {number} pageIndex
 * @returns {{ ok: boolean, reason: string, confirm: string }}
 */
export function canPlaceOnPage(analysis, pageIndex) {
  if (!analysis || !Array.isArray(analysis.pages)) {
    return { ok: false, reason: 'Workbook analysis is unavailable.', confirm: '' };
  }
  const pg = analysis.pages[pageIndex];
  if (!pg) return { ok: false, reason: 'Page is out of range.', confirm: '' };
  if (pg.forbidden) {
    const sec = pg.notOursSection || 'Project Plan / Report';
    return {
      ok: false,
      reason: `Page ${pg.pageNumber} belongs to the ${sec} and cannot be signed or marked during Proposal Review.`,
      confirm: ''
    };
  }
  let confirm = '';
  if (pg.afterNotOurs && pg.role !== 'approval') {
    const first = analysis.pages[analysis.firstNotOursPageIndex];
    const sec = String((first && first.notOursSection) || 'Project Plan').replace(/\s*\(.*\)\s*$/, '');
    confirm = `This page comes after the ${sec}. Place here anyway?`;
  }
  return { ok: true, reason: '', confirm };
}

/**
 * Banner shown when no Proposal Approval page was found ('' when one was).
 * @param {WorkbookAnalysis} analysis
 * @returns {string}
 */
export function approvalBanner(analysis) {
  if (!analysis || !Array.isArray(analysis.pages)) return '';
  if (analysis.approvalPageIndices.length > 0) return '';
  const label = analysis.edition === '2026' ? 'Page 11' : 'Page H';
  let msg = `Couldn't find the Proposal Approval page (${label}): scroll to it.`;
  const scans = analysis.scanCandidatePageIndices || [];
  if (scans.length > 0) {
    const nums = scans.map(i => i + 1);
    const shown = nums.length > 6 ? `${nums.slice(0, 6).join(', ')}, …` : nums.join(', ');
    msg += ` Page${nums.length > 1 ? 's' : ''} ${shown} ${nums.length > 1 ? 'look' : 'looks'} like ${nums.length > 1 ? 'scans' : 'a scan'} and may be it.`;
  }
  return msg;
}

/**
 * Pages whose form fields get flattened: by default ONLY the pages that received a mark (the signature page). With
 * `includeEarlier`, also the Proposal pages before the first marked page. Never a page identified as Project Plan /
 * Fundraising Application / Project Report, whatever the marks say.
 * @param {WorkbookAnalysis} analysis
 * @param {PlacedItem[]} items
 * @param {{ includeEarlier?: boolean }} [opts]
 * @returns {number[]} sorted, unique, 0-based
 */
export function flattenPageIndices(analysis, items, opts = {}) {
  const out = new Set();
  const pages = (analysis && analysis.pages) || [];
  const marked = (Array.isArray(items) ? items : []).map(it => it.pageIndex);
  for (const i of marked) out.add(i);
  if (opts.includeEarlier && marked.length) {
    const first = Math.min(...marked);
    for (let i = 0; i < first && i < pages.length; i++) out.add(i);
  }
  return [...out].filter(i => pages[i] && !pages[i].forbidden).sort((a, b) => a - b);
}

/**
 * Check a list of placed marks before "Sign & Attach PDF". At least a signature is required; a missing printed name
 * or date is only a warning.
 * @param {WorkbookAnalysis} analysis
 * @param {PlacedItem[]} items
 * @param {{ signaturePresent: boolean, printedName: string, dateStr: string }} texts
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkPlacement(analysis, items, texts) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const list = Array.isArray(items) ? items : [];
  const seen = new Set();
  for (const it of list) {
    const c = canPlaceOnPage(analysis, it.pageIndex);
    if (!c.ok && !seen.has(c.reason)) { seen.add(c.reason); errors.push(c.reason); }
  }
  const has = (/** @type {ItemKind} */ k) => list.some(i => i.kind === k);
  if (!has('signature')) {
    errors.push('Place your signature on the page first: click ✍ Signature, then click where it goes.');
  } else if (!texts || !texts.signaturePresent) {
    errors.push('Create or select your signature in Section 1.');
  }
  if (has('name') && !String((texts && texts.printedName) || '').trim()) {
    errors.push('Enter your printed name (or remove the Printed name box).');
  }
  if (has('date') && !String((texts && texts.dateStr) || '').trim()) {
    errors.push('Enter the approval date (or remove the Date box).');
  }
  if (has('signature') && !has('name')) warnings.push('No printed name placed.');
  if (has('signature') && !has('date')) warnings.push('No date placed.');
  return { errors, warnings };
}

/**
 * True when at least one pixel of RGBA image data is not fully opaque (a stamp with a real transparent background).
 * @param {ArrayLike<number>} rgba  canvas `ImageData.data` (4 bytes per pixel)
 * @returns {boolean}
 */
export function hasTransparentPixel(rgba) {
  const n = rgba ? rgba.length : 0;
  for (let i = 3; i < n; i += 4) if (rgba[i] < 255) return true;
  return false;
}

/** Warning shown when a stamp PNG has no transparency. */
export const STAMP_OPAQUE_WARNING = 'This stamp has a white background and will cover the page under it.';

/**
 * Compact page-range text for 0-based page indices: `[0,1,2,4]` becomes `"1–3, 5"`.
 * @param {number[]} indices
 * @returns {string}
 */
export function describePageRanges(indices) {
  const nums = [...new Set((indices || []).filter(n => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b).map(n => n + 1);
  /** @type {string[]} */
  const parts = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
