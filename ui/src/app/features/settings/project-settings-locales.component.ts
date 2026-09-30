import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  LocaleFieldError,
  LocaleRow,
  localesChanged,
  urlsWillChange,
  validateLocales,
} from './project-settings-locales.util';
import { LocalesStore } from '../../core/project/locales.store';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { assetRoute } from '../../shared/asset-route.util';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type ProjectLocalesView = components['schemas']['ProjectLocalesView'];
type LocaleWarning = components['schemas']['LocaleWarningView'];

/**
 * Project settings tab: "Languages" — the project's content languages (M24.1.2). Declares the
 * ordered language list, the default language, each language's fallback chain and whether the
 * default language keeps the site root.
 *
 * <p>Enabling languages moves every generated page under a language prefix, so the tab shows the
 * concrete before/after path of a real page and asks for confirmation before saving such a change. A save that leaves
 * page templates whose output path has no `{locale}` (a build would fail, `SF-GEN-0111`) still goes through and lists
 * those templates below, until dismissed or the next save (M35.1).
 */
@Component({
  selector: 'sf-project-settings-locales',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfButtonComponent, SfFieldComponent, SfSpinnerComponent],
  templateUrl: './project-settings-locales.component.html',
  styleUrl: './project-settings-locales.component.scss',
})
export class ProjectSettingsLocalesComponent implements OnInit {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly locales = inject(LocalesStore);
  protected readonly dialog = inject(DialogService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly rows = signal<LocaleRow[]>([]);
  /** The language the editor picked in the select; empty until they pick one. */
  private readonly pickedDefaultLocale = signal('');
  protected readonly defaultWithoutPrefix = signal(false);
  /**
   * The default language in effect. While the pick is empty — or names a language that was since
   * renamed or removed — the first listed language stands in, which is exactly what the select
   * shows the editor. Without this the form would demand a pick the editor already appears to have
   * made, and the save button would never enable.
   */
  protected readonly defaultLocale = computed(() => {
    const picked = this.pickedDefaultLocale();
    const rows = this.rows();
    return rows.some((row) => row.code === picked) ? picked : (rows[0]?.code ?? '');
  });
  /** Field errors the server rejected the last save with; cleared as soon as the form is edited. */
  private readonly serverErrors = signal<LocaleFieldError[]>([]);
  private readonly clientErrors = computed(() => validateLocales(this.rows(), this.defaultLocale()));
  protected readonly errors = computed(() =>
    this.clientErrors().length > 0 ? this.clientErrors() : this.serverErrors(),
  );
  /** The configuration as the server last returned it — what "did the URLs change?" compares against. */
  protected readonly saved = signal<ProjectLocalesView | null>(null);
  /** A sample page uid, so the URL warning shows a path from *this* site rather than a generic one. */
  protected readonly samplePageUid = signal('about');

  /** Whether the form differs from what the server last returned — nothing to save otherwise. */
  protected readonly dirty = computed(() =>
    localesChanged(this.saved(), this.rows(), this.defaultLocale(), this.defaultWithoutPrefix()),
  );

  protected readonly canSave = computed(
    () => !this.readOnly() && !this.saving() && this.dirty() && this.errors().length === 0,
  );

  /** How many stored translations the last save kept for languages that are no longer declared. */
  protected readonly retainedValueCount = computed(() => this.saved()?.retainedValueCount ?? 0);

  protected readonly removedLocales = computed(() => this.saved()?.removedLocales ?? []);

  /** The page template channels the last save found without `{locale}`; empty after a dismissal or a clean save. */
  protected readonly warnings = signal<LocaleWarning[]>([]);
  /** How many there are in all: the server lists the first 50. */
  protected readonly warningCount = signal(0);
  protected readonly moreWarnings = computed(() => Math.max(0, this.warningCount() - this.warnings().length));

  ngOnInit(): void {
    this.api.getProjectLocales(this.projectKey()).subscribe({
      next: (config) => {
        this.apply(config);
        this.loading.set(false);
      },
      error: () => {
        this.toasts.show('Could not load the language settings — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
    // The URL warning shows a path from *this* site, so it uses a real page of the project
    // (tasks/lessons.md: show the concrete rendered example, not a generic one).
    this.api.listPages(this.projectKey()).subscribe({
      next: (pages) => {
        const uid = pages.find((page) => !!page.uid)?.uid;
        if (uid) {
          this.samplePageUid.set(uid);
        }
      },
      error: () => {
        /* the placeholder uid is good enough for the example */
      },
    });
  }

  private apply(config: ProjectLocalesView): void {
    this.saved.set(config);
    this.rows.set(
      (config.locales ?? []).map((locale) => ({
        code: locale.code ?? '',
        label: locale.label ?? '',
        fallbacks: config.fallbacks?.[locale.code ?? ''] ?? [],
      })),
    );
    this.pickedDefaultLocale.set(config.defaultLocale ?? '');
    this.defaultWithoutPrefix.set(config.defaultWithoutPrefix ?? false);
    this.serverErrors.set([]);
    this.locales.set(this.projectKey(), config);
  }

  /** Any edit invalidates the server's verdict on the previous attempt. */
  private revalidate(): void {
    this.serverErrors.set([]);
  }

  protected errorFor(field: string): string | null {
    return this.errors().find((error) => error.field === field)?.message ?? null;
  }

  // ── Editing ─────────────────────────────────────────────────────────────

  protected addLocale(): void {
    if (this.readOnly()) {
      return;
    }
    this.rows.update((rows) => [...rows, { code: '', label: '', fallbacks: [] }]);
    this.revalidate();
  }

  protected removeLocale(index: number): void {
    if (this.readOnly()) {
      return;
    }
    const removed = this.rows()[index]?.code;
    this.rows.update((rows) =>
      rows
        .filter((_, i) => i !== index)
        // A language that no longer exists can't be anyone's fallback either.
        .map((row) => ({ ...row, fallbacks: row.fallbacks.filter((code) => code !== removed) })),
    );
    if (this.pickedDefaultLocale() === removed) {
      this.pickedDefaultLocale.set('');
    }
    this.revalidate();
  }

  protected move(index: number, delta: number): void {
    const target = index + delta;
    if (this.readOnly() || target < 0 || target >= this.rows().length) {
      return;
    }
    this.rows.update((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row);
      return next;
    });
    this.revalidate();
  }

  protected setCode(index: number, value: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, code: value.trim() } : row)));
    this.revalidate();
  }

