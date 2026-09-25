import { load } from '@tauri-apps/plugin-store';
import type { UsageSnapshot } from '../providers/types';

/** Last good snapshot per provider, so a restart during a rate limit still shows data. */
const store = load('cache.json', { defaults: {}, autoSave: false });

type Stored = Omit<UsageSnapshot, 'fetchedAt' | 'bars'> & {
  fetchedAt: string;
  bars: (Omit<UsageSnapshot['bars'][number], 'resetsAt'> & { resetsAt?: string })[];
};

export async function loadCached(): Promise<Record<string, UsageSnapshot>> {
  const entries = (await (await store).entries<Stored>()) ?? [];
  return Object.fromEntries(
    entries.map(([id, s]) => [
      id,
      {
        ...s,
        fetchedAt: new Date(s.fetchedAt),
        bars: s.bars.map((b) => ({ ...b, resetsAt: b.resetsAt ? new Date(b.resetsAt) : undefined })),
      },
    ]),
  );
}

export async function saveCached(id: string, snapshot: UsageSnapshot): Promise<void> {
  const s = await store;
  await s.set(id, snapshot);
  await s.save();
}
