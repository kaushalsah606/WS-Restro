export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function daysAgo(n: number, from: Date = new Date()): Date {
  const x = new Date(from);
  x.setDate(x.getDate() - n);
  return x;
}

/** Parse ISO / yyyy-MM-dd; returns undefined for blanks and invalid dates. */
export function parseDate(v?: string | Date | null): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** yyyy-MM-dd (UTC date part of a stored @db.Date) */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** HH:mm -> minutes since midnight */
export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export interface DateRangeQuery {
  startDate?: string;
  endDate?: string;
  period?: 'today' | 'week' | 'month' | 'quarter' | 'year';
}

/** Resolve startDate/endDate/period query params into a concrete [from, to] range. */
export function resolveRange(q: DateRangeQuery, defaultDays = 30): { from: Date; to: Date } {
  const to = parseDate(q.endDate) ?? new Date();
  let from = parseDate(q.startDate);
  if (!from) {
    const table: Record<string, number> = { today: 0, week: 6, month: 29, quarter: 89, year: 364 };
    const days = table[q.period ?? ''] ?? defaultDays - 1;
    from = startOfDay(daysAgo(days));
  }
  return { from, to };
}
