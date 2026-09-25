<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
  import CircleHalfIcon from 'phosphor-svelte/lib/CircleHalfIcon';
  import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
  import SunIcon from 'phosphor-svelte/lib/SunIcon';
  import { availableMonitors, getCurrentWindow, primaryMonitor, type Monitor } from '@tauri-apps/api/window';
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
  import { providers } from '../providers';
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

  type NumberKey = 'scale' | 'barWidth' | 'barHeight' | 'opacity' | 'refreshSeconds';

  const sliders: { key: NumberKey; label: string; min: number; max: number; step: number; format: (v: number) => string }[] = [
    { key: 'scale', label: 'Scale', min: 0.75, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
    { key: 'barWidth', label: 'Bar width', min: 24, max: 120, step: 2, format: (v) => `${v}px` },
    { key: 'barHeight', label: 'Bar thickness', min: 2, max: 10, step: 1, format: (v) => `${v}px` },
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

  async function toggleAutostart() {
    await (autostart ? enable() : disable());
  }
</script>

<main
  class="min-h-screen space-y-5 bg-white p-5 text-sm text-neutral-800 select-none dark:bg-neutral-900 dark:text-neutral-200"
>
  {#if config}
    <section class="space-y-2">
      <h2 class={heading}>Monitor</h2>
      <select bind:value={config.monitor} class={[field, 'py-1.5']}>
        <option value="">Primary</option>
        {#each monitors as m, i (m.name)}
          <option value={m.name}>{monitorLabel(m, i)}</option>
        {/each}
      </select>
    </section>

    <section class="flex gap-5">
      <div class="space-y-2">
        <h2 class={heading}>Dock</h2>
        <div class="grid w-24 grid-cols-3 gap-1">
          {#each anchors as a (a)}
            <button
              aria-label={a}
              title={a}
              onclick={() => (config!.anchor = a)}
              class={['h-6 rounded border transition-colors', config.anchor === a ? selected : unselected]}
            ></button>
          {/each}
        </div>
      </div>

      <div class="flex-1 space-y-2">
        <h2 class={heading}>Offset</h2>
        {#each [['X', 'offsetX'], ['Y', 'offsetY']] as const as [label, key] (key)}
          <label class="flex items-center gap-2">
            <span class="w-3 text-neutral-500 dark:text-neutral-400">{label}</span>
            <input type="number" bind:value={config[key]} class={[field, 'py-1 font-mono']} />
          </label>
        {/each}
      </div>
    </section>

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
    </section>

    <section class="space-y-2">
      <h2 class={heading}>Providers</h2>
      {#each providers as p (p.id)}
        <label class="flex items-center justify-between">
          <span class="flex items-center gap-2">
            <p.icon size="1.2em" color={p.accent ?? 'currentColor'} />{p.name}
          </span>
          <input
            type="checkbox"
            checked={config.providers[p.id] !== false}
            onchange={(e) => (config!.providers[p.id] = e.currentTarget.checked)}
            class="size-4 accent-emerald-500"
          />
        </label>
      {/each}
    </section>

    <section class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <label class="flex items-center gap-2">
        <input type="checkbox" bind:checked={autostart} onchange={toggleAutostart} class="size-4 accent-emerald-500" />
        <span>Start with Windows</span>
      </label>
      <button
        onclick={() => (config = { ...defaults, providers: {} })}
        class="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300">Reset</button
      >
    </section>
  {/if}
</main>
