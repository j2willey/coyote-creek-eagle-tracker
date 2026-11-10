// The Outbox (emails a committee member caused, waiting for review), shared by /committee/outbox and the
// Outbox popup on the schedule page. mountOutbox(root, {session, onCount}) -> { open(focusId) }.
// Emails with attachments (signed Proposal, EBoR scans, photos) are sent with the files from cc-advancement, Reply-To the
// member who clicks Send (so a "please rescan" reaches them), Cc the committee. Download stays for sending by hand.
import { api } from './api.js';
import { ACCEPT, fileProblem, readBase64, sizeText } from './files.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const nice = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const OB_TABS = { waiting: ['Pending', 'Scheduled'], sent: ['Sent', 'Sent by member'], discarded: ['Discarded'] };
const pad2 = (n) => String(n).padStart(2, '0');
const localInput = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const TAB_LABEL = { waiting: 'Outbox', sent: 'Sent', discarded: 'Discarded' };

// Google Groups reject a message over 8 MB, counted encoded (attachments + about a third): the group's copy bounces,
// everyone else gets it (2026-11-04). Same rule as Outbox.groupSize in lib/outbox.js.
const GROUP_LIMIT = 8 * 1000 * 1000;
export function groupSize(fileBytes, to, cc, groups) {
  const list = (to + ',' + cc).split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@'));
  const known = (groups || []).map(g => String(g).toLowerCase()).filter(Boolean);
  const hit = list.filter((e, i) => list.indexOf(e) === i && (known.includes(e) || /@googlegroups\.com$/.test(e)));
  const est = Math.round((Number(fileBytes) || 0) * 4 / 3 + 60 * 1000);
  const level = !hit.length || !(fileBytes > 0) ? '' : est > GROUP_LIMIT ? 'over' : est > GROUP_LIMIT * 0.8 ? 'near' : '';
  return { level, mb: Math.round(est / 100000) / 10, groups: hit };
}

