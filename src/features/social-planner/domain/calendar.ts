/** Calendar math in the viewer's local time zone. Pure functions. */

export type WeekStart = 0 | 1; // Sunday | Monday

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const keyToDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const isSameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

export function startOfWeek(d: Date, weekStart: WeekStart): Date {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStart + 7) % 7;
  return addDays(s, -diff);
}

/** Full weeks covering the month (5 or 6 rows). */
export function monthGrid(anchor: Date, weekStart: WeekStart): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = startOfWeek(first, weekStart);
  const days: Date[] = [];
  for (let d = start; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  return days;
}

export function weekDays(anchor: Date, weekStart: WeekStart): Date[] {
  const s = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function weekdayLabels(weekStart: WeekStart, style: 'short' | 'narrow' = 'short'): string[] {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: style });
  const sunday = new Date(2024, 0, 7); // a Sunday
  return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(sunday, (i + weekStart) % 7)));
}

/** Range to request from the API for the visible period (whole days, local). */
export function visibleRange(view: 'month' | 'week' | 'list', anchor: Date, weekStart: WeekStart): { from: Date; to: Date } {
  if (view === 'week') {
    const days = weekDays(anchor, weekStart);
    return { from: days[0], to: new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate(), 23, 59, 59, 999) };
  }
  const days = monthGrid(anchor, weekStart);
  const end = days[days.length - 1];
  return { from: days[0], to: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999) };
}

export function periodLabel(view: 'month' | 'week' | 'list', anchor: Date, weekStart: WeekStart): string {
  if (view === 'week') {
    const d = weekDays(anchor, weekStart);
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    // formatRange collapses shared parts: "Oct 18 – 24, 2026".
    const range = (fmt as any).formatRange;
    return typeof range === 'function' ? range.call(fmt, d[0], d[6]) : `${fmt.format(d[0])} – ${fmt.format(d[6])}`;
  }
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor);
}

export function formatTime(iso: string, hour12: boolean): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).format(new Date(iso));
}

export function formatDayLong(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

export function formatDateTime(iso: string, hour12: boolean): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12 }).format(new Date(iso));
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Moves a post to another day, keeping its time of day. */
export function moveToDay(iso: string, day: Date): string {
  const src = new Date(iso);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), src.getHours(), src.getMinutes()).toISOString();
}

/** Default time for a new post on a given day: the default hour, or the next half hour if that's in the past today. */
export function defaultSlot(day: Date, defaultHour: number, now = new Date()): string {
  const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), defaultHour, 0);
  if (slot.getTime() > now.getTime() + 5 * 60_000) return slot.toISOString();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 60);
  if (isSameDay(next, day) || day < now) return next.toISOString();
  return slot.toISOString();
}
