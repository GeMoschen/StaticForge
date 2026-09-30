import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTableComponent } from '../../shared/components/sf-table.component';
import { CODE_FORMATS, CODE_FORMAT_LABELS } from '../../shared/code-editor/code-format';
import { ChannelsService } from './channels.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type ChannelView = components['schemas']['ChannelView'];
type ChannelTemplateRef = components['schemas']['ChannelTemplateRef'];
type ChannelCreateRequest = components['schemas']['ChannelCreateRequest'];
type ChannelUpdateRequest = components['schemas']['ChannelUpdateRequest'];

type JsonNode = components['schemas']['JsonNode'];

/** Plain view of a channel's free-form `settings`; keys this form doesn't edit are carried through untouched. */
type ChannelSettings = Record<string, unknown>;

const PROTECTED_KEY = 'html';

const ESCAPING_OPTIONS = ['HTML', 'MARKDOWN', 'NONE'] as const;

/** Spec §15.2 `urlStrategy`; the server rejects anything else. */
const URL_STRATEGY_OPTIONS = ['RELATIVE', 'PRETTY'] as const;

/** Mirrors the server-side validation in `ChannelOutputSettings.validate`. */
const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;
const INDEX_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const settingsOf = (channel: ChannelView | null): ChannelSettings => {
  const settings = channel?.settings as unknown;
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as ChannelSettings)
    : {};
};

const textOf = (settings: ChannelSettings, key: string): string =>
  typeof settings[key] === 'string' ? (settings[key] as string) : '';

interface DeleteConfirmation {
  channel: ChannelView;
  affected: ChannelTemplateRef[];
}

interface BlockedDetail {
  detail?: string;
  blockedBy: { uuid?: string; uid?: string; displayName?: string }[];
}

const isProtected = (channel: ChannelView): boolean =>
  (channel.key ?? '') === PROTECTED_KEY;

