import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { ApiClient } from '../api/api.client';
import type { components } from '../api/generated/schema.d.ts';

type ProjectLocalesView = components['schemas']['ProjectLocalesView'];
type ProjectLocaleView = components['schemas']['ProjectLocaleView'];

/**
 * The project's content languages (M24), loaded once per project and read by every screen that
 * edits content: the language switcher, the form engine's language badges, the preview, the
 * missing-translation indicators.
 *
 * A project that declares no languages leaves {@link isLocalized} false, and every consumer then
 * renders exactly as it did before M24 — no switcher, no badges, no per-language behaviour.
 */
@Injectable({ providedIn: 'root' })
export class LocalesStore {
  private readonly api = inject(ApiClient);

  private readonly loadedFor = signal<string | null>(null);

  readonly config = signal<ProjectLocalesView | null>(null);

  /** The declared languages, in the order the project lists them. */
  readonly locales = computed<ProjectLocaleView[]>(() => this.config()?.locales ?? []);

  /** The default language, or `null` in a project without languages. */
  readonly defaultLocale = computed<string | null>(() => this.config()?.defaultLocale ?? null);

  /** Whether this project declares any content languages at all. */
  readonly isLocalized = computed(() => this.locales().length > 0);

  /** Loads the configuration for a project; a repeat call for the same project is a no-op. */
  load(projectKey: string, force = false): Observable<ProjectLocalesView | null> {
    if (!force && this.loadedFor() === projectKey) {
      return of(this.config());
    }
    return this.api.getProjectLocales(projectKey).pipe(
      tap((config) => {
        this.config.set(config);
        this.loadedFor.set(projectKey);
      }),
    );
  }

  /** Replaces the cached configuration after the Languages tab saved a new one. */
  set(projectKey: string, config: ProjectLocalesView): void {
    this.config.set(config);
    this.loadedFor.set(projectKey);
  }

  /** Forgets the cached configuration (on project switch or sign-out). */
  clear(): void {
    this.config.set(null);
    this.loadedFor.set(null);
  }

  /** The label to show for a language tag, falling back to the tag itself. */
  labelOf(code: string): string {
    return this.locales().find((locale) => locale.code === code)?.label ?? code;
  }

  /**
   * The fallback chain of `code`: the language itself, its declared fallbacks, then the default
   * language — the same order the server resolves values in, so the editor's "inherited from …"
   * hint matches what the page will render.
   */
  chainFor(code: string | null): string[] {
    const config = this.config();
    if (!config || !config.defaultLocale) {
      return [];
    }
    const chain: string[] = [];
    const declared = this.locales().find((locale) => locale.code === code)?.code ?? null;
    if (declared) {
      chain.push(declared);
      for (const next of config.fallbacks?.[declared] ?? []) {
        if (!chain.includes(next)) {
          chain.push(next);
        }
      }
    }
    if (!chain.includes(config.defaultLocale)) {
      chain.push(config.defaultLocale);
    }
    return chain;
  }
}
