import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { indexFileNameOf, normalizeSourcePath, normalizeTargetPath } from './redirect.util';
import { type RedirectRequest, type RedirectView, RedirectsService } from './redirects.service';

type ChannelView = components['schemas']['ChannelView'];
type ProjectLocaleView = components['schemas']['ProjectLocaleView'];

type TargetKind = 'page' | 'path';

/** The form's values; compared with what the dialog opened with, so Save needs a change. */
interface RedirectForm {
  channel: string;
  locale: string;
  fromPath: string;
  targetKind: TargetKind;
  toAssetUuid: string;
  toAssetName: string;
  toPageNumber: number;
  toPath: string;
}

/**
 * Add or edit a manual redirect (M30.6.3): channel, language, the old path as the user knows the URL — shown
 * normalized to the output path the registry stores before saving — and the target, a page (the shared page picker)
 * or a path or URL. Edits send `If-Match`; a stale version offers to reload the redirect as it is now.
 */
@Component({
  selector: 'sf-redirect-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfAssetPickerDialogComponent, SfButtonComponent, SfSpinnerComponent],
  templateUrl: './redirect-dialog.component.html',
  styleUrl: './redirect-dialog.component.scss',
})
export class RedirectDialogComponent {
  private readonly api = inject(RedirectsService);

  readonly projectKey = input.required<string>();
  /** The redirect to edit; `null` adds one. */
  readonly redirect = input<RedirectView | null>(null);
  readonly channels = input<ChannelView[]>([]);
  /** The project's languages; empty in a project without languages (the locale is `""` then). */
  readonly locales = input<ProjectLocaleView[]>([]);
  /** Preselected for a new redirect; the first language when absent. */
  readonly defaultLocale = input<string | null>(null);

  readonly saved = output<RedirectView>();
  readonly closed = output<void>();

  /** The version `If-Match` sends: the opened redirect's, or the reloaded one's after a conflict. */
  private readonly current = signal<RedirectView | null>(null);
  private readonly initial = signal<RedirectForm | null>(null);
  protected readonly form = signal<RedirectForm>(emptyForm('', ''));
  protected readonly picking = signal(false);
  protected readonly submitting = signal(false);
  protected readonly reloading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** A stale `If-Match`: the redirect changed since it was opened. */
  protected readonly conflict = signal(false);
  /** After a reload: the form shows the current version. */
  protected readonly reloaded = signal(false);

  protected readonly editing = computed(() => this.current() !== null);
  protected readonly title = computed(() => (this.editing() ? 'Edit redirect' : 'Add redirect'));
  protected readonly wasAutomatic = computed(() => this.current()?.kind === 'AUTO');
  protected readonly localized = computed(() => this.locales().length > 0);
  private readonly indexFileName = computed(() =>
    indexFileNameOf(this.channels().find((channel) => channel.key === this.form().channel)),
  );
  protected readonly source = computed(() =>
    this.form().fromPath.trim() ? normalizeSourcePath(this.form().fromPath, this.indexFileName()) : null,
  );
  protected readonly target = computed(() =>
    this.form().toPath.trim() ? normalizeTargetPath(this.form().toPath, this.indexFileName()) : null,
  );
  protected readonly valid = computed(() => {
    const form = this.form();
    if (!form.channel || (this.localized() && !form.locale) || !this.source()?.path) {
      return false;
    }
    return form.targetKind === 'page'
      ? !!form.toAssetUuid && Number.isInteger(form.toPageNumber) && form.toPageNumber >= 1
      : !!this.target()?.path;
  });
  protected readonly dirty = computed(() => {
    const initial = this.initial();
    return !initial || JSON.stringify(initial) !== JSON.stringify(this.form());
  });
  protected readonly canSave = computed(() => this.valid() && this.dirty() && !this.submitting() && !this.conflict());

