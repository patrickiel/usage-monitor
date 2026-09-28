import {
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
  PhysicalPosition,
  PhysicalSize,
  type Monitor,
} from '@tauri-apps/api/window';
import type { Config } from './config';

export async function findMonitor(name: string): Promise<Monitor | null> {
  const monitors = await availableMonitors();
  return monitors.find((m) => m.name === name) ?? (await primaryMonitor()) ?? monitors[0] ?? null;
}

/**
 * Docks the current window on the configured monitor. Uses the full monitor
 * bounds (not the work area) so it can sit on top of the taskbar.
 * `width`/`height` are the content size in logical px.
 * Leaves a window that's already docked alone, so it's cheap to call often.
 */
export async function place(config: Config, width: number, height: number): Promise<void> {
  const monitor = await findMonitor(config.monitor);
  if (!monitor) return;

  const sf = monitor.scaleFactor;
  const w = Math.ceil(width * sf);
  const h = Math.ceil(height * sf);
  // `|| 0`: a cleared number input yields null.
  const ox = Math.round((config.offsetX || 0) * sf);
  const oy = Math.round((config.offsetY || 0) * sf);
  const { x, y } = monitor.position;
  const { width: mw, height: mh } = monitor.size;
  const [v, hz] = config.anchor.split('-');

  const px = hz === 'left' ? x + ox : hz === 'right' ? x + mw - w - ox : x + Math.round((mw - w) / 2) + ox;
  const py = v === 'top' ? y + oy : v === 'bottom' ? y + mh - h - oy : y + Math.round((mh - h) / 2) + oy;

  const win = getCurrentWindow();
  // Move first so a DPI change happens before sizing, then size (read after the move, which may rescale it).
  const pos = await win.outerPosition();
  if (pos.x !== px || pos.y !== py) await win.setPosition(new PhysicalPosition(px, py));
  const size = await win.innerSize();
  if (size.width !== w || size.height !== h) await win.setSize(new PhysicalSize(w, h));
  if (!(await win.isVisible())) await win.show();
}
