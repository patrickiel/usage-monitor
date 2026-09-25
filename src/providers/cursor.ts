import { siCursor } from 'simple-icons';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { brandIcon } from '../icons/brand';
import type { LimitBar, Provider, UsageSnapshot } from './types';
import { toDate } from './util';

/** Cursor: billing-cycle usage from cursor.com, signed in with the IDE's session token. */

interface Summary {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  individualUsage?: {
    plan?: { used?: number; limit?: number; totalPercentUsed?: number };
    onDemand?: { enabled?: boolean; used?: number; limit?: number | null };
  };
}

const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

/** The user id is the part after "|" in the JWT's `sub` (e.g. "auth0|user_01…"). */
function userId(jwt: string): string | undefined {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return payload.sub?.split('|').at(-1);
  } catch {
    return undefined;
  }
}

async function fetchUsage(): Promise<UsageSnapshot | string> {
  const jwt = await invoke<string | null>('read_vscdb', { app: 'Cursor', key: 'cursorAuth/accessToken' });
  const id = jwt && userId(jwt);
  if (!jwt || !id) return 'not signed in';

  const res = await fetch('https://cursor.com/api/usage-summary', {
    headers: { Cookie: `WorkosCursorSessionToken=${id}%3A%3A${jwt}`, Origin: '' },
  });
  if (res.status === 401 || res.status === 403) return 'token expired · open cursor';
  if (!res.ok) return `http ${res.status}`;
  const data = (await res.json()) as Summary;

  const start = toDate(data.billingCycleStart);
  const resetsAt = toDate(data.billingCycleEnd);
  const windowSeconds = start && resetsAt ? (resetsAt.getTime() - start.getTime()) / 1000 : undefined;
  const bars: LimitBar[] = [];

  const plan = data.individualUsage?.plan;
  const percent = plan?.totalPercentUsed ?? (plan?.limit ? ((plan.used ?? 0) / plan.limit) * 100 : undefined);
  if (percent != null) bars.push({ label: 'Month', percent, resetsAt, windowSeconds });

  const extra = data.individualUsage?.onDemand;
  if (extra?.enabled && extra.limit) {
    bars.push({
      label: 'Extra',
      percent: ((extra.used ?? 0) / extra.limit) * 100,
      detail: `${dollars(extra.used ?? 0)} / ${dollars(extra.limit)}`,
    });
  }
  return { bars, fetchedAt: new Date() };
}

export const cursor: Provider = {
  id: 'cursor',
  name: 'Cursor',
  icon: brandIcon(siCursor.path),
  defaultEnabled: false,
  async fetch() {
    const result = await fetchUsage().catch(() => 'offline');
    return typeof result === 'string' ? { bars: [], error: result, fetchedAt: new Date() } : result;
  },
};
