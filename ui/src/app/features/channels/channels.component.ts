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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTableComponent } from '../../shared/components/sf-table.component';
import { ChannelsService } from './channels.service';

type ChannelView = components['schemas']['ChannelView'];
type ChannelTemplateRef = components['schemas']['ChannelTemplateRef'];
type ChannelCreateRequest = components['schemas']['ChannelCreateRequest'];
type ChannelUpdateRequest = components['schemas']['ChannelUpdateRequest'];

const PROTECTED_KEY = 'html';

const ESCAPING_OPTIONS = ['HTML', 'MARKDOWN', 'NONE'] as const;

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

  readonly escapingOptions: readonly string[] = ESCAPING_OPTIONS;
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
    fileExtension: [''],
    defaultEscaping: ['HTML'],
    enabled: [true],
    copyFrom: [''],
  });

  readonly copyFromOptions = computed<ChannelView[]>(() => {
    const editingKey = this.editing()?.key;
    return this.channels().filter((c) => c.key !== editingKey);
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload());
    });
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
    });
    this.form.controls.key.enable();
    this.formOpen.set(true);
  }

  openEdit(channel: ChannelView): void {
    this.editing.set(channel);
    this.error.set(null);
    this.blocked.set(null);
    this.form.reset({
      key: channel.key ?? '',
      name: channel.name ?? '',
      fileExtension: channel.fileExtension ?? '',
      defaultEscaping: channel.defaultEscaping ?? 'HTML',
      enabled: channel.enabled ?? true,
      copyFrom: '',
    });
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
    if (this.form.invalid || this.submitting()) {
      return;
    }
    const editing = this.editing();
    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);

    if (editing) {
      const req: ChannelUpdateRequest = {
        name: value.name.trim(),
        fileExtension: value.fileExtension.trim(),
        defaultEscaping: value.defaultEscaping,
        enabled: value.enabled,
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
    if (!confirm || this.submitting()) {
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
