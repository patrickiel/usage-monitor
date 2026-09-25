export type Theme = 'auto' | 'light' | 'dark';

const media = matchMedia('(prefers-color-scheme: dark)');
let theme: Theme = 'auto';

function apply() {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && media.matches));
}

// Auto mode follows Windows switching between light and dark while running.
media.addEventListener('change', apply);
apply();

export function setTheme(next: Theme) {
  theme = next;
  apply();
}
