import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

/** Reads and parses a JSON file relative to the user's home directory. */
export async function readHomeJson<T>(path: string): Promise<T> {
  return JSON.parse(await readTextFile(path, { baseDir: BaseDirectory.Home })) as T;
}

/** "5h" for 18000, "7d" for 604800, etc. */
export function windowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds) return fallback;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** Accepts epoch seconds, epoch ms or an ISO string. */
export function toDate(v: unknown): Date | undefined {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
