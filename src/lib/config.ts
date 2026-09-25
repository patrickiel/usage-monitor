import { load } from '@tauri-apps/plugin-store';
import { emit, listen } from '@tauri-apps/api/event';
import type { Theme } from './theme';

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface Config {
  /** Monitor name; empty means the primary monitor. */
  monitor: string;
  anchor: Anchor;
  /** Logical px, pushed inwards from the anchored edge. */
  offsetX: number;
  offsetY: number;
  /** Width of a single bar in logical px. */
  barWidth: number;
  /** Bar thickness in logical px. */
  barHeight: number;
  /** Rows per column; a provider with more bars continues in another column. */
  maxRows: number;
  scale: number;
  /** Background opacity, 0–1. */
  opacity: number;
  refreshSeconds: number;
  /** Tick on each bar marking how much of the window has elapsed. */
  showPace: boolean;
  /** Percentage column next to each bar. */
  showPercent: boolean;
  /** Reset countdown column (and extra usage $ amounts). */
  showTimes: boolean;
  theme: Theme;
  /** Provider ids in display order (drag to reorder in settings). */
  order: string[];
  /** Provider id → enabled. Missing ids use the provider's default. */
  providers: Record<string, boolean>;
  /** Provider id → API key, for providers that need one. */
  keys: Record<string, string>;
}

export const defaults: Config = {
  monitor: '',
  anchor: 'bottom-left',
  offsetX: 0,
  offsetY: 0,
  barWidth: 48,
  barHeight: 7,
  maxRows: 3,
  scale: 1,
  opacity: 0,
  refreshSeconds: 120,
  showPace: false,
  showPercent: true,
  showTimes: true,
  theme: 'auto',
  order: [],
  providers: {},
  keys: {},
};

const CHANGED = 'config-changed';
const store = load('config.json', { defaults: {}, autoSave: false });

export async function loadConfig(): Promise<Config> {
  const saved = (await (await store).get<Partial<Config>>('config')) ?? {};
  // Only known keys, so settings removed in later versions drop out.
  const known = Object.entries(saved).filter(([k]) => k in defaults);
  return { ...defaults, ...Object.fromEntries(known) };
}

export async function saveConfig(config: Config): Promise<void> {
  const s = await store;
  await s.set('config', config);
  await s.save();
  await emit(CHANGED, config);
}

export const onConfigChanged = (fn: (config: Config) => void) =>
  listen<Config>(CHANGED, (e) => fn(e.payload));
