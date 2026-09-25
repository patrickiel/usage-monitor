import { siGithubcopilot } from 'simple-icons';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { brandIcon } from '../icons/brand';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { toDate } from './util';

/** GitHub Copilot: monthly premium requests (and free-plan chat/completion quotas), via the gh CLI's token. */

interface Quota {
  entitlement?: number;
  remaining?: number;
  percent_remaining?: number;
  unlimited?: boolean;
}

interface CopilotUser {
  quota_reset_date?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: Record<string, Quota | undefined>;
  /** Free plan. */
  limited_user_reset_date?: string;
  limited_user_quotas?: Record<string, number>;
  monthly_quotas?: Record<string, number>;
}

const LABELS: Record<string, string> = { premium_interactions: 'Month', chat: 'Chat', completions: 'Code' };

/** Quotas reset monthly; the window is the month before the reset. */
function window(resetsAt?: Date): number | undefined {
  if (!resetsAt) return undefined;
  const start = new Date(resetsAt);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return (resetsAt.getTime() - start.getTime()) / 1000;
}

function toBars(u: CopilotUser): LimitBar[] {
  const resetsAt = toDate(u.quota_reset_date_utc ?? u.quota_reset_date ?? u.limited_user_reset_date);
  const windowSeconds = window(resetsAt);
  const bars: LimitBar[] = [];

  for (const [key, label] of Object.entries(LABELS)) {
    const q = u.quota_snapshots?.[key];
    if (q && !q.unlimited && (q.entitlement ?? 0) > 0) {
      const percent = q.percent_remaining != null ? 100 - q.percent_remaining : (1 - (q.remaining ?? 0) / q.entitlement!) * 100;
      bars.push({ label, percent: Math.max(0, percent), resetsAt, windowSeconds });
      continue;
    }
    // Free plan: remaining counts next to the monthly totals.
    const total = u.monthly_quotas?.[key];
    const left = u.limited_user_quotas?.[key];
    if (total && left != null) bars.push({ label, percent: (1 - left / total) * 100, resetsAt, windowSeconds });
  }
  return bars;
}

async function fetchUsage(): Promise<UsageSnapshot | string> {
  const token = await invoke<string>('gh_token').catch((e) => String(e));
  if (!/^(gh[opsu]_|github_pat_)/.test(token)) return token === 'gh not installed' ? token : 'not signed in · gh auth login';

  const res = await fetch('https://api.github.com/copilot_internal/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.104.0',
      'Editor-Plugin-Version': 'copilot-chat/0.31.0',
      'User-Agent': 'GitHubCopilotChat/0.31.0',
      'X-Github-Api-Version': '2025-04-01',
      Origin: '',
    },
  });
  if (res.status === 401) return 'token expired · gh auth login';
  if (res.status === 404) return 'no copilot plan';
  if (!res.ok) return `http ${res.status}`;
  const bars = toBars((await res.json()) as CopilotUser);
  return bars.length ? { bars, fetchedAt: new Date() } : 'unlimited';
}

export const copilot: Provider = {
  id: 'copilot',
  name: 'GitHub Copilot',
  icon: brandIcon(siGithubcopilot.path),
  defaultEnabled: false,
  async fetch() {
    const result = await fetchUsage().catch(() => 'offline');
    return typeof result === 'string' ? { bars: [], error: result, fetchedAt: new Date() } : result;
  },
};
