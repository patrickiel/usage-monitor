import OpenAiLogoIcon from 'phosphor-svelte/lib/OpenAiLogoIcon';
import { fetch } from '@tauri-apps/plugin-http';
import { readDir, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { readHomeJson, toDate, windowLabel } from './util';

interface Auth {
  tokens?: { access_token?: string; account_id?: string };
}

interface ApiWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
  reset_after_seconds?: number;
}

interface SessionWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
  resets_in_seconds?: number;
}

/** A window from either source, with the field names normalized. */
interface Window {
  percent?: number;
  seconds?: number;
  resetAt?: number;
  resetIn?: number;
}

/** Zero or one bar, so results can be spread into a list. */
function toBar(w: Window, at: Date, fallback: string): LimitBar[] {
  if (typeof w.percent !== 'number') return [];
  const resetsAt = toDate(w.resetAt) ?? (w.resetIn != null ? new Date(at.getTime() + w.resetIn * 1000) : undefined);
  return [{ label: windowLabel(w.seconds, fallback), percent: w.percent, resetsAt, windowSeconds: w.seconds }];
}

const apiBar = (w: ApiWindow | undefined, fallback: string) =>
  toBar(
    { percent: w?.used_percent, seconds: w?.limit_window_seconds, resetAt: w?.reset_at, resetIn: w?.reset_after_seconds },
    new Date(),
    fallback,
  );

const sessionBar = (w: SessionWindow | undefined, fallback: string, at: Date) =>
  toBar(
    {
      percent: w?.used_percent,
      seconds: w?.window_minutes && w.window_minutes * 60,
      resetAt: w?.resets_at,
      resetIn: w?.resets_in_seconds,
    },
    at,
    fallback,
  );

/** A snapshot, or a short reason why the endpoint gave none. */
async function fromApi(auth: Auth): Promise<UsageSnapshot | string> {
  const token = auth.tokens?.access_token;
  if (!token) return 'not signed in';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (auth.tokens?.account_id) headers['ChatGPT-Account-Id'] = auth.tokens.account_id;

  const res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });
  if (res.status === 401) return 'token expired · run codex';
  if (!res.ok) return `http ${res.status}`;
  const data = (await res.json()) as {
    rate_limit?: { primary_window?: ApiWindow; secondary_window?: ApiWindow };
    rate_limit_reset_credits?: { available_count?: number; credits?: unknown[] } | null;
  };
  const resets = data.rate_limit_reset_credits;
  return {
    bars: [
      ...apiBar(data.rate_limit?.primary_window, '5h'),
      ...apiBar(data.rate_limit?.secondary_window, '7d'),
    ],
    resetsAvailable: resets?.available_count ?? resets?.credits?.length,
    fetchedAt: new Date(),
  };
}

/** Newest entry (by name) in a home-relative directory. */
async function newest(dir: string, filter: (name: string) => boolean): Promise<string | null> {
  const names = (await readDir(dir, { baseDir: BaseDirectory.Home })).map((e) => e.name).filter(filter);
  return names.length ? `${dir}/${names.sort().at(-1)}` : null;
}

/** Fallback: the last `rate_limits` Codex logged in its newest session file (sessions/YYYY/MM/DD). */
async function fromSessions(): Promise<UsageSnapshot | null> {
  let dir: string | null = '.codex/sessions';
  for (let depth = 0; depth < 3 && dir; depth++) dir = await newest(dir, (n) => /^\d+$/.test(n));
  const file = dir && (await newest(dir, (n) => n.endsWith('.jsonl')));
  if (!file) return null;

  const lines = (await readTextFile(file, { baseDir: BaseDirectory.Home })).trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    const entry = JSON.parse(lines[i]) as {
      timestamp?: string;
      payload?: { rate_limits?: { primary?: SessionWindow; secondary?: SessionWindow } };
    };
    const limits = entry.payload?.rate_limits;
    if (!limits) continue;
    const at = toDate(entry.timestamp) ?? new Date();
    const bars = [...sessionBar(limits.primary, '5h', at), ...sessionBar(limits.secondary, '7d', at)];
    // Some entries carry no windows (e.g. `primary: null`); keep looking further back.
    if (bars.length) return { bars, fetchedAt: at };
  }
  return null;
}

export const codex: Provider = {
  id: 'codex',
  name: 'Codex',
  icon: OpenAiLogoIcon,
  async fetch() {
    const auth = await readHomeJson<Auth>('.codex/auth.json').catch(() => null);
    const api = auth ? await fromApi(auth).catch(() => 'offline') : 'not signed in';
    if (typeof api !== 'string') return api;
    // Endpoint failed: the session log is older but better than nothing; keep the reason visible.
    const logged = await fromSessions().catch(() => null);
    return logged ? { ...logged, error: api } : { bars: [], error: api, fetchedAt: new Date() };
  },
};