  constructor() {
    effect(() => {
      const redirect = this.redirect();
      const channels = this.channels();
      const locales = this.locales();
      this.defaultLocale();
      untracked(() => this.reset(redirect, channels, locales));
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.picking()) {
      this.picking.set(false);
      return;
    }
    this.close();
  }

  protected close(): void {
    if (!this.submitting()) {
      this.closed.emit();
    }
  }

  protected patch(changes: Partial<RedirectForm>): void {
    this.form.update((form) => ({ ...form, ...changes }));
    this.error.set(null);
  }

  protected onText(field: 'fromPath' | 'toPath', event: Event): void {
    this.patch({ [field]: (event.target as HTMLInputElement).value });
  }

  protected onSelect(field: 'channel' | 'locale', event: Event): void {
    this.patch({ [field]: (event.target as HTMLSelectElement).value });
  }

  protected onPageNumber(event: Event): void {
    this.patch({ toPageNumber: Number((event.target as HTMLInputElement).value) });
  }

  protected onPicked(picked: AssetPicked): void {
    this.picking.set(false);
    this.patch({ toAssetUuid: picked.uuid, toAssetName: picked.label });
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    const form = this.form();
    const body: RedirectRequest = {
      channel: form.channel,
      locale: this.localized() ? form.locale : '',
      fromPath: this.source()!.path,
      ...(form.targetKind === 'page'
        ? { toAssetUuid: form.toAssetUuid, toPageNumber: form.toPageNumber }
        : { toPath: this.target()!.path }),
    };
    const existing = this.current();
    const request =
      existing?.id != null
        ? this.api.update(this.projectKey(), existing.id, existing.version ?? 0, body)
        : this.api.create(this.projectKey(), body);
    this.submitting.set(true);
    this.error.set(null);
    request.subscribe({
      next: (view) => {
        this.submitting.set(false);
        this.saved.emit(view);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, 'Could not save the redirect — try again.');
        if (problem.status === 409 && problem.code === 'SF-API-0409') {
          this.conflict.set(true);
          return;
        }
        this.error.set(problem.detail);
      },
    });
  }

  /** After a conflict: reads the redirect as it is now and shows it — the edits made here are dropped. */
  protected reload(): void {
    const id = this.current()?.id;
    if (id == null || this.reloading()) {
      return;
    }
    this.reloading.set(true);
    this.api.get(this.projectKey(), id).subscribe({
      next: (view) => {
        this.reloading.set(false);
        this.reset(view, this.channels(), this.locales());
        this.reloaded.set(true);
      },
      error: (err: unknown) => {
        this.reloading.set(false);
        const problem = problemOf(err, 'Could not reload the redirect — try again.');
        this.error.set(problem.status === 404 ? 'This redirect was deleted in the meantime.' : problem.detail);
      },
    });
  }

  private reset(redirect: RedirectView | null, channels: ChannelView[], locales: ProjectLocaleView[]): void {
    const defaultChannel = (channels.find((channel) => channel.isDefault) ?? channels[0])?.key ?? '';
    const form: RedirectForm = redirect
      ? {
          channel: redirect.channel ?? defaultChannel,
          locale: redirect.locale ?? '',
          fromPath: redirect.fromPath ?? '',
          targetKind: redirect.toAssetUuid ? 'page' : 'path',
          toAssetUuid: redirect.toAssetUuid ?? '',
          toAssetName: redirect.toAssetName ?? '',
          toPageNumber: redirect.toPageNumber ?? 1,
          toPath: redirect.toPath ?? '',
        }
      : emptyForm(defaultChannel, this.defaultLocale() ?? locales[0]?.code ?? '');
    this.current.set(redirect);
    this.form.set(form);
    this.initial.set(redirect ? form : null);
    this.conflict.set(false);
    this.reloaded.set(false);
    this.error.set(null);
  }
}

function emptyForm(channel: string, locale: string): RedirectForm {
  return {
    channel,
    locale,
    fromPath: '',
    targetKind: 'page',
    toAssetUuid: '',
    toAssetName: '',
    toPageNumber: 1,
    toPath: '',
  };
}