  protected setLabel(index: number, value: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, label: value } : row)));
    this.revalidate();
  }

  /** Offers the browser's own name for a tag as a label prefill; editors may overwrite it. */
  protected suggestLabel(index: number): void {
    const code = this.rows()[index]?.code;
    if (!code) {
      return;
    }
    let suggested = code;
    try {
      suggested = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    } catch {
      /* an unusual tag simply keeps its own spelling as the label */
    }
    this.setLabel(index, suggested);
  }

  protected toggleFallback(index: number, code: string, checked: boolean): void {
    this.rows.update((rows) =>
      rows.map((row, i) =>
        i === index
          ? {
              ...row,
              fallbacks: checked ? [...row.fallbacks, code] : row.fallbacks.filter((c) => c !== code),
            }
          : row,
      ),
    );
    this.revalidate();
  }

  protected setDefaultLocale(value: string): void {
    this.pickedDefaultLocale.set(value);
    this.revalidate();
  }

  protected setDefaultWithoutPrefix(value: boolean): void {
    this.defaultWithoutPrefix.set(value);
    this.revalidate();
  }

  /** The other declared languages a row may fall back to. */
  protected candidatesFor(index: number): LocaleRow[] {
    return this.rows().filter((_, i) => i !== index);
  }

  /** Any language other than the default — the one the prefix example contrasts against. */
  protected otherLocale(): string {
    return this.rows().find((row) => row.code !== this.defaultLocale())?.code ?? 'en';
  }

  // ── Saving ──────────────────────────────────────────────────────────────

  /** The example the URL-change confirmation shows: this project's own page, before and after. */
  protected urlExample(): { before: string; after: string } {
    const uid = this.samplePageUid();
    const wasLocalized = (this.saved()?.locales?.length ?? 0) > 0;
    const before = wasLocalized ? this.pathFor(uid, this.saved()?.defaultLocale ?? '', this.saved()?.defaultWithoutPrefix ?? false) : `${uid}.html`;
    const after = this.rows().length > 0 ? this.pathFor(uid, this.defaultLocale(), this.defaultWithoutPrefix()) : `${uid}.html`;
    return { before, after };
  }

  private pathFor(uid: string, locale: string, withoutPrefix: boolean): string {
    return withoutPrefix ? `${uid}.html` : `${locale}/${uid}.html`;
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    if (urlsWillChange(this.saved(), this.rows(), this.defaultWithoutPrefix())) {
      const example = this.urlExample();
      this.dialog.open({
        title: 'This changes every page URL',
        message:
          `Generated pages move from "${example.before}" to "${example.after}". ` +
          'Links people have already shared, and search engine results, will point at the old paths until they are redirected.',
        confirmLabel: 'Save and change URLs',
        cancelLabel: 'Cancel',
        kind: 'danger',
      });
      return;
    }
    this.send(false);
  }

  /** The dialog's confirm button: either "yes, change the URLs" or "yes, discard translations". */
  protected confirm(): void {
    if (this.pendingDiscard()) {
      this.confirmDiscard();
      return;
    }
    this.dialog.close();
    this.send(false);
  }

  protected cancel(): void {
    this.dialog.close();
    this.pendingDiscard.set(false);
  }

  private send(confirmDiscard: boolean): void {
    this.saving.set(true);
    const fallbacks: Record<string, string[]> = {};
    this.rows().forEach((row) => {
      if (row.fallbacks.length > 0) {
        fallbacks[row.code] = row.fallbacks;
      }
    });
    this.api
      .updateProjectLocales(
        this.projectKey(),
        {
          locales: this.rows().map((row) => ({ code: row.code, label: row.label })),
          defaultLocale: this.rows().length > 0 ? this.defaultLocale() : undefined,
          fallbacks,
          defaultWithoutPrefix: this.defaultWithoutPrefix(),
        },
        confirmDiscard,
      )
      .subscribe({
        next: (config) => {
          this.saving.set(false);
          if (config.confirmationRequired) {
            // Nothing was written: the change would reduce translated values to one language.
            this.dialog.open({
              title: 'This discards translations',
              message:
                `Turning languages off keeps only the default language: ${config.discardedLocaleValues} ` +
                `translation(s) in ${config.affectedAssets?.length ?? 0} item(s) will be dropped. This cannot be undone.`,
              confirmLabel: 'Discard translations and save',
              cancelLabel: 'Keep languages',
              kind: 'danger',
            });
            this.pendingDiscard.set(true);
            return;
          }
          this.apply(config);
          this.warnings.set(config.warnings ?? []);
          this.warningCount.set(config.warningCount ?? (config.warnings ?? []).length);
          this.toasts.show('Language settings saved', 'success');
        },
        error: (error: HttpErrorResponse) => {
          this.saving.set(false);
          this.applyServerErrors(error);
        },
      });
  }

  protected dismissWarnings(): void {
    this.warnings.set([]);
    this.warningCount.set(0);
  }

  /** The Templates screen with the warned template selected. */
  protected templateRoute(warning: LocaleWarning): { commands: string[]; queryParams: Record<string, string> } {
    return assetRoute(this.projectKey(), { uuid: warning.templateUuid, type: 'PAGE_TEMPLATE' });
  }

  /** Set while a discard confirmation is open, so the dialog's confirm re-sends with the flag. */
  protected readonly pendingDiscard = signal(false);

  private confirmDiscard(): void {
    this.dialog.close();
    this.pendingDiscard.set(false);
    this.send(true);
  }

  private applyServerErrors(error: HttpErrorResponse): void {
    const fieldErrors = (error.error?.errors ?? []) as LocaleFieldError[];
    if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
      this.serverErrors.set(fieldErrors);
      return;
    }
    this.toasts.show(
      error.error?.detail ?? 'Could not save the language settings — try again in a moment.',
      'error',
    );
  }
}
