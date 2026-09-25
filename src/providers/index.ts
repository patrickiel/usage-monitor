import type { Provider } from './types';
import type { Config } from '../lib/config';
import { claude } from './claude';
import { codex } from './codex';
import { antigravity } from './antigravity';
import { cursor } from './cursor';
import { copilot } from './copilot';
import { zai } from './zai';
import { kimi } from './kimi';
import { withDemoData } from './demo';

const registered: Provider[] = [claude, codex, antigravity, cursor, copilot, zai, kimi];

/** Every registered provider; settings lists these with an on/off toggle. */
export const providers: Provider[] = import.meta.env.VITE_DEMO === '1' ? withDemoData(registered) : registered;

/** Providers in the user's order (ids from settings); ones not in it keep registry order at the end. */
export function ordered(order: string[]): Provider[] {
  const rank = (p: Provider) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length + providers.indexOf(p) : i;
  };
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

/** Enabled in settings, or by the provider's default if never toggled. */
export const providerEnabled = (config: Config, p: Provider) => config.providers[p.id] ?? p.defaultEnabled ?? true;
