import RocketLaunchIcon from 'phosphor-svelte/lib/RocketLaunchIcon';
import { invoke } from '@tauri-apps/api/core';
import type { Provider, UsageSnapshot } from './types';
import {
  cloudcode,
  codeAssistProject,
  familyBars,
  httpError,
  refreshAccessToken,
  type ModelQuota,
} from './google';

/**
 * Sources, in order:
 * 1. The running Antigravity language server's `GetUserStatus` (found and called from Rust:
 *    it needs the process command line and a self-signed localhost certificate).
 * 2. Code Assist `fetchAvailableModels`, with the OAuth token Antigravity keeps in its
 *    state.vscdb. Works while the app is closed. An expired token is refreshed with the
 *    OAuth client read from the installed CLI or IDE (found by Rust).
 */

const FIVE_HOURS = 5 * 3600;
const WEEK = 7 * 86400;

/** Paid plans refill every 5 hours, free ones weekly; the reset time tells which. */
const windowFor = (resetsAt?: Date) =>
  resetsAt && resetsAt.getTime() - Date.now() <= FIVE_HOURS * 1000 ? FIVE_HOURS : resetsAt ? WEEK : undefined;

interface UserStatus {
  userStatus?: {
    cascadeModelConfigData?: {
      clientModelConfigs?: {
        label?: string;
        modelOrAlias?: { model?: string };
        quotaInfo?: { remainingFraction?: number; resetTime?: string };
      }[];
    };
  };
}

async function fromLocalServer(): Promise<UsageSnapshot> {
  const status = JSON.parse(await invoke<string>('antigravity_status')) as UserStatus;
  const models: ModelQuota[] = (status.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? [])
    .filter((c) => c.quotaInfo)
    .map((c) => ({ name: c.label ?? c.modelOrAlias?.model ?? '', ...c.quotaInfo }));
  return { bars: familyBars(models, windowFor), fetchedAt: new Date() };
}

/** Bytes of a base64 string (latin1, so byte offsets survive regex matching). */
const unbase64 = (s: string) => atob(s.replace(/\s/g, ''));

/**
 * The OAuth tokens inside `antigravityUnifiedStateSync.oauthToken`: base64 protobuf, which
 * wraps another base64 protobuf. Rather than depend on field numbers, find the tokens by shape.
 */
function findTokens(raw: string, depth = 0): { access?: string; refresh?: string } {
  let bytes: string;
  try {
    bytes = unbase64(raw);
  } catch {
    return {};
  }
  const access = bytes.match(/ya29\.[\w.-]+/)?.[0];
  const refresh = bytes.match(/1\/\/[\w-]+/)?.[0];
  if (access || refresh || depth > 2) return { access, refresh };
  for (const nested of bytes.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? []) {
    const found = findTokens(nested, depth + 1);
    if (found.access || found.refresh) return found;
  }
  return {};
}

/** An access token refreshed by us outlives the stored one; reuse it until it expires. */
let refreshed: { token: string; expiresAt: number } | null = null;
/** The client secret that worked, so later refreshes skip the other candidates. */
let workingSecret: string | undefined;

/** Refreshes with Antigravity's client, trying each candidate secret found in its files. */
async function refresh(refreshToken: string) {
  const client = await invoke<{ id: string; secrets: string[] }>('antigravity_client').catch(() => null);
  if (!client) return null;
  const secrets = workingSecret ? [workingSecret, ...client.secrets.filter((s) => s !== workingSecret)] : client.secrets;
  for (const secret of secrets) {
    const result = await refreshAccessToken({ id: client.id, secret }, refreshToken);
    if (result) {
      workingSecret = secret;
      return result;
    }
  }
  return null;
}
let project: string | undefined;

async function fromApi(): Promise<UsageSnapshot | string> {
  const raw = await invoke<string | null>('read_vscdb', { app: 'Antigravity', key: 'antigravityUnifiedStateSync.oauthToken' });
  if (!raw) return 'not signed in';
  const tokens = findTokens(raw);

  const call = async (token: string) => {
    project ??= (await codeAssistProject(token)).project;
    return cloudcode('fetchAvailableModels', token, project ? { project } : {});
  };
  let token = refreshed && refreshed.expiresAt > Date.now() + 60000 ? refreshed.token : tokens.access;
  let res = token ? await call(token) : null;
  if ((!res || res.status === 401) && tokens.refresh) {
    refreshed = await refresh(tokens.refresh);
    token = refreshed?.token;
    res = token ? await call(token) : null;
  }
  if (!res || res.status === 401) return 'token expired · open antigravity';
  if (!res.ok) return httpError(res);

  const data = (await res.json()) as {
    models?: Record<string, { displayName?: string; quotaInfo?: { remainingFraction?: number; resetTime?: string } }>;
  };
  const models: ModelQuota[] = Object.entries(data.models ?? {})
    .filter(([, m]) => m.quotaInfo)
    .map(([id, m]) => ({ name: m.displayName ?? id, ...m.quotaInfo }));
  return { bars: familyBars(models, windowFor), fetchedAt: new Date() };
}

export const antigravity: Provider = {
  id: 'antigravity',
  name: 'Antigravity',
  icon: RocketLaunchIcon,
  accent: '#4285f4',
  defaultEnabled: false,
  async fetch() {
    const local = await fromLocalServer().catch(() => null);
    if (local?.bars.length) return local;
    const api = await fromApi().catch(() => 'offline');
    return typeof api === 'string' ? { bars: [], error: api, fetchedAt: new Date() } : api;
  },
};
