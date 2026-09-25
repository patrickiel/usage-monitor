import { load } from '@tauri-apps/plugin-store';
import { emit, listen } from '@tauri-apps/api/event';

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
  scale: number;
  /** Background opacity, 0–1. */
  opacity: number;
  refreshSeconds: number;
  /** Tick on each bar marking how much of the window has elapsed. */
  showPace: boolean;
  /** Provider id → enabled. Missing ids count as enabled. */
  providers: Record<string, boolean>;
}

export const defaults: Config = {
  monitor: '',
  anchor: 'bottom-right',
  offsetX: 0,
  offsetY: 0,
  barWidth: 48,
  barHeight: 4,
  scale: 1,
  opacity: 0.6,
  refreshSeconds: 120,
  showPace: false,
  providers: {},
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
