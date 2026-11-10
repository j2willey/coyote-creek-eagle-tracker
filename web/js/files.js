// File picking for the Proposal pages (intake, update): one row per file (picker + "what is this"),
// checked the moment a file is chosen, so a Scout never waits for an upload that will be refused.
// The limit must match Settings → maxUploadMB (the script checks again on its side).
export const MAX_MB = 20;
export const ACCEPT = '.pdf,.pptx,.docx,.jpg,.jpeg,.png,.heic';
const EXTS = ACCEPT.split(',').map(e => e.slice(1));

export const sizeText = (b) => b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/** '' if the file can be sent, else a short reason. */
export function fileProblem(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!EXTS.includes(ext)) return `${file.name}: .${ext} files can't be sent. Save it as PDF (or DOCX, PPTX, JPG, PNG) first.`;
  if (!file.size) return `${file.name} is empty.`;
  if (file.size > MAX_MB * 1024 * 1024) return `${file.name} is ${sizeText(file.size)}; the limit is ${MAX_MB} MB per file.`;
  return '';
}

const SHRINK_HELP = `
  <details class="help"><summary>How to make it smaller</summary>
  <p>Large files are almost always full-size photos inside the document.</p>
  <ul>
    <li><b>Word or PowerPoint:</b> click a picture → <i>Picture Format → Compress Pictures</i>, untick “only this picture”,
      choose <i>Email (96 ppi)</i> or <i>Web (150 ppi)</i>, then save or export the PDF again.</li>
    <li><b>Google Docs or Slides:</b> <i>File → Download → PDF</i> is usually much smaller.</li>
    <li><b>A PDF you already have:</b> Adobe Acrobat → <i>Reduce File Size</i>, or on a Mac: open in Preview →
      <i>File → Export</i> → Quartz Filter <i>Reduce File Size</i>.</li>
    <li>Or leave the photos out of the Proposal and attach a few as separate <b>Photo</b> files.</li>
  </ul><p><a href="/proposal-guide" target="_blank" rel="noopener">Full guide: preparing your Proposal file</a></p></details>`;

/** Add a file row to `container`. Returns the row; row.check() re-validates (true = OK or empty). */
export function addFileRow(container, tags, tag) {
  const row = document.createElement('div');
  const line = document.createElement('div');
  line.className = 'filerow';
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT });
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'What is this file?');
  tags.forEach(t => sel.add(new Option(t === 'ESSPP' ? 'ESSPP (Proposal)' : t, t, false, t === tag)));
  const note = Object.assign(document.createElement('div'), { className: 'filenote' });
  note.setAttribute('role', 'status');
  line.append(input, sel);
  row.append(line, note);
  row.check = () => {
    const f = input.files[0];
    if (!f) { note.innerHTML = ''; return true; }
    const p = fileProblem(f);
    if (!p) { note.className = 'filenote muted'; note.textContent = sizeText(f.size); return true; }
    note.className = 'filenote err';
    note.textContent = p;
    if (f.size > MAX_MB * 1024 * 1024) note.insertAdjacentHTML('beforeend', SHRINK_HELP);
    return false;
  };
  input.addEventListener('change', row.check);
  row.file = () => input.files[0];
  row.tag = () => sel.value;
  container.append(row);
  return row;
}

/** Chosen files of a container: [{file, tag}]; and whether every row passes. */
export function chosenFiles(container) {
  const rows = [...container.children].filter(r => r.check);
  const ok = rows.map(r => r.check()).every(Boolean);
  return { ok, files: rows.map(r => ({ file: r.file(), tag: r.tag() })).filter(x => x.file) };
}

export function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    r.readAsDataURL(file);
  });
}

/** Progress text for one upload; warns that big files take a while on a phone. */
export const uploadText = (i, n, file) =>
  `Uploading file ${i + 1} of ${n}: ${file.name} (${sizeText(file.size)})…` + (file.size > 5 * 1024 * 1024 ? ' This can take a minute.' : '');
