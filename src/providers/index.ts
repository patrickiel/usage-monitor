import type { Provider } from './types';
import { claude } from './claude';
import { codex } from './codex';

/** Every registered provider; settings lists these with an on/off toggle. */
export const providers: Provider[] = [claude, codex];
