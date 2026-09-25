<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon';
  import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
  import CircleHalfIcon from 'phosphor-svelte/lib/CircleHalfIcon';
  import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
  import SunIcon from 'phosphor-svelte/lib/SunIcon';
  import { availableMonitors, getCurrentWindow, primaryMonitor, type Monitor } from '@tauri-apps/api/window';
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { ordered, providerEnabled } from '../providers';
  import { defaults, loadConfig, saveConfig, type Anchor, type Config } from '../lib/config';
  import { setTheme, type Theme } from '../lib/theme';

  const anchors: Anchor[] = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'middle-center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ];

  const themes = [
    { value: 'auto', label: 'Auto', icon: CircleHalfIcon },
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
  ] as const satisfies { value: Theme; label: string; icon: unknown }[];

  type NumberKey = 'scale' | 'barWidth' | 'barHeight' | 'maxRows' | 'opacity' | 'refreshSeconds';

  const sliders: { key: NumberKey; label: string; min: number; max: number; step: number; format: (v: number) => string }[] = [
    { key: 'scale', label: 'Scale', min: 0.75, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
    { key: 'barWidth', label: 'Bar width', min: 24, max: 120, step: 2, format: (v) => `${v}px` },
    { key: 'barHeight', label: 'Bar thickness', min: 2, max: 10, step: 1, format: (v) => `${v}px` },
    { key: 'maxRows', label: 'Max rows', min: 1, max: 6, step: 1, format: (v) => `${v}` },
    { key: 'opacity', label: 'Background', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'refreshSeconds', label: 'Refresh every', min: 30, max: 600, step: 15, format: (v) => `${v}s` },
  ];

  // Shared styles
  const heading = 'text-xs font-semibold tracking-wider text-neutral-500 uppercase';
  const field =
    'w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500';
  const selected = 'border-emerald-500 bg-emerald-500/20 dark:border-emerald-400 dark:bg-emerald-400/25';
  const unselected =
    'border-neutral-300 bg-neutral-100 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-500';

  let config = $state<Config | null>(null);
  let monitors = $state<Monitor[]>([]);
  let primary = $state('');
  let autostart = $state(false);

  onMount(() => {
    loadConfig().then((c) => (config = c));
    availableMonitors().then((m) => (monitors = m));
    primaryMonitor().then((m) => (primary = m?.name ?? ''));
    isEnabled().then((v) => (autostart = v));
  });

  // Live apply: every edit is saved and broadcast to the overlay.
  $effect(() => {
    if (config) saveConfig($state.snapshot(config));
  });

  $effect(() => {
    if (!config) return;
    setTheme(config.theme);
    // Native title bar; null follows Windows.
    getCurrentWindow().setTheme(config.theme === 'auto' ? null : config.theme);
  });

  const monitorLabel = (m: Monitor, i: number) =>
    `Display ${i + 1} · ${m.size.width}×${m.size.height}${m.name === primary ? ' · primary' : ''}`;

  // Pointer-based reordering: the row follows the cursor, neighbours slide aside (flip).
  let list = $state<HTMLElement>();
  let drag = $state<{ id: string; startY: number; offset: number } | null>(null);

  function dragStart(e: PointerEvent, id: string) {
    // Capture on the list, not the row: rows move in the DOM while reordering, which would drop
    // the capture. The list keeps it, so a release anywhere (even outside the window) arrives.
    list?.setPointerCapture(e.pointerId);
    drag = { id, startY: e.clientY, offset: 0 };
  }

  const dragEnd = () => (drag = null);

  function dragMove(e: PointerEvent) {
    if (!drag || !config || !list) return;
    if (e.buttons === 0) return dragEnd(); // missed release
    const ids = ordered(config.order).map((p) => p.id);
    const i = ids.indexOf(drag.id);
    const rows = [...list.children] as HTMLElement[];
    const self = rows[i];
    const listTop = list.getBoundingClientRect().top;
    let slotTop = self.offsetTop;
    // Swap with a neighbour once the cursor passes its middle (offsetTop ignores transforms).
    for (const j of [i - 1, i + 1]) {
      const row = rows[j];
      if (!row) continue;
      const mid = listTop + row.offsetTop + row.offsetHeight / 2;
      if ((j > i && e.clientY > mid) || (j < i && e.clientY < mid)) {
        // Our slot moves by the distance between the two rows; keep the row under the cursor.
        const shift = row.offsetTop - self.offsetTop;
        drag.startY += shift;
        slotTop += shift;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        config.order = ids;
        break;
      }
    }
    // Keep the row inside the list: no further than its first and last slot.
    const min = -slotTop;
    const max = list.clientHeight - self.offsetHeight - slotTop;
    drag.offset = Math.min(max, Math.max(min, e.clientY - drag.startY));
  }

  async function toggleAutostart() {
    await (autostart ? enable() : disable());
  }
</script>


<svelte:window onblur={dragEnd} />

<!-- Two columns when there's room (landscape), one scrolling column when narrow; footer stays pinned. -->
<main
  class="flex h-screen flex-col bg-white text-sm text-neutral-800 select-none dark:bg-neutral-900 dark:text-neutral-200"
>
  {#if config}
    <div class="grid flex-1 content-start gap-x-8 gap-y-6 overflow-y-auto p-5 sm:grid-cols-2">
      <div class="space-y-6">
        <section class="space-y-3">
          <h2 class={heading}>Position</h2>
          <select bind:value={config.monitor} aria-label="Monitor" class={[field, 'py-1.5']}>
            <option value="">Primary monitor</option>
            {#each monitors as m, i (m.name)}
              <option value={m.name}>{monitorLabel(m, i)}</option>
            {/each}
          </select>

          <div class="flex gap-5">
            <div class="grid w-24 shrink-0 grid-cols-3 gap-1" role="group" aria-label="Dock">
              {#each anchors as a (a)}
                <button
                  aria-label={a}
                  title={a}
                  onclick={() => (config!.anchor = a)}
                  class={['h-6 rounded border transition-colors', config.anchor === a ? selected : unselected]}
                ></button>
              {/each}
            </div>

            <div class="flex-1 space-y-1.5">
              {#each [['X', 'offsetX'], ['Y', 'offsetY']] as const as [label, key] (key)}
                <label class="flex items-center gap-2">
                  <span class="shrink-0 text-xs whitespace-nowrap text-neutral-500 dark:text-neutral-400">Offset {label}</span>
                  <input type="number" bind:value={config[key]} class={[field, 'py-1 font-mono']} />
                </label>
              {/each}
            </div>
          </div>
        </section>

        <section class="space-y-2">
          <h2 class={heading}>Providers</h2>
          <!-- Drag the handle to reorder; the overlay follows this order. -->
          <ul
            class="relative space-y-1"
            bind:this={list}
            onpointermove={dragMove}
            onpointerup={dragEnd}
            onpointercancel={dragEnd}
            onlostpointercapture={dragEnd}
          >
            {#each ordered(config.order) as p (p.id)}
              {@const lifted = drag?.id === p.id}
              <li
                animate:flip={{ duration: 180 }}
                style:transform={lifted ? `translateY(${drag!.offset}px) scale(1.02)` : undefined}
                class={[
                  'relative flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5',
                  'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800',
                  lifted
                    ? 'z-10 shadow-lg ring-1 ring-emerald-500/40'
                    : 'transition-[transform,box-shadow] duration-150',
                ]}
              >
                <span
                  role="button"
                  tabindex="-1"
                  aria-label="Drag to reorder {p.name}"
                  onpointerdown={(e) => dragStart(e, p.id)}
                  class={[
                    'touch-none text-neutral-400 dark:text-neutral-500',
                    lifted ? 'cursor-grabbing' : 'cursor-grab hover:text-neutral-600 dark:hover:text-neutral-300',
                  ]}
                >
                  <DotsSixVerticalIcon size="1.2em" weight="bold" />
                </span>
                <label class="flex flex-1 items-center justify-between">
                  <span class="flex items-center gap-2">
                    <p.icon size="1.2em" color={p.accent ?? 'currentColor'} />{p.name}
                  </span>
                  <input
                    type="checkbox"
                    checked={providerEnabled(config, p)}
                    onchange={(e) => (config!.providers[p.id] = e.currentTarget.checked)}
                    class="size-4 accent-emerald-500"
                  />
                </label>
                {#if p.keyLabel && providerEnabled(config, p)}
                  <input
                    type="password"
                    placeholder={p.keyLabel}
                    aria-label={p.keyLabel}
                    value={config.keys[p.id] ?? ''}
                    onchange={(e) => (config!.keys[p.id] = e.currentTarget.value.trim())}
                    class={[field, 'ml-6 py-1 font-mono text-xs']}
                  />
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      </div>

      <section class="space-y-3">
        <h2 class={heading}>Appearance</h2>

        <div class="flex gap-1">
          {#each themes as t (t.value)}
            <button
              onclick={() => (config!.theme = t.value)}
              class={[
                'flex flex-1 items-center justify-center gap-1.5 rounded border py-1 text-xs transition-colors',
                config.theme === t.value ? selected : unselected,
              ]}
            >
              <t.icon size="1.2em" weight="bold" />{t.label}
            </button>
          {/each}
        </div>

        {#each sliders as s (s.key)}
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span class="flex-1">{s.label}</span>
              {#if config[s.key] !== defaults[s.key]}
                <button
                  title="Reset to {s.format(defaults[s.key])}"
                  aria-label="Reset {s.label}"
                  onclick={() => (config![s.key] = defaults[s.key])}
                  class="text-neutral-400 transition-colors hover:text-emerald-600 dark:text-neutral-500 dark:hover:text-emerald-300"
                >
                  <ArrowCounterClockwiseIcon size="1.1em" weight="bold" />
                </button>
              {/if}
              <span class="font-mono text-neutral-700 dark:text-neutral-300">{s.format(config[s.key])}</span>
            </div>
            <input
              type="range"
              aria-label={s.label}
              min={s.min}
              max={s.max}
              step={s.step}
              bind:value={config[s.key]}
              class="w-full accent-emerald-500"
            />
          </div>
        {/each}

        <label
          class="flex items-center justify-between"
          title="Tick on each bar marking how much of the window has elapsed"
        >
          <span>Pace marker</span>
          <input type="checkbox" bind:checked={config.showPace} class="size-4 accent-emerald-500" />
        </label>
        <label class="flex items-center justify-between">
          <span>Show percentages</span>
          <input type="checkbox" bind:checked={config.showPercent} class="size-4 accent-emerald-500" />
        </label>
        <label class="flex items-center justify-between">
          <span>Show times</span>
          <input type="checkbox" bind:checked={config.showTimes} class="size-4 accent-emerald-500" />
        </label>
      </section>
    </div>

    <footer
      class="flex items-center justify-between border-t border-neutral-200 px-5 py-3 dark:border-neutral-800"
    >
      <label class="flex items-center gap-2">
        <input type="checkbox" bind:checked={autostart} onchange={toggleAutostart} class="size-4 accent-emerald-500" />
        <span>Start with Windows</span>
      </label>
      <button
        onclick={() => (config = structuredClone(defaults))}
        class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300">Reset all</button
      >
    </footer>
  {/if}
</main>
