import { effect, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sf-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.readInitial());

  constructor() {
    effect(() => {
      const value = this.theme();
      document.documentElement.dataset['theme'] = value;
      localStorage.setItem(STORAGE_KEY, value);
    });
  }

  toggle(): Theme {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    return next;
  }

  set(value: Theme): void {
    this.theme.set(value);
  }

  private readInitial(): Theme {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
}
