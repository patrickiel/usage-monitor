// Builds the signed installer and the updater manifest (latest.json) for a GitHub release.
// Signing key: USAGE_MONITOR_SIGNING_KEY (path or contents), else ~/.tauri/usage-monitor.key.
// Global TAURI_SIGNING_* variables are ignored: they may belong to another app.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const repo = 'patrickiel/usage-monitor';
const { version } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));

const key = process.env.USAGE_MONITOR_SIGNING_KEY ?? join(homedir(), '.tauri', 'usage-monitor.key');
if (!process.env.USAGE_MONITOR_SIGNING_KEY && !existsSync(key)) {
  console.error(`Signing key not found: ${key}`);
  process.exit(1);
}

execSync('pnpm tauri build', {
  stdio: 'inherit',
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PATH: undefined,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.USAGE_MONITOR_SIGNING_KEY_PASSWORD ?? '',
  },
});

// GitHub turns spaces in asset names into dots, so publish without them.
const dir = 'src-tauri/target/release/bundle/nsis';
const built = join(dir, `Usage Monitor_${version}_x64-setup.exe`);
const asset = `UsageMonitor_${version}_x64-setup.exe`;
copyFileSync(built, join(dir, asset));

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${built}.sig`, 'utf8'),
      url: `https://github.com/${repo}/releases/download/v${version}/${asset}`,
    },
  },
};
writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nUpload to release v${version}:\n  ${join(dir, asset)}\n  ${join(dir, 'latest.json')}`);
