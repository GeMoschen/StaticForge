import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { PublishTarget, TARGETS, TargetKind } from './publishing-data';
import { PublishingState } from './publishing-state';

const KIND_ICONS: Readonly<Record<TargetKind, string>> = { folder: 'folder', zip: 'folder_zip', s3: 'cloud' };
const REDIRECT_OUTPUTS = ['html', 'htaccess', 'json'] as const;

/** A target being edited in the drawer (`id` null: a new one). */
interface TargetDraft {
  id: string | null;
  name: string;
  kind: TargetKind;
  location: string;
  baseUrl: string;
  isDefault: boolean;
  redirects: Record<(typeof REDIRECT_OUTPUTS)[number], boolean>;
}

/**
 * Publishing › Targets: where builds go (kinds Folder, ZIP, S3). Table with ⋮ Edit / Delete (confirm); the form opens in a
 * drawer (`tdrawer=new|<targetId>`, `terror=1` shows the server's "name already used"). Without a target (`notargets=1`)
 * an empty state offers New target; an editor (`role=editor`) only reads the list: no New target, no ⋮ menu, a hint.
 */
@Component({
  selector: 'sf-sample-targets',
  standalone: true,
  imports: [
    SfBadgeComponent,
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
  templateUrl: './sample-targets.component.html',
  styleUrl: './sample-targets.component.scss',
})
export class SampleTargetsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);

  private readonly removed = signal<readonly string[]>([]);
  protected readonly rows = computed<readonly PublishTarget[]>(() =>
    this.state.noTargets() ? [] : TARGETS.filter((r) => !this.removed().includes(r.id)),
  );
  protected readonly readonly = computed(() => this.state.role() === 'editor');
  protected readonly draft = signal<TargetDraft | null>(null);
  /** The server refused the name as already used (shown with `terror=1`, or after Save when that is set). */
  protected readonly rejected = signal(this.state.targetError());
  protected readonly kindIcons = KIND_ICONS;
  protected readonly redirectOutputs = REDIRECT_OUTPUTS;
  protected readonly rowKey = (row: PublishTarget) => row.id;
  protected readonly rowLabel = (row: PublishTarget) => row.name;

  protected readonly columns = computed<SfDataTableColumn<PublishTarget>[]>(() => {
    const h = (id: string) => this.t(`targets.columns.${id}`);
    const actions: SfDataTableColumn<PublishTarget>[] = this.readonly()
      ? []
      : [{ id: 'actions', header: h('actions'), width: 64, align: 'end', hideable: false, searchable: false }];
    return [
      { id: 'name', header: h('name'), value: (r) => r.name, sortable: true, hideable: false, width: 200 },
      { id: 'kind', header: h('kind'), value: (r) => this.t(`targets.kind.${r.kind}`), sortable: true, width: 140 },
      { id: 'location', header: h('location'), value: (r) => r.location, width: 260 },
      { id: 'baseUrl', header: h('baseUrl'), value: (r) => r.baseUrl, width: 260 },
      ...actions,
    ];
  });

  protected readonly kindOptions = computed<SfSegmentedOption<TargetKind>[]>(() =>
    (['folder', 'zip', 's3'] as const).map((k) => ({ value: k, label: this.t(`targets.kind.${k}`), icon: KIND_ICONS[k] })),
  );

  protected readonly drawerTitle = computed(() => {
    const draft = this.draft();
    return draft?.id ? this.t('targets.editTitle', { name: draft.name }) : this.t('targets.newTitle');
  });

  constructor() {
    const id = this.state.targetDrawer();
    const row = TARGETS.find((r) => r.id === id);
    if (id === 'new') {
      this.newTarget();
    } else if (row) {
      this.edit(row);
    } else {
      this.state.targetDrawer.set(null);
    }
  }

  protected rowActions(row: PublishTarget): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('targets.edit'), icon: 'edit', action: () => this.edit(row) },
      { id: 'delete', label: this.t('targets.delete'), icon: 'delete', danger: true, separatorBefore: true, action: () => void this.delete(row) },
    ];
  }

  protected newTarget(): void {
    this.openDraft({ id: null, name: '', kind: 'folder', location: '', baseUrl: '', isDefault: false, redirects: { html: true, htaccess: false, json: false } });
  }

  protected edit(row: PublishTarget): void {
    if (!this.readonly()) {
      this.openDraft({ ...row, redirects: { html: true, htaccess: row.kind === 'folder', json: false } });
    }
  }

  /** Opens (or, with null, closes) the drawer, mirrored in `tdrawer`. */
  protected openDraft(draft: TargetDraft | null): void {
    this.draft.set(draft);
    this.state.targetDrawer.set(draft ? (draft.id ?? 'new') : null);
  }

  protected patch(change: Partial<TargetDraft>): void {
    if ('name' in change) {
      this.rejected.set(false);
    }
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected patchRedirect(key: (typeof REDIRECT_OUTPUTS)[number], on: boolean): void {
    this.draft.update((d) => (d ? { ...d, redirects: { ...d.redirects, [key]: on } } : d));
  }

  protected save(): void {
    if (this.state.targetError()) {
      this.rejected.set(true);
      return;
    }
    this.state.notice();
    this.openDraft(null);
  }

  private async delete(row: PublishTarget): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('targets.deleteTitle', { name: row.name }),
      message: this.t('targets.deleteMessage', { path: row.location || `target-${row.id}` }),
      confirmLabel: this.t('targets.deleteConfirm'),
      tone: 'danger',
    });
    if (confirmed) {
      this.removed.update((ids) => [...ids, row.id]);
      this.state.notice('targets.deleted', { name: row.name });
    }
  }
}
