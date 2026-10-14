import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
import { invoke } from '@tauri-apps/api/core';
import type { LimitBar, Provider, UsageSnapshot } from './types';

/**
 * The Gemini app (gemini.google.com), whose limits are separate from Antigravity's. There's no
 * API: Rust loads the usage page in a hidden webview (signed in through the settings button) and
 * returns its text, which reads like
 *
 *   Current usage · 100% used · Resets at 1:26 PM · Weekly limit · Resets Oct 20 at 3:26 PM · 7% used
 */

const FIVE_HOURS = 5 * 3600;
const WEEK = 7 * 86400;
const DAY_MS = 86400 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Resets at 1:26 PM", "Resets Oct 20 at 3:26 PM", "Resets tomorrow at 9 AM", "Resets in 2 hr 5 min". */
export function parseReset(line: string, now = new Date()): Date | undefined {
  const rel = line.match(/resets in\s+(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?/i);
  if (rel && (rel[1] || rel[2])) return new Date(now.getTime() + ((+(rel[1] ?? 0) * 60 + +(rel[2] ?? 0)) * 60000));

  const m = line.match(/resets\s+(?:(today|tomorrow)|([a-z]{3})[a-z]*\.?\s+(\d{1,2}))?[\s,]*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return undefined;
  const [, day, month, date, h, min, ampm] = m;
  const hour = ampm ? (+h % 12) + (/^p/i.test(ampm) ? 12 : 0) : +h;
  const d = new Date(now);
  d.setHours(hour, +(min ?? 0), 0, 0);
  if (month) {
    const i = MONTHS.indexOf(month.toLowerCase());
    if (i < 0) return undefined;
    d.setMonth(i, +date);
    // No year on the page: a date well in the past means next year's.
    if (d.getTime() < now.getTime() - DAY_MS) d.setFullYear(d.getFullYear() + 1);
  } else if (day?.toLowerCase() === 'tomorrow' || (!day && d <= now)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** The bar for the card titled `title`: its "N% used" and "Resets …" lines. */
function card(lines: string[], title: RegExp, label: string, windowSeconds: number): LimitBar | [] {
  const start = lines.findIndex((l) => title.test(l));
  if (start < 0) return [];
  const body = lines.slice(start + 1, start + 5);
  const used = body.map((l) => l.match(/(\d+(?:\.\d+)?)%\s*used/i)).find(Boolean);
  if (!used) return [];
  const reset = body.find((l) => /^resets\b/i.test(l));
  return { label, percent: +used[1], resetsAt: reset ? parseReset(reset) : undefined, windowSeconds };
}

export function parseUsage(text: string): LimitBar[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return [card(lines, /^current usage/i, '5h', FIVE_HOURS), card(lines, /^weekly limit/i, '7d', WEEK)].flat();
}

/** Each fetch spins up a webview, and the page itself updates slowly; keep results a while. */
const MIN_INTERVAL = 2 * 60 * 1000;
let last: UsageSnapshot | null = null;

async function scrape(): Promise<UsageSnapshot> {
  const page = await invoke<{ kind: string; text: string }>('gemini_usage').catch(() => null);
  const fail = (error: string) => ({ bars: [], error, fetchedAt: new Date() });
  if (!page) return fail('offline');
  if (page.kind === 'signin') return fail('sign in via settings');
  if (page.kind !== 'ok') return fail('page not loading');
  const bars = parseUsage(page.text);
  return bars.length ? { bars, fetchedAt: new Date() } : fail('page changed');
}

export const gemini: Provider = {
  id: 'gemini',
  name: 'Gemini',
  icon: SparkleIcon,
  accent: '#8e75ff',
  defaultEnabled: false,
  action: { label: 'Sign in to Google', run: () => invoke('gemini_sign_in') },
  async fetch() {
    if (last && !last.error && Date.now() - last.fetchedAt.getTime() < MIN_INTERVAL) return last;
    last = await scrape();
    return last;
  },
};
