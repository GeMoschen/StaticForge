import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { problemOf } from '../../../core/api/problem.util';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDataTableColumn } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../../shared/components/forms/sf-checkbox.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { GenerationService } from '../../generation/generation.service';
import {
  type GenerationTargetView,
  KIND_ICONS,
  REDIRECT_OUTPUTS,
  type RedirectKey,
  TARGET_KINDS,
  type TargetDraft,
  type TargetKind,
  draftOf,
  kindOf,
  newDraft,
  requestOf,
} from './targets.util';

/** The server's refusals of the form, by the field they belong to. */
interface FieldErrors {
  name?: string;
  path?: string;
  baseUrl?: string;
}

const ERROR_FIELDS = ['name', 'path', 'baseUrl'] as const;

/**
 * Publishing › Targets (M35.24, gate decisions 27-30): where builds go (Folder, ZIP, S3). A table with ⋮ Edit / Delete
 * (confirm); the form opens in a drawer below the top bar. The server's refusals appear on their fields: a name that is
 * already used (`409`, field `name`), an unusable base URL (`400`, field `baseUrl`) and an output folder that overlaps
 * another target's (`400` without a field). Creating is for developers, changing and deleting for project admins; for
 * everyone else the list is read-only with a hint.
 */
@Component({
  selector: 'sf-publishing-targets',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfSegmentedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './targets.component.html',
  styleUrl: './targets.component.scss',
})
export class PublishingTargetsComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(GenerationService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly kindIcons = KIND_ICONS;
  protected readonly kindOf = kindOf;
  protected readonly redirectOutputs = REDIRECT_OUTPUTS;

  protected readonly targets = signal<readonly GenerationTargetView[]>([]);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly draft = signal<TargetDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly errors = signal<FieldErrors>({});

  /** The row the open drawer edits: the base of its request, which keeps the `config` keys the form does not know. */
  private editing: GenerationTargetView | null = null;

  protected readonly rowKey = (row: GenerationTargetView) => String(row.id);
  protected readonly rowLabel = (row: GenerationTargetView) => row.name ?? '';

  protected readonly canChange = this.permissions.canManageTargets;
  protected readonly empty = computed(() => this.loaded() && this.targets().length === 0);

  protected readonly columns = computed<SfDataTableColumn<GenerationTargetView>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    const columns: SfDataTableColumn<GenerationTargetView>[] = [
      { id: 'name', header: header('name'), value: (r) => r.name ?? '', sortable: true, hideable: false, width: 200 },
      { id: 'kind', header: header('kind'), value: (r) => this.kindName(r), sortable: true, width: 140 },
      { id: 'location', header: header('location'), value: (r) => r.outputPath ?? '', width: 260 },
      { id: 'baseUrl', header: header('baseUrl'), value: (r) => r.baseUrl ?? '', width: 260 },
    ];
    if (this.canChange()) {
      columns.push({ id: 'actions', header: header('actions'), width: 64, align: 'end', hideable: false, searchable: false });
    }
    return columns;
  });

  protected readonly kindOptions = computed<SfSegmentedOption<TargetKind>[]>(() =>
    TARGET_KINDS.map((kind) => ({ value: kind, label: this.t(`kind.${kind}`), icon: KIND_ICONS[kind] })),
  );

  protected readonly drawerTitle = computed(() => {
    const draft = this.draft();
    return draft?.id == null ? this.t('newTitle') : this.t('editTitle', { name: draft.name });
  });

  protected readonly locationHint = computed(() => {
    const hint = this.t('form.locationHint');
    return this.draft()?.id == null ? hint : `${hint} ${this.t('form.editHint')}`;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  protected kindName(row: GenerationTargetView): string {
    return this.t(`kind.${kindOf(row.type)}`);
  }

  protected rowActions(row: GenerationTargetView): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('edit'), icon: 'edit', action: () => this.edit(row) },
      { id: 'delete', label: this.t('delete'), icon: 'delete', danger: true, separatorBefore: true, action: () => void this.delete(row) },
    ];
  }

  protected newTarget(): void {
    if (this.permissions.canCreateTargets()) {
      this.open(newDraft(this.targets().length === 0), null);
    }
  }

  protected edit(row: GenerationTargetView): void {
    if (this.canChange()) {
      this.open(draftOf(row), row);
    }
  }

  protected close(): void {
    this.draft.set(null);
    this.errors.set({});
  }

  /** Changes the draft; an edit answers the server's refusal of the field it touches. */
  protected patch(change: Partial<TargetDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
    this.errors.update((errors) => {
      const next = { ...errors };
      ERROR_FIELDS.filter((field) => field in change).forEach((field) => delete next[field]);
      return next;
    });
  }

  protected patchRedirect(key: RedirectKey, on: boolean): void {
    this.draft.update((d) => (d ? { ...d, redirects: { ...d.redirects, [key]: on } } : d));
  }

  protected save(): void {
    const draft = this.draft();
    if (!draft || !draft.name.trim() || this.saving()) {
      return;
    }
    const request = requestOf(draft, this.editing);
    const call =
      draft.id == null ? this.api.createTarget(this.projectKey(), request) : this.api.updateTarget(this.projectKey(), draft.id, request);
    this.saving.set(true);
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.close();
        this.toasts.show(this.t(draft.id == null ? 'created' : 'updated', { name: request.name }), 'success');
        // Reload rather than patch: saving a default clears the flag on the others server-side.
        this.load(this.projectKey());
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.showSaveError(err);
      },
    });
  }

  protected reload(): void {
    this.load(this.projectKey());
  }

  private showSaveError(err: unknown): void {
    const problem = problemOf(err, this.t('saveFailed'));
    if (problem.status === 409 && problem.field === 'name') {
      this.errors.set({ name: this.t('form.nameUsed') });
    } else if (problem.status === 400 && problem.field === 'baseUrl') {
      this.errors.set({ baseUrl: problem.detail });
    } else if (problem.status === 400 && !problem.field) {
      // An output folder equal to or inside another target's: the server names no field.
      this.errors.set({ path: problem.detail });
    } else {
      this.toasts.show(problem.detail, 'error');
    }
  }

  private async delete(row: GenerationTargetView): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('deleteTitle', { name: row.name }),
      message: this.t('deleteMessage', { path: row.outputPath ?? '' }),
      confirmLabel: this.t('deleteConfirm'),
      tone: 'danger',
    });
    if (!confirmed || row.id == null) {
      return;
    }
    this.api.deleteTarget(this.projectKey(), row.id).subscribe({
      next: () => {
        this.toasts.show(this.t('deleted', { name: row.name }), 'success');
        this.load(this.projectKey());
      },
      error: (err: unknown) => this.toasts.show(problemOf(err, this.t('deleteFailed')).detail, 'error'),
    });
  }

  private open(draft: TargetDraft, row: GenerationTargetView | null): void {
    this.editing = row;
    this.errors.set({});
    this.draft.set(draft);
  }

  private load(projectKey: string): void {
    this.loadError.set(null);
    this.api.listTargets(projectKey).subscribe({
      next: (list) => {
        this.targets.set(list ?? []);
        this.loaded.set(true);
      },
      error: () => this.loadError.set(this.t('loadFailed')),
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.targets.${key}`, params);
  }
}
