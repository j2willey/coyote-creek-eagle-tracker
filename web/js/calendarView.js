// Read-only month/list calendar for the Scout and unit pages (FullCalendar, loaded only when a calendar is shown).
// mountCalendar(el, events, { onPick(key) }) -> { setEvents(events), select(key) }.
// events: [{ id, title, start (ms), end (ms), color?, extendedProps? }]
import { CDN_SCRIPTS } from './cdnIntegrity.js'; // URL + Subresource Integrity hash
const FC = CDN_SCRIPTS.fullCalendar;
let loading = null;
export function loadFullCalendar() {
  if (globalThis.FullCalendar) return Promise.resolve(globalThis.FullCalendar);
  if (!loading) loading = new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: FC.url, integrity: FC.integrity, crossOrigin: 'anonymous', async: true });
    s.onload = () => resolve(globalThis.FullCalendar);
    s.onerror = () => { loading = null; reject(new Error('The calendar could not be loaded. Use the list instead.')); };
    document.head.append(s);
  });
  return loading;
}

export async function mountCalendar(el, events, { onPick } = {}) {
  const FC = await loadFullCalendar();
  const narrow = window.matchMedia('(max-width: 40rem)').matches;
  let selected = null;
  const cal = new FC.Calendar(el, {
    initialView: narrow ? 'listMonth' : 'dayGridMonth',
    initialDate: events.length ? new Date(events[0].start) : new Date(),
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
    buttonText: { today: 'Today', month: 'Month', list: 'List' },
    height: 'auto', fixedWeekCount: false, eventDisplay: 'block', displayEventEnd: false,
    noEventsContent: 'Nothing this month',
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      if (onPick) { onPick(info.event.id); select(info.event.id); }
    }
  });
  const toFc = (e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, backgroundColor: e.color, borderColor: e.color,
    textColor: e.textColor || '#fff', extendedProps: e.extendedProps || {} });
  function setEvents(list) { cal.removeAllEvents(); list.forEach(e => cal.addEvent(toFc(e))); if (list.length) cal.gotoDate(new Date(list[0].start)); }
  function select(id) {
    selected = id;
    cal.getEvents().forEach(ev => ev.setProp('classNames', ev.id === selected ? ['picked'] : []));
  }
  events.forEach(e => cal.addEvent(toFc(e)));
  cal.render();
  return { setEvents, select };
}
