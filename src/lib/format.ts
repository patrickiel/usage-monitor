import type { LimitBar } from '../providers/types';

/** Time until `date`, rounded to a single unit: "5d", "3h", "9m". */
export function countdown(date: Date, now: number): string {
  const mins = Math.max(0, Math.round((date.getTime() - now) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 23.5 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

/** A window whose reset time has passed has reset: show it empty (cached data can outlive it). */
export function current(bar: LimitBar, now: number): LimitBar {
  return bar.resetsAt && bar.resetsAt.getTime() <= now ? { label: bar.label, percent: 0 } : bar;
}

/** Bars split into as few columns as fit `rows` each, balanced (4 in 3 rows: 2/2, not 3/1). */
export function columns(bars: LimitBar[], rows: number): LimitBar[][] {
  const count = Math.ceil(bars.length / Math.max(1, rows));
  const out: LimitBar[][] = [];
  for (let c = 0, start = 0; c < count; c++) {
    // Earlier columns take the remainder, so heights differ by at most one.
    const size = Math.floor(bars.length / count) + (c < bars.length % count ? 1 : 0);
    out.push(bars.slice(start, (start += size)));
  }
  return out;
}

/** One word for why an update failed, short enough to sit under a provider icon. */
export function problem(error: string): string {
  if (/sign|token|api key|login/i.test(error)) return 'sign in';
  if (/rate limit|429/i.test(error)) return 'limited';
  if (/offline|network|fetch/i.test(error)) return 'offline';
  return 'error';
}

/** Time since `date`, e.g. "12s", "3m". */
export function ago(date: Date, now: number): string {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Share of the window already elapsed (0–100), or null if unknown. */
export function pace(bar: LimitBar, now: number): number | null {
  if (!bar.resetsAt || !bar.windowSeconds) return null;
  const left = (bar.resetsAt.getTime() - now) / 1000;
  return Math.min(100, Math.max(0, 100 - (left / bar.windowSeconds) * 100));
}

export type Severity = 'ok' | 'warn' | 'crit';

export function severity(percent: number): Severity {
  return percent >= 90 ? 'crit' : percent >= 70 ? 'warn' : 'ok';
}

/**
 * Pace marker color, blended continuously from the usage projected to the end of the window:
 * sky at 0%, violet at 100% (on track to hit the limit exactly), pink at 130%+.
 * Early in a window the projection is noise, so it only counts after 10% has elapsed.
 */
export function paceColor(percent: number, elapsed: number): string {
  const projected = elapsed < 10 ? 0 : (percent / elapsed) * 100;
  const t = (from: number, to: number) => Math.round(Math.min(1, Math.max(0, (projected - from) / (to - from))) * 100);
  return projected <= 100
    ? `color-mix(in oklch, var(--pace-warn) ${t(0, 100)}%, var(--pace-ok))`
    : `color-mix(in oklch, var(--pace-crit) ${t(100, 130)}%, var(--pace-warn))`;
}

/** CSS variables defined in app.css, so they follow the theme. */
export const barColors: Record<Severity, string> = {
  ok: 'var(--sev-ok)',
  warn: 'var(--sev-warn)',
  crit: 'var(--sev-crit)',
};
