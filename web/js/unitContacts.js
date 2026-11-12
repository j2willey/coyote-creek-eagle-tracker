// Unit meetings + contacts (committee: /committee/units; unit contacts: the unit page). Server rules: lib/unitDirectory.js.
// Meetings (Jim W., 2026-11-01): one record per unit, every field always shown, ✎ Edit → Save; never added or deleted.
// Contacts: ONE list. The Unit Leader and Committee Chair (from Council's Key 3) come first and only the committee may
// edit them (never remove); everyone else: edit, remove, add.
import { api } from './api.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const MEETING_FIELDS = [['day', 'Day', 'e.g. Tuesday', 'ucDays'], ['time', 'Time', 'e.g. 7:00–8:30 PM'], ['frequency', 'How often', 'e.g. Weekly', 'ucFreq'],
  ['location', 'Location', 'e.g. St. Mark\'s Church, Room 4'], ['address', 'Address', 'Street, city'], ['notes', 'Notes', 'Parking, which door, summer schedule…']];

/**
 * root: the contacts panel. meetingRoot (optional): where the meeting block goes (the unit page puts it in its own card at
 * the top); without it the meeting block heads the panel.
 */
export function mountUnitContacts(root, { session, unit, onChange = () => {}, meetingRoot = null, titles = null }) {
  let d = null, editing = null;   // editing: 'k<row>' | 'c<row>' | 'new' | 'meeting'
  const msg = el('p', { role: 'status' });
  const meetMsg = el('p', { role: 'status' });
  const say = (t, c) => { msg.textContent = t; msg.className = c || ''; };
  const sayMeet = (t, c) => { (meetingRoot ? meetMsg : msg).textContent = t; (meetingRoot ? meetMsg : msg).className = c || ''; };

  // ---------- meetings ----------
  function meetingBlock() {
    const m = d.meeting || {};
    if (editing === 'meeting') {
      const boxes = {};
      const fields = MEETING_FIELDS.map(([key, label, ph, list]) => {
        const i = key === 'notes' ? el('textarea', { value: m.notes || '', rows: 3, placeholder: ph, title: label })
          : el('input', { value: m[key] || '', placeholder: ph, title: label });
        if (list) i.setAttribute('list', list);
        boxes[key] = i;
        return el('label', { className: 'mtfield' + (key === 'notes' ? ' mtwide' : '') }, el('span', { className: 'muted', textContent: label }), i);
      });
      const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
      const cancel = el('button', { type: 'button', textContent: 'Cancel' });
      cancel.onclick = () => { editing = null; render(); };
      save.onclick = async () => {
        save.disabled = true; sayMeet('Saving…', 'muted');
        const out = {};
        Object.keys(boxes).forEach(k => { out[k] = boxes[k].value; });
        try {
          const r = await api('unitMeetingSave', { session, unit, orig: m, fields: out });
          editing = null; await load(); sayMeet(r.message, 'ok'); onChange();
        } catch (e) { sayMeet(e.message, 'err'); save.disabled = false; }
      };
      return el('div', { className: 'ucform meeting' }, ...fields, el('div', { className: 'actions' }, save, cancel));
    }
    const edit = el('button', { type: 'button', className: 'obbtn', textContent: '✎ Edit', title: 'Edit the meeting information' });
    edit.onclick = () => { editing = 'meeting'; say(''); sayMeet(''); render(); };
    const value = (key) => {
      const v = m[key] || '';
      if (!v) return el('span', { className: 'muted', textContent: '—' });
      if (key === 'address') return el('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v), target: '_blank', rel: 'noopener', textContent: v });
      return el('span', { className: key === 'notes' ? 'mtnotes' : '', textContent: v });
    };
    return el('div', { className: 'ucrow meeting' },
      el('dl', { className: 'mtlist' }, ...MEETING_FIELDS.flatMap(([key, label]) => [el('dt', { textContent: label }), el('dd', {}, value(key))])),
      el('div', { className: 'ucbtns' }, edit));
  }

  // ---------- Eagle Scouts to date (own Edit/Save, 2026-11-01): blank = unknown; "Eagle earned" adds 1 ----------
  function eaglesBlock() {
    const cur = d.eagles == null ? '' : String(d.eagles);
    const year = d.eaglesThisYear == null ? '' : 'This year: ' + d.eaglesThisYear;
    if (editing === 'eagles') {
      const box = el('input', { value: cur, inputMode: 'numeric', placeholder: 'e.g. 110', title: 'Eagle Scouts to date', style: 'max-width:8rem' });
      const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
      const cancel = el('button', { type: 'button', textContent: 'Cancel' });
      cancel.onclick = () => { editing = null; render(); };
      save.onclick = async () => {
        save.disabled = true; sayMeet('Saving…', 'muted');
        try { const r = await api('unitEaglesSave', { session, unit, orig: cur, value: box.value }); editing = null; await load(); sayMeet(r.message, 'ok'); onChange(); }
        catch (e) { sayMeet(e.message, 'err'); save.disabled = false; }
      };
      return el('div', { className: 'ucform meeting' },
        el('label', { className: 'mtfield mtwide' }, el('span', { className: 'muted', textContent: 'Eagle Scouts to date (all time; leave blank if you don\'t know)' }), box),
        el('div', { className: 'actions' }, save, cancel));
    }
    const edit = el('button', { type: 'button', className: 'obbtn', textContent: '✎ Edit', title: 'Edit the number of Eagle Scouts' });
    edit.onclick = () => { editing = 'eagles'; say(''); sayMeet(''); render(); };
    return el('div', { className: 'ucrow meeting' },
      el('dl', { className: 'mtlist' }, el('dt', { textContent: 'Eagle Scouts to date' }),
        el('dd', {}, cur ? el('b', { textContent: cur }) : el('span', { className: 'muted', textContent: '— (not known yet)' }), year ? el('span', { className: 'muted', textContent: ' · ' + year }) : ''),
        el('dt', { textContent: '' }), el('dd', { className: 'muted', textContent: 'Goes up by one each time a Scout from the unit earns Eagle, and is used to tell the new Eagle Scout their number.' })),
      el('div', { className: 'ucbtns' }, edit));
  }

  // ---------- contacts ----------
  function form(kind, x) {
    const f = el('div', { className: 'ucform' });
    const inp = (ph, v, type = 'text') => el('input', { placeholder: ph, value: v || '', type, title: ph });
    const role = kind === 'key3' ? null : inp('Role', x.role);
    if (role) role.setAttribute('list', 'ucRoles');
    const name = inp('Name', x.name), email = inp('Email', x.email, 'email'), phone = inp('Phone', x.phone, 'tel');
    const note = kind === 'key3' ? null : inp('Note (optional)', x.note);
    // The Unit Leader's mailing address (Key 3 row; filled into the Advancement Report on the EBoR paperwork page)
    const leaderAddr = kind === 'key3' && x.role === 'Unit Leader';
    const addr = leaderAddr ? inp('Street address (optional)', x.address) : null;
    const city = leaderAddr ? inp('City', x.city) : null;
    const state = leaderAddr ? inp('State', x.state) : null;
    const zip = leaderAddr ? inp('Zip', x.zip) : null;
    if (state) state.maxLength = 2;
    if (zip) zip.maxLength = 10;
    const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    cancel.onclick = () => { editing = null; render(); };
    save.onclick = async () => {
      save.disabled = true; say('Saving…', 'muted');
      try {
        const r = await api('unitContactSave', { session, unit, kind, row: x.row || 0, orig: { name: x.name || '', email: x.email || '' },
          fields: { role: role ? role.value : x.role, name: name.value, email: email.value, phone: phone.value, note: note ? note.value : '',
            ...(leaderAddr ? { address: addr.value, city: city.value, state: state.value, zip: zip.value } : {}) } });
        editing = null; await load(); say(r.message, 'ok'); onChange();
      } catch (e) { say(e.message, 'err'); save.disabled = false; }
    };
    f.append(...(role ? [role] : [el('b', { textContent: x.role })]), name, email, phone, ...(note ? [note] : []),
      ...(leaderAddr ? [el('div', { className: 'ucaddr' }, addr, city, state, zip)] : []),
      el('div', { className: 'actions' }, save, cancel));
    return f;
  }

  function line(kind, x) {
    const id = (kind === 'key3' ? 'k' : 'c') + x.row;
    if (editing === id) return form(kind, x);
    const canEdit = kind === 'contact' || d.canEditKey3;
    const row = el('div', { className: 'ucrow' + (String(x.role).toLowerCase() === 'exclude' ? ' excl' : '') },
      el('div', { className: 'ucmain' }, el('b', { textContent: x.role }), x.position && x.position !== x.role ? el('span', { className: 'muted', textContent: ' · ' + x.position }) : '',
        el('div', {}, x.name || el('span', { className: 'muted', textContent: '(no name)' }), x.email ? ' · ' : '',
          x.email ? el('a', { href: 'mailto:' + x.email, textContent: x.email }) : el('span', { className: 'err', textContent: ' no email' }),
          x.phone ? ' · ' + x.phone : ''),
        x.address || x.city ? el('div', { className: 'muted', textContent: [x.address, [x.city, x.state].filter(Boolean).join(', '), x.zip].filter(Boolean).join(' · ') }) : '',
        x.note ? el('div', { className: 'muted', textContent: x.note }) : ''));
    const btns = el('div', { className: 'ucbtns' });
    if (canEdit) {
      const e = el('button', { type: 'button', className: 'obbtn', textContent: '✎ Edit' });
      e.onclick = () => { editing = id; say(''); render(); };
      btns.append(e);
    }
    if (kind === 'contact') {
      const del = el('button', { type: 'button', className: 'obbtn danger', textContent: 'Remove' });
      del.onclick = async () => {
        if (!window.confirm('Remove ' + (x.name || x.email) + ' (' + x.role + ') from ' + d.unit + '\'s contacts?')) return;
        del.disabled = true; say('Removing…', 'muted');
        try { const r = await api('unitContactDelete', { session, unit, row: x.row, orig: { name: x.name, email: x.email } }); await load(); say(r.message, 'ok'); onChange(); }
        catch (err) { say(err.message, 'err'); del.disabled = false; }
      };
      btns.append(del);
    }
    row.append(btns);
    return row;
  }

  function render() {
    if (!d) return;
    const lists = [el('datalist', { id: 'ucRoles' }, ...(d.roles || []).map(r => el('option', { value: r }))),
      el('datalist', { id: 'ucDays' }, ...(d.days || []).map(r => el('option', { value: r }))),
      el('datalist', { id: 'ucFreq' }, ...(d.frequencies || []).map(r => el('option', { value: r })))];
    const add = el('button', { type: 'button', textContent: '+ Add a contact' });
    add.onclick = () => { editing = 'new'; say(''); render(); };
    const people = d.key3.map(x => line('key3', x)).concat(d.contacts.map(x => line('contact', x)));
    // The unit page's cards carry the titles ("C967 Meetings" / "C967 Contacts") and the explanation (Jim W., 2026-11-01).
    const contacts = [
      ...(meetingRoot ? [] : [el('h4', { className: 'uchead', textContent: 'Unit contacts' })]),
      ...(people.length ? people : [el('p', { className: 'muted', textContent: 'None yet.' })]),
      editing === 'new' ? form('contact', { role: '', name: '', email: '', phone: '', note: '' }) : el('p', {}, add),
      msg];
    if (meetingRoot) {
      if (titles && titles.meeting) titles.meeting.textContent = d.unit + ' Unit Info';
      if (titles && titles.contacts) titles.contacts.textContent = d.unit + ' Contacts';
      meetingRoot.replaceChildren(lists[1], lists[2], meetingBlock(), eaglesBlock(), meetMsg);
      root.replaceChildren(lists[0], ...contacts);
    } else {
      root.replaceChildren(...lists, el('h3', { textContent: d.unit + (d.underReview ? ' · under review' : '') }),
        el('h4', { className: 'uchead', textContent: 'Unit meetings' }), meetingBlock(), eaglesBlock(), ...contacts);
    }
  }

  async function load() {
    d = await api('unitContactsGet', { session, unit });
    render();
  }
  root.replaceChildren(el('p', { className: 'muted', textContent: 'Loading…' }));
  if (meetingRoot) meetingRoot.replaceChildren(el('p', { className: 'muted', textContent: 'Loading…' }));
  load().catch(e => { root.replaceChildren(el('p', { className: 'err', textContent: e.message })); if (meetingRoot) meetingRoot.replaceChildren(); });
  return { reload: load };
}
