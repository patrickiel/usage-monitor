import { siKimi } from 'simple-icons';
import { fetch } from '@tauri-apps/plugin-http';
import { brandIcon } from '../icons/brand';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { readHomeJson, toDate, windowLabel } from './util';

/** Kimi Code: the membership's weekly and rolling-window limits, with the Kimi Code CLI's login. */

interface Creds {
  access_token?: string;
}

/** Counts may arrive as strings. */
type Num = number | string | null | undefined;

interface Detail {
  limit?: Num;
  used?: Num;
  remaining?: Num;
  resetTime?: string | number;
  reset_at?: string | number;
  resetAt?: string | number;
}

interface WindowedLimit {
  window?: { duration?: Num; timeUnit?: string };
  detail?: Detail;
}

const num = (v: Num) => (v == null || v === '' ? undefined : Number(v));

const UNIT_SECONDS: Record<string, number> = {
  TIME_UNIT_SECOND: 1,
  TIME_UNIT_MINUTE: 60,
  TIME_UNIT_HOUR: 3600,
  TIME_UNIT_DAY: 86400,
};

function toBar(d: Detail | undefined, label: string, windowSeconds?: number): LimitBar | [] {
  const limit = num(d?.limit);
  if (!d || !limit) return [];
  const used = num(d.used) ?? limit - (num(d.remaining) ?? limit);
  return {
    label,
    percent: (used / limit) * 100,
    resetsAt: toDate(d.resetTime ?? d.reset_at ?? d.resetAt),
    windowSeconds,
  };
}

async function fetchUsage(): Promise<UsageSnapshot | string> {
  const creds = await readHomeJson<Creds>('.kimi-code/credentials/kimi-code.json').catch(() => null);
  if (!creds?.access_token) return 'not signed in';

  const res = await fetch('https://api.kimi.com/coding/v1/usages', {
    headers: { Authorization: `Bearer ${creds.access_token}`, Origin: '' },
  });
  if (res.status === 401) return 'token expired · run kimi';
  if (!res.ok) return `http ${res.status}`;
  const data = (await res.json()) as { usage?: Detail; limits?: WindowedLimit[] };

  const windows = (data.limits ?? []).flatMap((l) => {
    const unit = UNIT_SECONDS[l.window?.timeUnit ?? ''];
    const seconds = unit && num(l.window?.duration) ? unit * num(l.window?.duration)! : undefined;
    return toBar(l.detail, windowLabel(seconds, 'Limit'), seconds);
  });
  // The summary `usage` is the weekly limit.
  return { bars: [...windows, ...[toBar(data.usage, '7d', 7 * 86400)].flat()], fetchedAt: new Date() };
}

export const kimi: Provider = {
  id: 'kimi',
  name: 'Kimi Code',
  icon: brandIcon(siKimi.path),
  defaultEnabled: false,
  async fetch() {
    const result = await fetchUsage().catch(() => 'offline');
    return typeof result === 'string' ? { bars: [], error: result, fetchedAt: new Date() } : result;
  },
};
