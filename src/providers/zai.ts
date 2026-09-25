import { fetch } from '@tauri-apps/plugin-http';
import { brandIcon } from '../icons/brand';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { toDate, windowLabel } from './util';

/** z.ai GLM Coding Plan: prompt windows (5h, weekly) and monthly MCP tool calls, with an API key. */

interface Limit {
  /** TOKENS_LIMIT (prompts per window) or TIME_LIMIT (MCP tool calls). */
  type?: string;
  /** Window unit code and count, e.g. unit 3 · number 5 = 5 hours. */
  unit?: number;
  number?: number;
  percentage?: number;
  nextResetTime?: number;
}

/** Seconds per window unit code. */
const UNITS: Record<number, number> = { 1: 86400, 3: 3600, 5: 30 * 86400, 6: 7 * 86400 };

function toBar(l: Limit): LimitBar | [] {
  if (typeof l.percentage !== 'number') return [];
  const unit = l.unit != null ? UNITS[l.unit] : undefined;
  const windowSeconds = unit && l.number ? unit * l.number : undefined;
  const label = l.type === 'TIME_LIMIT' ? 'MCP' : windowLabel(windowSeconds, 'Prompts');
  return { label, percent: l.percentage, resetsAt: toDate(l.nextResetTime), windowSeconds };
}

/** "Z" in a rounded square. */
const ZAI_PATH =
  'M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm2 4.5v2.2h6.6L7 15.3v2.2h10v-2.2h-6.6L17 8.7V6.5H7Z';

async function fetchUsage(key: string | undefined): Promise<UsageSnapshot | string> {
  if (!key) return 'add api key in settings';
  const res = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
    headers: { Authorization: key, 'Accept-Language': 'en-US,en', Origin: '' },
  });
  if (res.status === 401) return 'invalid api key';
  if (!res.ok) return `http ${res.status}`;
  const body = (await res.json()) as { success?: boolean; msg?: string; data?: { limits?: Limit[] } };
  if (body.success === false) return body.msg?.toLowerCase() ?? 'no data';
  // Prompt windows first, shortest first; MCP last.
  const limits = [...(body.data?.limits ?? [])].sort(
    (a, b) =>
      Number(a.type === 'TIME_LIMIT') - Number(b.type === 'TIME_LIMIT') ||
      (UNITS[a.unit ?? 0] ?? 0) * (a.number ?? 0) - (UNITS[b.unit ?? 0] ?? 0) * (b.number ?? 0),
  );
  return { bars: limits.flatMap(toBar), fetchedAt: new Date() };
}

export const zai: Provider = {
  id: 'zai',
  name: 'z.ai GLM',
  icon: brandIcon(ZAI_PATH),
  defaultEnabled: false,
  keyLabel: 'z.ai API key',
  async fetch({ key }) {
    const result = await fetchUsage(key).catch(() => 'offline');
    return typeof result === 'string' ? { bars: [], error: result, fetchedAt: new Date() } : result;
  },
};
