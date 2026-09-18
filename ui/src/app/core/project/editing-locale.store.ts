import { computed, inject, Injectable, signal } from '@angular/core';
import { LocalesStore } from './locales.store';
import type { EditingLocale } from '../../features/forms/l10n.util';

const STORAGE_PREFIX = 'sf.editingLocale.';

/**
 * Which language the editor is currently working in (M24.4.1). One store for the whole app, so the
 * page editor, the globals and record editors, the media drawer, the navigation labels, the preview
 * and the search palette all agree without passing a language through every component.
 *
 * <p>Remembered per project in `localStorage` as a per-viewer convenience — never as state anything
 * depends on, so a browser that refuses storage simply starts on the default language again.
 */
@Injectable({ providedIn: 'root' })
export class EditingLocaleStore {
  private readonly locales = inject(LocalesStore);

  private readonly selected = signal<string | null>(null);

  /**
   * The language being edited: the chosen one when it is still declared, otherwise the project's
   * default. `null` in a project without languages, which is what keeps every form pre-M24.
   */
  readonly locale = computed<string | null>(() => {
    if (!this.locales.isLocalized()) {
      return null;
    }
    const chosen = this.selected();
    const declared = this.locales.locales().some((locale) => locale.code === chosen);
    return declared ? chosen : this.locales.defaultLocale();
  });

  /** Whether the editor is looking at the project's default language. */
  readonly isDefault = computed(() => this.locale() === this.locales.defaultLocale());

  /** What the form engine binds with; `null` in a project without languages. */
  readonly binding = computed<EditingLocale | null>(() => {
    const locale = this.locale();
    return locale === null ? null : { locale, chain: this.locales.chainFor(locale) };
  });

  /** Restores the remembered language for a project, if the browser kept one. */
  restore(projectKey: string): void {
    try {
      this.selected.set(localStorage.getItem(STORAGE_PREFIX + projectKey));
    } catch {
      this.selected.set(null);
    }
  }

  /** Switches the editing language and remembers it for this project. */
  set(projectKey: string, locale: string | null): void {
    this.selected.set(locale);
    try {
      if (locale === null) {
        localStorage.removeItem(STORAGE_PREFIX + projectKey);
      } else {
        localStorage.setItem(STORAGE_PREFIX + projectKey, locale);
      }
    } catch {
      /* a private window simply forgets the choice on reload */
    }
  }
}