@Component({
  selector: 'sf-channels',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    SfIconComponent,
    SfTableComponent,
  ],
  templateUrl: './channels.component.html',
  styleUrl: './channels.component.scss',
})
export class ChannelsComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ChannelsService);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly escapingOptions: readonly string[] = ESCAPING_OPTIONS;
  readonly urlStrategyOptions: readonly string[] = URL_STRATEGY_OPTIONS;
  readonly isProtected = isProtected;

  readonly channels = signal<ChannelView[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly formOpen = signal(false);
  readonly editing = signal<ChannelView | null>(null);
  readonly confirmDelete = signal<DeleteConfirmation | null>(null);
  readonly blocked = signal<BlockedDetail | null>(null);

  readonly form = this.fb.nonNullable.group({
    key: ['', Validators.required],
    name: [''],
    fileExtension: ['', Validators.pattern(EXTENSION_PATTERN)],
    defaultEscaping: ['HTML'],
    enabled: [true],
    copyFrom: [''],
    urlStrategy: ['RELATIVE'],
    trailingSlash: [{ value: false, disabled: true }],
    indexUid: [''],
    indexFileName: ['', Validators.pattern(INDEX_FILE_NAME_PATTERN)],
    highlightAs: ['AUTO'],
  });

  /** "Highlight as" (M33 follow-up): Auto detects; anything else always wins, whatever the extension says. */
  readonly highlightOptions: readonly { value: string; label: string }[] = [
    { value: 'AUTO', label: 'Auto' },
    ...CODE_FORMATS.map((format) => ({ value: format, label: CODE_FORMAT_LABELS[format] })),
  ];

  readonly copyFromOptions = computed<ChannelView[]>(() => {
    const editingKey = this.editing()?.key;
    return this.channels().filter((c) => c.key !== editingKey);
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload());
    });
    // Trailing slash only has an effect with the PRETTY strategy.
    this.form.controls.urlStrategy.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((strategy) => this.syncTrailingSlash(strategy));
  }

  /** Placeholder for the index file name input: what an empty value resolves to. */
  indexFileNamePlaceholder(): string {
    const { fileExtension, key } = this.form.getRawValue();
    return `index.${this.extensionPlaceholder(fileExtension.trim(), key.trim())}`;
  }

  /** The extension an empty file extension resolves to (server: `ChannelOutputSettings.extensionForChannel`). */
  extensionPlaceholder(fileExtension = '', key = this.form.getRawValue().key.trim()): string {
    if (fileExtension) {
      return fileExtension;
    }
    return key === 'markdown' ? 'md' : key || 'html';
  }

  reload(): void {
    this.loading.set(true);
    this.api.list(this.projectKey()).subscribe({
      next: (list) => {
        this.channels.set(list ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load channels — check your connection and try again.', 'error');
      },
    });
  }

  openCreate(): void {
    if (this.readOnly()) {
      return;
    }
    this.editing.set(null);
    this.error.set(null);
    this.blocked.set(null);
    this.form.reset({
      key: '',
      name: '',
      fileExtension: '',
      defaultEscaping: 'HTML',
      enabled: true,
      copyFrom: '',
      urlStrategy: 'RELATIVE',
      trailingSlash: false,
      indexUid: '',
      indexFileName: '',
      highlightAs: 'AUTO',
    });
    this.syncTrailingSlash('RELATIVE');
    this.form.controls.key.enable();
    this.formOpen.set(true);
  }

  openEdit(channel: ChannelView): void {
    if (this.readOnly()) {
      return;
    }
    this.editing.set(channel);
    this.error.set(null);
    this.blocked.set(null);
    const settings = settingsOf(channel);
    const urlStrategy = textOf(settings, 'urlStrategy') || 'RELATIVE';
    this.form.reset({
      key: channel.key ?? '',
      name: channel.name ?? '',
      fileExtension: channel.fileExtension ?? '',
      defaultEscaping: channel.defaultEscaping ?? 'HTML',
      enabled: channel.enabled ?? true,
      copyFrom: '',
      urlStrategy,
      trailingSlash: settings['trailingSlash'] === true,
      indexUid: textOf(settings, 'indexUid'),
      indexFileName: textOf(settings, 'indexFileName'),
      highlightAs: textOf(settings, 'highlightAs') || 'AUTO',
    });
    this.syncTrailingSlash(urlStrategy);
    this.form.controls.key.disable();
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editing.set(null);
    this.error.set(null);
    this.form.controls.key.enable();
  }

  submit(): void {
    if (this.form.invalid || this.submitting() || this.readOnly()) {
      return;
    }
    const editing = this.editing();
    const value = this.form.getRawValue();
    const settings: ChannelSettings = { ...settingsOf(editing) };
    settings['urlStrategy'] = value.urlStrategy;
    if (value.urlStrategy === 'PRETTY') {
      settings['trailingSlash'] = value.trailingSlash;
    } else {
      delete settings['trailingSlash'];
    }
    setOrDelete(settings, 'indexUid', value.indexUid.trim());
    setOrDelete(settings, 'indexFileName', value.indexFileName.trim());
    setOrDelete(settings, 'highlightAs', value.highlightAs === 'AUTO' ? '' : value.highlightAs);
    this.submitting.set(true);
    this.error.set(null);

    if (editing) {
      const req: ChannelUpdateRequest = {
        name: value.name.trim(),
        fileExtension: value.fileExtension.trim(),
        defaultEscaping: value.defaultEscaping,
        enabled: value.enabled,
        // PUT replaces the channel: carry the fields this form doesn't edit.
        isDefault: editing.isDefault ?? false,
        position: editing.position,
        settings: settings as JsonNode,
      };
      this.api.update(this.projectKey(), editing.key ?? '', req).subscribe({
        next: (updated) => {
          this.replaceChannel(updated);
          this.submitting.set(false);
          this.closeForm();
          this.toasts.show('Channel updated', 'success');
        },
        error: (err) => this.onSubmitError(err),
      });
      return;
    }

    const req: ChannelCreateRequest = {
      key: value.key.trim(),
      name: value.name.trim(),
      fileExtension: value.fileExtension.trim(),
      defaultEscaping: value.defaultEscaping,
      enabled: value.enabled,
      settings: settings as JsonNode,
      ...(value.copyFrom ? { copyFrom: value.copyFrom } : {}),
    };
    this.api.create(this.projectKey(), req).subscribe({
      next: (created) => {
        this.channels.update((list) => [...list, created]);
        this.submitting.set(false);
        this.closeForm();
        this.toasts.show('Channel created', 'success');
      },
      error: (err) => this.onSubmitError(err),
    });
  }

  toggleEnabled(channel: ChannelView): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const action = channel.enabled ? 'disable' : 'enable';
    const call = channel.enabled
      ? this.api.disable(key, channel.key ?? '')
      : this.api.enable(key, channel.key ?? '');
    call.subscribe({
      next: (updated) => {
        this.replaceChannel(updated);
        this.toasts.show(`Channel ${action}d`, 'success');
      },
      error: () => this.toasts.show(`Could not ${action} that channel — try again in a moment.`, 'error'),
    });
  }

  requestDelete(channel: ChannelView): void {
    if (this.readOnly()) {
      return;
    }
    this.blocked.set(null);
    this.api.deletePreview(this.projectKey(), channel.key ?? '').subscribe({
      next: (preview) => {
        const affected = preview.affectedTemplates ?? [];
        if (affected.length > 0) {
          this.confirmDelete.set({ channel, affected });
        } else {
          this.performDelete(channel);
        }
      },
      error: () => this.toasts.show('Could not check channel usage — try again in a moment.', 'error'),
    });
  }

  confirmDeleteAction(): void {
    const confirm = this.confirmDelete();
    if (!confirm || this.submitting() || this.readOnly()) {
      return;
    }
    this.performDelete(confirm.channel);
  }

  private performDelete(channel: ChannelView): void {
    this.submitting.set(true);
    this.api.delete(this.projectKey(), channel.key ?? '').subscribe({
      next: () => {
        this.channels.update((list) =>
          list.filter((c) => c.key !== channel.key),
        );
        this.confirmDelete.set(null);
        this.submitting.set(false);
        this.toasts.show('Channel deleted', 'success');
      },
      error: (err) => {
        this.submitting.set(false);
        this.confirmDelete.set(null);
        const blocked = this.blockedDetailOf(err);
        if (blocked) {
          this.blocked.set(blocked);
        } else {
          this.toasts.show('Could not delete channel — it may still be used by a template.', 'error');
        }
      },
    });
  }

  private syncTrailingSlash(strategy: string): void {
    const control = this.form.controls.trailingSlash;
    if (strategy === 'PRETTY') {
      control.enable({ emitEvent: false });
    } else {
      control.disable({ emitEvent: false });
    }
  }

  private replaceChannel(updated: ChannelView): void {
    this.channels.update((list) =>
      list.map((c) => (c.key === updated.key ? updated : c)),
    );
  }

  private onSubmitError(err: unknown): void {
    this.submitting.set(false);
    this.error.set(this.describeError(err) ?? 'Could not save channel — try again in a moment.');
  }

  private describeError(err: unknown): string | null {
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    return e?.error?.detail ?? e?.error?.message ?? e?.message ?? null;
  }

  private blockedDetailOf(err: unknown): BlockedDetail | null {
    if (!(err instanceof HttpErrorResponse) || err.status !== 409) {
      return null;
    }
    const body = err.error as {
      detail?: string;
      blockedBy?: { uuid?: string; uid?: string; displayName?: string }[];
    };
    const blockedBy = Array.isArray(body?.blockedBy) ? body.blockedBy : [];
    if (blockedBy.length === 0 && !body?.detail) {
      return null;
    }
    return { detail: body?.detail, blockedBy };
  }
}

function setOrDelete(settings: ChannelSettings, key: string, value: string): void {
  if (value) {
    settings[key] = value;
  } else {
    delete settings[key];
  }
}
