import { fetch } from '@tauri-apps/plugin-http';
import type { LimitBar } from './types';
import { toDate } from './util';

/** Google's Code Assist backend, which Antigravity uses. */
const CLOUDCODE = 'https://cloudcode-pa.googleapis.com/v1internal';

/** An installed-app OAuth client (public by design: it ships inside the CLI/IDE). */
export interface OAuthClient {
  id: string;
  secret: string;
}

/** A fresh access token for `refreshToken`, or null if Google refused. */
export async function refreshAccessToken(client: OAuthClient, refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  return { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

/** POST to a Code Assist method (e.g. `loadCodeAssist`). */
export const cloudcode = (method: string, token: string, body: unknown) =>
  fetch(`${CLOUDCODE}:${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity',
      Origin: '',
    },
    body: JSON.stringify(body),
  });

/** The Code Assist project the account was onboarded to; quota calls are scoped to it. */
export async function codeAssistProject(token: string): Promise<{ project?: string; status: number }> {
  const res = await cloudcode('loadCodeAssist', token, {
    metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
  });
  if (!res.ok) return { status: res.status };
  const data = (await res.json()) as { cloudaicompanionProject?: string | { id?: string } };
  const p = data.cloudaicompanionProject;
  return { project: typeof p === 'string' ? p : p?.id, status: res.status };
}

/** "http 403 · permission denied": the status plus Google's reason, if the body has one. */
export async function httpError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { status?: string } } | null;
  const reason = body?.error?.status?.toLowerCase().replace(/_/g, ' ');
  return reason ? `http ${res.status} · ${reason}` : `http ${res.status}`;
}

/** One model's quota, as both APIs report it. */
export interface ModelQuota {
  name: string;
  /** 0–1; absent means none left (proto3 JSON drops zero values). */
  remainingFraction?: number;
  resetTime?: string;
}

const FAMILIES = ['Pro', 'Flash', 'Claude', 'GPT'];

function family(name: string): string | null {
  const n = name.toLowerCase();
  // Internal or special-purpose models have their own quotas nobody watches.
  if (/image|lite|embed|^tab_|^chat_/.test(n)) return null;
  if (/claude|sonnet|opus/.test(n)) return 'Claude';
  if (/gpt|oss/.test(n)) return 'GPT';
  if (/flash/.test(n)) return 'Flash';
  if (/pro/.test(n)) return 'Pro';
  return null;
}

/**
 * One bar per model family (Pro, Flash, Claude, GPT): quotas are per model, but models in a
 * family share a pool in practice, so the most used one stands for the family.
 */
export function familyBars(models: ModelQuota[], windowSeconds: (resetsAt?: Date) => number | undefined): LimitBar[] {
  const worst = new Map<string, LimitBar>();
  for (const m of models) {
    const f = family(m.name);
    if (!f) continue;
    const percent = Math.round((1 - Math.min(1, Math.max(0, m.remainingFraction ?? 0))) * 1000) / 10;
    const prev = worst.get(f);
    if (prev && prev.percent >= percent) continue;
    const resetsAt = toDate(m.resetTime);
    worst.set(f, { label: f, percent, resetsAt, windowSeconds: windowSeconds(resetsAt) });
  }
  return FAMILIES.flatMap((f) => worst.get(f) ?? []);
}
