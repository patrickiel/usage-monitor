# Usage Monitor

A small Windows overlay that shows Claude Code and Codex rate limits on top of the taskbar.
It lives in the system tray; there is no main window.

Built with Tauri 2, Svelte 5 and Tailwind 4.

## Data sources

Claude
- `%TEMP%\claude-statusline-*\usage-cache.json` if a status line script has cached the usage
  response in the last 3 minutes. No request is made in that case.
- Otherwise `GET api.anthropic.com/api/oauth/usage` with the token from
  `~/.claude/.credentials.json`. On HTTP 429 it waits for `Retry-After`.

Codex
- `GET chatgpt.com/backend-api/wham/usage` with the token from `~/.codex/auth.json`.
- Falls back to the last `rate_limits` entry in the newest `~/.codex/sessions` log.

Tokens are only read, never refreshed or written. Both endpoints are undocumented and may change.
The last successful result per provider is cached, so the overlay shows the last known values
when a request fails.

## Install

Run `Usage Monitor_<version>_x64-setup.exe`. It installs for the current user and needs no admin
rights. Settings are stored in `%APPDATA%\dev.patrickiel.usage-monitor`.

## Development

Requires Node, pnpm and a Rust toolchain.

```
pnpm install
pnpm tauri dev
pnpm check      # svelte-check
pnpm release    # installer in src-tauri/target/release/bundle/nsis
```

## Adding a provider

Implement `Provider` from `src/providers/types.ts` and add it to the list in
`src/providers/index.ts`:

```ts
export const example: Provider = {
  id: 'example',
  name: 'Example',
  icon: SomePhosphorIcon,
  async fetch() {
    return {
      bars: [{ label: '5h', percent: 42, resetsAt: new Date(), windowSeconds: 5 * 3600 }],
      fetchedAt: new Date(),
    };
  },
};
```

Files outside the home folders already in scope, or new hosts, need to be allowed in
`src-tauri/capabilities/default.json`.
