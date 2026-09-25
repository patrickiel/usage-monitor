import { siClaude } from 'simple-icons';
import { brandIcon } from '../icons/brand';
import { fetch } from '@tauri-apps/plugin-http';
import { readDir, readTextFile, stat, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { readHomeJson, toDate } from './util';

/**
 * Sources, in order:
 * 1. A fresh copy of the usage response cached by a Claude status line
 *    (%TEMP%/claude-statusline-<uid>/usage-cache.json). Free: no request, no rate limit.
 * 2. The usage endpoint with Claude Code's OAuth token. Works for any signed-in user.
 * 3. A stale status line cache, if the endpoint fails.
 */

interface Limit {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

interface UsageWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface Usage {
  limits?: Limit[];
  five_hour?: UsageWindow | null;
  seven_day?: UsageWindow | null;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
  } | null;
}

interface Credentials {
  claudeAiOauth?: { accessToken?: string };
}

/** A shared cache younger than this is used instead of calling the endpoint. */
const FRESH_MS = 3 * 60 * 1000;
const FIVE_HOURS = 5 * 3600;
const WEEK = 7 * 86400;
const KIND_LABELS: Record<string, string> = { session: '5h', weekly_all: '7d' };

const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

const bar = (label: string, percent: number, resets: unknown, windowSeconds: number): LimitBar => ({
  label,
  percent,
  resetsAt: toDate(resets),
  windowSeconds,
});

function toBars(u: Usage): LimitBar[] {
  const bars: LimitBar[] = [];
  if (u.limits?.length) {
    for (const l of u.limits) {
      if (typeof l.percent !== 'number' || !l.kind) continue;
      const label = KIND_LABELS[l.kind] ?? l.scope?.model?.display_name ?? l.kind.replace(/_/g, ' ');
      bars.push(bar(label, l.percent, l.resets_at, l.kind === 'session' ? FIVE_HOURS : WEEK));
    }
  } else {
    // Older response shape without `limits`.
    const windows: [string, UsageWindow | null | undefined][] = [
      ['5h', u.five_hour],
      ['7d', u.seven_day],
      ['Opus', u.seven_day_opus],
      ['Sonnet', u.seven_day_sonnet],
    ];
    for (const [label, w] of windows)
      if (typeof w?.utilization === 'number')
        bars.push(bar(label, w.utilization, w.resets_at, label === '5h' ? FIVE_HOURS : WEEK));
  }

  const extra = u.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === 'number') {
    bars.push({
      label: 'Extra',
      percent: extra.utilization,
      detail:
        extra.monthly_limit != null
          ? `${dollars(extra.used_credits ?? 0)} / ${dollars(extra.monthly_limit)}`
          : undefined,
    });
  }
  return bars;
}

/** The status line's cached usage response, if one exists. */
async function readSharedCache(): Promise<UsageSnapshot | null> {
  const opts = { baseDir: BaseDirectory.Temp };
  const dir = (await readDir('', opts))
    .filter((e) => e.isDirectory && e.name.startsWith('claude-statusline-'))
    .map((e) => e.name)
    .sort()
    .at(-1);
  if (!dir) return null;
  const file = `${dir}/usage-cache.json`;
  const [text, info] = await Promise.all([readTextFile(file, opts), stat(file, opts)]);
  return { bars: toBars(JSON.parse(text) as Usage), fetchedAt: info.mtime ?? new Date(0) };
}

/** After a 429, stay quiet until Retry-After passes. */
let retryAt = 0;

async function fetchApi(): Promise<UsageSnapshot> {
  const fetchedAt = new Date();
  if (Date.now() < retryAt) return { bars: [], error: 'rate limited', fetchedAt };

  const creds = await readHomeJson<Credentials>('.claude/.credentials.json').catch(() => null);
  const oauth = creds?.claudeAiOauth;
  if (!oauth?.accessToken) return { bars: [], error: 'not signed in', fetchedAt };

  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${oauth.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      // Empty Origin removes the webview's one; the API refuses browser-origin requests.
      Origin: '',
    },
  });
  if (res.status === 429) {
    retryAt = Date.now() + (Number(res.headers.get('retry-after')) || 300) * 1000;
    return { bars: [], error: 'rate limited', fetchedAt };
  }
  if (res.status === 401) return { bars: [], error: 'token expired · run claude', fetchedAt };
  if (!res.ok) return { bars: [], error: `http ${res.status}`, fetchedAt };

  return { bars: toBars((await res.json()) as Usage), fetchedAt };
}

export const claude: Provider = {
  id: 'claude',
  name: 'Claude',
  icon: brandIcon(siClaude.path),
  accent: '#d97757',
  async fetch() {
    const shared = await readSharedCache().catch(() => null);
    if (shared && Date.now() - shared.fetchedAt.getTime() < FRESH_MS) return shared;

    const live = await fetchApi();
    // Endpoint failed: an older shared cache still beats nothing.
    return live.error && shared?.bars.length ? { ...shared, error: live.error } : live;
  },
};
