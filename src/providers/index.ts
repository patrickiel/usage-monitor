import type { Provider } from './types';
import { claude } from './claude';
import { codex } from './codex';
import { withDemoData } from './demo';

const registered: Provider[] = [claude, codex];

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
