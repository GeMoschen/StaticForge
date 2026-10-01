import { Location } from '@angular/common';
import { Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HashMap, TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleState } from '../sample-state';

/**
 * Shared plumbing of the sample's Changes, Schedules and Publishing areas (M35.9 decisions 26–28). The areas are
 * self-contained: each reads its own query parameters on load and writes them back (replacing the history entry) as
 * the user clicks, merging into whatever else the URL holds — the sample screen's own parameters stay.
 */
export interface SampleAreaQuery {
  /** A query parameter of the URL the area was opened with. */
  get(name: string): string | null;
  /** Sets (or, with `null`, removes) parameters in the current URL without a navigation. */
  set(params: Readonly<Record<string, string | null>>): void;
}

export function injectSampleQuery(): SampleAreaQuery {
  const route = inject(ActivatedRoute);
  const location = inject(Location);
  return {
    get: (name) => route.snapshot.queryParamMap.get(name),
    set: (params) => {
      const [path, search = ''] = location.path().split('?');
      const query = new URLSearchParams(search);
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === '') {
          query.delete(key);
        } else {
          query.set(key, value);
        }
      }
      location.replaceState(path, query.toString());
    },
  };
}

/** A translated text under `prefix`; reading it inside a `computed` tracks the language file. */
export type SampleText = (key: string, params?: HashMap) => string;

export function injectSampleText(prefix: string): SampleText {
  const transloco = inject(TranslocoService);
  const translation = toSignal(transloco.selectTranslation(), { initialValue: null });
  return (key, params) => {
    translation();
    return transloco.translate(`${prefix}.${key}`, params);
  };
}

/**
 * Developer mode: the sample screen's {@link SampleState} when the area runs inside it, else the `dev` query parameter
 * (`dev=1`, default on — like the screen).
 */
export function injectSampleDevMode(): Signal<boolean> {
  const state = inject(SampleState, { optional: true });
  if (state) {
    return state.developerMode;
  }
  const dev = inject(ActivatedRoute).snapshot.queryParamMap.get('dev');
  return computed(() => dev !== '0');
}

/** "Prototype — nothing is saved." and friends: every action that would change something says so. */
export function injectSampleNotice(): (message: string) => void {
  const toasts = inject(ToastService);
  return (message) => toasts.show(message, 'info');
}

/** `value` when it is one of `allowed`, else null. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** A timestamp `minutes` before now (the fake data counts in minutes). */
export function minutesAgo(minutes: number, now = Date.now()): number {
  return now - minutes * 60_000;
}