export function mountOutbox(root, { session, onCount = () => {} }) {
  let items = [], sel = null, tab = 'waiting';
  const tabs = el('div', { className: 'obtabs', role: 'tablist' });
  const list = el('div', { className: 'oblist' });
  const pane = el('div', {}, el('p', { className: 'muted', textContent: 'Pick an email on the left.' }));
  root.replaceChildren(
    el('p', { className: 'hint', textContent: 'Emails committee members caused (a review outcome, moving a row, a status email, booking or ' +
      'cancelling for a Scout) wait here. Check them, then send, send from your own email, or discard. Every choice goes into the ' +
      'Scout\'s Life to Eagle Log. Send later schedules it (sent within the hour after the time you pick). Reply to "Me only": the Scout\'s reply comes to you instead of the committee group.' }),
    tabs, el('div', { className: 'ob' }, list, pane));
  Object.keys(OB_TABS).forEach(k => {
    const b = el('button', { type: 'button', role: 'tab', className: 'obtab', textContent: TAB_LABEL[k] });
    b.dataset.tab = k;
    b.onclick = () => { tab = k; sel = null; showTab(); };
    tabs.append(b);
  });
  const inTab = (x) => OB_TABS[tab].includes(x.status);

  function showTab() {
    tabs.querySelectorAll('.obtab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
      const n = items.filter(x => OB_TABS[b.dataset.tab].includes(x.status)).length;
      b.textContent = TAB_LABEL[b.dataset.tab] + (n ? ' (' + n + ')' : '');
    });
    renderList();
    const first = items.find(inTab);
    if (sel && items.some(x => x.id === sel && inTab(x))) select(sel);
    else if (first && tab === 'waiting') select(first.id);
    else pane.replaceChildren(el('p', { className: 'muted', textContent:
      tab === 'waiting' ? (first ? 'Pick an email on the left.' : 'Nothing waiting. 🎉') : (first ? 'Pick an email on the left.' : 'None yet.') }));
  }

  let me = '', groups = [];
  async function open(focusId) {
    list.replaceChildren(el('p', { className: 'muted', textContent: 'Loading…' }));
    try {
      const r = await api('outboxList', { session });
      items = r.items; me = r.me || ''; groups = r.groups || [];
      onCount(items.filter(x => x.status === 'Pending').length);
      const focus = items.find(x => x.id === focusId);
      if (focus) { tab = Object.keys(OB_TABS).find(k => OB_TABS[k].includes(focus.status)) || 'waiting'; sel = focus.id; }
      else if (!focusId) sel = null;
      showTab();
    } catch (e) { list.replaceChildren(el('p', { className: 'err', textContent: e.message })); throw e; }
  }

  function renderList() {
    const xs = items.filter(inTab);
    list.replaceChildren(...(xs.length ? xs.map(x => {
      const b = el('button', { type: 'button', className: 'obitem' + (sel === x.id ? ' sel' : '') },
        ...(tab === 'waiting' ? (x.status === 'Scheduled' ? [el('div', { className: 'st Scheduled', textContent: '⏰ ' + nice(x.sendAt) })] : [])
          : [el('div', { className: 'st ' + x.status, textContent: x.status + (x.doneBy ? ' · ' + x.doneBy : '') })]),
        el('div', {}, el('b', { textContent: x.scout || '(no Scout)' })),
        el('div', { textContent: x.template + (x.attachments && x.attachments.length ? ' 📎' : '') }),
        ...(x.eventAt ? [el('div', { textContent: 'Session ' + nice(x.eventAt) })] : []),
        el('div', { className: 'muted', textContent: 'drafted ' + new Date(x.created).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) +
          (x.createdBy ? ' · ' + x.createdBy : '') }));
      b.onclick = () => select(x.id);
      return b;
    }) : [el('p', { className: 'muted', textContent: tab === 'waiting' ? 'Nothing waiting.' : 'None yet.' })]));
  }

  const field = (label, id, value) => [el('label', { htmlFor: id, textContent: label }), el('input', { id, value })];

  async function download(x, i, say) {
    say('Downloading…', 'muted');
    try {
      const r = await api('outboxAttachment', { session, id: x.id, index: i });
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = el('a', { href: url, download: r.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say('Downloaded ' + r.name + '. Attach it to your email.', 'ok');
    } catch (e) { say(e.message, 'err'); }
  }

  function select(id) {
    sel = id; renderList();
    const x = items.find(i => i.id === id);
    if (!x) return;
    const att = x.attachments || [];
    if (x.status === 'Scheduled') {
      const msg = el('p', { role: 'status' });
      const un = el('button', { type: 'button', textContent: 'Unschedule (back to the Outbox)' });
      un.onclick = async () => {
        try { const r = await api('outboxUnschedule', { session, id: x.id }); msg.textContent = r.message; msg.className = 'ok'; await open(x.id); }
        catch (e) { msg.textContent = e.message; msg.className = 'err'; }
      };
      const prev = el('div', { id: 'obBody' }); prev.innerHTML = x.html || '';
      pane.replaceChildren(el('h3', { textContent: x.subject }),
        el('p', { className: 'ok', textContent: '⏰ Scheduled for ' + nice(x.sendAt) + (x.scheduledBy ? ' by ' + x.scheduledBy : '') + ' (sent within the hour after that).' }),
        el('p', { className: 'muted', textContent: 'To: ' + x.to + (x.cc ? ' · Cc: ' + x.cc : '') + (att.length ? ' · 📎 ' + att.join(', ') : '') }),
        prev, msg, el('div', { className: 'actions' }, un));
      return;
    }
    if (x.status !== 'Pending') {
      // Discarded by mistake → Restore; sent → Draft again (a copy in the Outbox, to edit and send).
      const msg2 = el('p', { role: 'status' });
      const act = (label, action, cls) => { const b = el('button', { type: 'button', className: cls || '', textContent: label });
        b.onclick = async () => { b.disabled = true; msg2.textContent = 'Working…'; msg2.className = 'muted';
          try { const r = await api(action, { session, id: x.id }); tab = 'waiting'; await open(r.id || x.id); }
          catch (e) { msg2.textContent = e.message; msg2.className = 'err'; b.disabled = false; } };
        return b; };
      pane.replaceChildren(el('h3', { textContent: x.subject }),
        el('p', { textContent: x.status + (x.doneBy ? ' by ' + x.doneBy : '') + (x.done ? ' · ' + nice(x.done) : '') }),
        el('p', { className: 'muted', textContent: 'To: ' + x.to + (x.cc ? ' · Cc: ' + x.cc : '') + (att.length ? ' · 📎 ' + att.join(', ') : '') +
          (x.eventAt ? ' · session ' + nice(x.eventAt) : '') }),
        el('div', { className: 'actions' },
          ...(x.status === 'Discarded' ? [act('Restore to Outbox', 'outboxRestore', 'primary')] : []),
          act(x.status === 'Discarded' ? 'Draft a copy' : 'Draft again', 'outboxCopy')), msg2);
      return;
    }
    const body = el('div', { id: 'obBody', contentEditable: 'true' });
    body.innerHTML = x.html;
    const cmd = (c, v) => () => { body.focus(); document.execCommand(c, false, v); };
    const tb = (html, title, fn) => Object.assign(el('button', { type: 'button', innerHTML: html, title }), { onclick: fn });
    const bar = el('div', { className: 'rte-bar' },
      tb('<b>B</b>', 'Bold', cmd('bold')), tb('<i>I</i>', 'Italic', cmd('italic')), tb('<u>U</u>', 'Underline', cmd('underline')),
      tb('• List', 'Bulleted list', cmd('insertUnorderedList')), tb('Red', 'Red text', cmd('foreColor', '#c00000')),
      tb('Link', 'Link', () => { const u = prompt('Link address (https://…)'); if (u) cmd('createLink', u)(); }));
    const msg = el('p', { role: 'status' });
    const say = (t, c) => { msg.textContent = t; msg.className = c; };
    const vals = () => ({ to: pane.querySelector('#obTo').value, cc: pane.querySelector('#obCc').value,
      subject: pane.querySelector('#obSubj').value, html: body.innerHTML, text: body.innerText, replyTo: reply.checked ? 'me' : 'group' });
    // Toggle: replies come to me (e.g. to settle a Pre-Review Call time with the Scout) instead of the committee group.
    const reply = el('input', { type: 'checkbox', id: 'obReply' });
    reply.checked = (x.replyTo || (att.length ? 'me' : 'group')) === 'me';
    const hasAtt = () => (x.attachments || []).length > 0;
    const replyRow = el('div', { className: 'replyrow' }, el('b', { textContent: 'Reply to: ' }),
      el('label', { className: 'choice', htmlFor: 'obReply', title: 'Off: replies go to the committee group. On: replies go only to you' + (me ? ' (' + me + ')' : '') + '.' },
        reply, 'Me only'));
    const done = async (r) => { say(r.message, 'ok'); await open(); };

    const send = el('button', { type: 'button', className: 'primary', textContent: 'Send' });
    send.onclick = async () => {
      if (sizeLevel === 'over' && !confirm('This email is too big for the Google Group: the group\'s copy will bounce, everyone else still gets it. Send anyway?')) return;
      send.disabled = true; say('Sending…', 'muted');
      try { await done(await api('outboxSend', { session, id: x.id, ...vals() })); } catch (e) { say(e.message, 'err'); }
      send.disabled = false;
    };
    const gmail = el('button', { type: 'button', textContent: 'Open in Gmail' });
    gmail.onclick = () => {
      const v = vals();
      const u = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(v.to) + '&cc=' + encodeURIComponent(v.cc) +
        '&su=' + encodeURIComponent(v.subject) + '&body=' + encodeURIComponent(v.text);
      window.open(u, '_blank', 'noopener');
      say('Gmail opened with plain text (use "Copy formatted" and paste over the body to keep bold/colours).' +
        (hasAtt() ? ' Attach the files (Download).' : '') + ' When you have sent it, click "I sent it".', 'muted');
    };
    const copy = el('button', { type: 'button', textContent: 'Copy formatted' });
    copy.onclick = async () => {
      const v = vals();
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([v.html], { type: 'text/html' }), 'text/plain': new Blob([v.text], { type: 'text/plain' }) })]);
      } catch {
        const rng = document.createRange(); rng.selectNodeContents(body);
        const s = getSelection(); s.removeAllRanges(); s.addRange(rng); document.execCommand('copy'); s.removeAllRanges();
      }
      say('Copied. Paste it into your email' + (hasAtt() ? ', attach the files (Download)' : '') + ', then click "I sent it".', 'ok');
    };
    const mine = el('button', { type: 'button', textContent: 'I sent it' });
    mine.onclick = async () => {
      if (!confirm('Mark this email as sent from your own email account?')) return;
      try { const v = vals(); await done(await api('outboxSentByMe', { session, id: x.id, to: v.to, cc: v.cc, subject: v.subject })); } catch (e) { say(e.message, 'err'); }
    };
    const discard = el('button', { type: 'button', className: 'danger', textContent: 'Discard' });
    discard.onclick = async () => {
      if (!confirm('Discard this email? It will not be sent (a line goes into the Scout\'s log).')) return;
      try { await done(await api('outboxDiscard', { session, id: x.id })); } catch (e) { say(e.message, 'err'); }
    };
    // Send later: quick choices relative to the session (EBoR reminders), or any date and time.
    const when = el('input', { type: 'datetime-local', value: x.choices && x.choices.length ? localInput(x.choices[x.choices.length - 1].at) : '' });
    const sched = async (at) => {
      say('Scheduling…', 'muted');
      try { await done(await api('outboxSchedule', { session, id: x.id, at, ...vals() })); } catch (e) { say(e.message, 'err'); }
    };
    const later = el('div', { className: 'sendlater' }, el('span', { className: 'muted', textContent: 'Send later:' }),
      ...(x.choices || []).map(c => Object.assign(el('button', { type: 'button', textContent: c.label + ' (' + nice(c.at) + ')' }), { onclick: () => sched(c.at) })),
      when, Object.assign(el('button', { type: 'button', textContent: 'Schedule' }), { onclick: () => sched(when.value ? new Date(when.value).getTime() : 0) }));
    // Attachments: Download, ✕ to take one off, "Attach a file" (the committee chair, 2026-11-02: e.g. a denial letter). Only the
    // attachment row redraws, so edits to the body, To, Cc and Subject are kept.
    const picker = el('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true });
    const attRow = el('div', { className: 'obatt' });
    const setAtt = (names, sizes) => { x.attachments = names; x.attachSizes = sizes || []; drawAtt(); renderList(); };
    // Size warning (Google Groups: 8 MB): recomputed when files or To / Cc change.
    const sizeWarn = el('p', { role: 'status', className: 'sizewarn', hidden: true });
    const totalBytes = () => (x.attachSizes || []).reduce((t, n) => t + (Number(n) || 0), 0);
    let sizeLevel = '';
    function checkSize() {
      const g = groupSize(totalBytes(), pane.querySelector('#obTo') ? pane.querySelector('#obTo').value : x.to,
        pane.querySelector('#obCc') ? pane.querySelector('#obCc').value : x.cc, groups);
      sizeLevel = g.level;
      sizeWarn.hidden = !g.level;
      sizeWarn.className = 'sizewarn ' + (g.level === 'over' ? 'err' : 'warn');
      sizeWarn.textContent = !g.level ? '' : (g.level === 'over' ? '⚠ Too big for the group: ' : '⚠ Close to the group limit: ') +
        'this email is about ' + g.mb + ' MB with its attachments. Google Groups (' + g.groups.join(', ') + ') reject emails over 8 MB' +
        (g.level === 'over' ? ': the group\'s copy will bounce (everyone else still gets it).' : '.') +
        ' Shrink or remove a file (Download, compress, ✕, then 📎 Attach), split it into two emails, or take the group off Cc.';
    }
    function drawAtt() {
      const a = x.attachments || [];
      send.title = a.length ? 'Sends the email with the attached files.' : '';
      const sizes = x.attachSizes || [];
      const addBtn = el('button', { type: 'button', textContent: '📎 Attach a file' });
      addBtn.onclick = () => picker.click();
      attRow.replaceChildren(
        ...a.flatMap((name, i) => {
          const d = el('button', { type: 'button', textContent: 'Download ' + name + (sizes[i] ? ' (' + sizeText(sizes[i]) + ')' : '') });
          d.onclick = () => download(x, i, say);
          const rm = el('button', { type: 'button', className: 'danger', textContent: '✕', title: 'Take ' + name + ' off this email (the file stays in Drive)' });
          rm.setAttribute('aria-label', 'Remove ' + name);
          rm.onclick = async () => {
            if (!confirm('Take ' + name + ' off this email?')) return;
            rm.disabled = true;
            try { const r = await api('outboxDetach', { session, id: x.id, index: i }); setAtt(r.attachments, r.attachSizes); say(r.message, 'ok'); }
            catch (e) { say(e.message, 'err'); rm.disabled = false; }
          };
          return [el('span', { className: 'obfile' }, d, rm)];
        }),
        addBtn, picker,
        el('span', { className: 'hint', textContent: a.length ? a.length + ' file' + (a.length > 1 ? 's' : '') + (totalBytes() ? ', ' + sizeText(totalBytes()) : '') +
          ' attached. Send includes them.' : 'PDF, DOCX, PPTX, JPG or PNG; under about 6 MB in all if the committee group is copied.' }));
      checkSize();
    }
    picker.onchange = async () => {
      const files = [...picker.files];
      picker.value = '';
      const bad = files.map(fileProblem).filter(Boolean);
      if (bad.length) { say(bad.join(' '), 'err'); return; }
      for (const [i, f] of files.entries()) {
        say('Uploading ' + (files.length > 1 ? (i + 1) + ' of ' + files.length + ': ' : '') + f.name + ' (' + sizeText(f.size) + ')…', 'muted');
        try { const r = await api('outboxAttach', { session, id: x.id, name: f.name, data: await readBase64(f) }); setAtt(r.attachments, r.attachSizes); say(r.message, 'ok'); }
        catch (e) { say(e.message, 'err'); return; }
      }
    };
    drawAtt();
    pane.replaceChildren(
      el('p', { className: 'muted', textContent: x.template + ' · ' + (x.scout || '') + (x.createdBy ? ' · queued by ' + x.createdBy : '') +
        (x.eventAt ? ' · session ' + nice(x.eventAt) : '') }),
      ...(x.note ? [el('p', { className: 'err', textContent: x.note })] : []),
      ...field('To', 'obTo', x.to), ...field('Cc', 'obCc', x.cc), ...field('Subject', 'obSubj', x.subject), replyRow,
      attRow, sizeWarn, bar, body, msg,
      el('div', { className: 'actions' }, send, gmail, copy, mine, el('span', { className: 'spacer' }), discard), later);
    ['#obTo', '#obCc'].forEach(sel => pane.querySelector(sel).addEventListener('input', checkSize));
    checkSize();
  }

  return { open };
}
