import type { LimitBar } from '../providers/types';

/** Time until `date`, compact: "3d4h", "2h14m", "5h", "9m". */
export function countdown(date: Date, now: number): string {
  const mins = Math.max(0, Math.round((date.getTime() - now) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const pair = (a: string, b: number, unit: string) => (b ? `${a}${b}${unit}` : a);
  if (d) return pair(`${d}d`, h, 'h');
  if (h) return pair(`${h}h`, m, 'm');
  return `${m}m`;
}

/** A window whose reset time has passed has reset: show it empty (cached data can outlive it). */
export function current(bar: LimitBar, now: number): LimitBar {
  return bar.resetsAt && bar.resetsAt.getTime() <= now ? { label: bar.label, percent: 0 } : bar;
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

/** CSS variables defined in app.css, so they follow the theme. */
export const barColors: Record<Severity, string> = {
  ok: 'var(--sev-ok)',
  warn: 'var(--sev-warn)',
  crit: 'var(--sev-crit)',
};
