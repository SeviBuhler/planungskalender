import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'fortwo.theme';

// Light, dark or like the device. Sets the .dark class on <html> that Tailwind's dark: variant uses.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readMode());
  // Missing in some test environments
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');

  constructor() {
    this.media?.addEventListener('change', () => this.apply());
    this.apply();
  }

  set(mode: ThemeMode) {
    this.mode.set(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* private mode */ }
    this.apply();
  }

  private apply() {
    const mode = this.mode();
    const dark = mode === 'dark' || (mode === 'system' && !!this.media?.matches);
    document.documentElement.classList.toggle('dark', dark);
  }
}

function readMode(): ThemeMode {
  try {
    const mode = localStorage.getItem(THEME_KEY);
    return mode === 'light' || mode === 'dark' ? mode : 'system';
  } catch {
    return 'system';
  }
}
