import type { Provider } from './types';
import { claude } from './claude';
import { codex } from './codex';

/** Every registered provider; settings lists these with an on/off toggle. */
export const providers: Provider[] = [claude, codex];

/** Providers in the user's order (ids from settings); ones not in it keep registry order at the end. */
export function ordered(order: string[]): Provider[] {
  const rank = (p: Provider) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length + providers.indexOf(p) : i;
  };
  return [...providers].sort((a, b) => rank(a) - rank(b));
}
