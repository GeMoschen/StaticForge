import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../shared/components/dialog/sf-drawer.component';
import { SfRadioGroupComponent, type SfRadioOption } from '../../shared/components/forms/sf-radio-group.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { type NavEntry, type NavIndex, type NavUrls, entryUrl, navChildren } from './navigation-tree.util';
import { NavigationService, etagFor } from './navigation.service';

/** The value of "no entry page" in the radio group; the others are `<kind>:<uuid>` of a direct child. */
const NONE = '';

/**
 * The **entry page** of a menu folder (M31, M35.22 follow-up; decision 168): the child that opens when the folder itself
 * is clicked in the generated menu. A right-hand drawer lists *None — grouping only* and every direct child — a menu item
 * (with the page it leads to) or a sub-folder (opening its own entry page) — because the server accepts only a direct
 * child (`PAGE_REFERENCE` or `FOLDER`) as the folder's `startNode`. *Apply* writes it with the folder's revision as
 * `If-Match` (one revision) and offers one Undo that writes the previous choice back; nothing is saved before. It works
 * for every menu folder including the fixed "All navigation" wrapper, and is read-only without edit permission (viewers,
 * time travel, archived projects). Visibility never changes what resolves here: a hidden child can be the entry page.
 */
@Component({
  selector: 'sf-nav-entry-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfDrawerComponent, SfDrawerFooterDirective, SfRadioGroupComponent, TranslocoPipe],
  templateUrl: './nav-entry-drawer.component.html',
  styleUrl: './nav-entry-drawer.component.scss',
})
export class NavEntryDrawerComponent {
  readonly projectKey = input.required<string>();
  /** The folder whose entry page is chosen. */
  readonly folder = input.required<NavEntry>();
  readonly index = input.required<NavIndex>();
  readonly urls = input<NavUrls>(new Map());

  /** The drawer wants to close (Escape, ×, Cancel, or after Apply). */
  readonly closed = output<void>();
  /** The entry page was written (or taken back): the menu reads again. */
  readonly changed = output<void>();

  private readonly nav = inject(NavigationService);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditContent;

  protected readonly saving = signal(false);

  /** What the folder has now, as a radio value. */
  private readonly stored = computed(() => {
    const entry = this.folder().entry;
    return entry ? `${entry.kind}:${entry.uuid}` : NONE;
  });
  private readonly pending = signal<string | null>(null);
  protected readonly chosen = computed(() => this.pending() ?? this.stored());
  protected readonly dirty = computed(() => this.chosen() !== this.stored());

  protected readonly children = computed(() => navChildren(this.index(), this.folder().uuid));
  protected readonly options = computed<SfRadioOption<string>[]>(() => {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`navigation.entry.${key}`, params);
    return [
      { value: NONE, label: t('none'), description: t('noneHint') },
      ...this.children().map((child) => {
        const where = entryUrl(child, this.urls()) ?? child.targetName;
        const what = child.kind === 'item' ? t('kindItem') : t('kindFolder');
        return {
          value: `${child.kind === 'item' ? 'PAGE_REFERENCE' : 'FOLDER'}:${child.uuid}`,
          label: child.label,
          description: where ? t('leadsTo', { kind: what, where }) : t('leadsNowhere', { kind: what }),
        };
      }),
    ];
  });
  protected readonly title = computed(() => this.transloco.translate('navigation.entry.title', { name: this.folder().label }));

  protected choose(value: string | null): void {
    this.pending.set(value ?? NONE);
  }

  protected async apply(): Promise<void> {
    const next = this.chosen();
    const before = this.stored();
    if (!this.dirty() || this.saving() || !this.canEdit()) {
      return;
    }
    const key = this.projectKey();
    const uuid = this.folder().uuid;
    const write = (target: string, revision: number | null) => {
      const at = target.indexOf(':');
      const startNode =
        target === NONE ? null : { kind: target.slice(0, at) as 'PAGE_REFERENCE' | 'FOLDER', assetUuid: target.slice(at + 1) };
      return firstValueFrom(this.nav.updateFolder(key, uuid, { startNode }, revision == null ? undefined : etagFor(revision)));
    };
    this.saving.set(true);
    try {
      const updated = await write(next, this.folder().revision);
      const name = this.options().find((option) => option.value === next)?.label ?? '';
      const message = this.transloco.translate(next === NONE ? 'navigation.tree.toast.entryCleared' : 'navigation.tree.toast.entrySet', { name });
      // Undo writes the previous entry page back, against the revision this write produced.
      this.undo.offer(message, () => write(before, updated.revision ?? null).then(() => this.changed.emit()));
      this.changed.emit();
      this.closed.emit();
    } catch {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.entryFailed'), 'error');
    } finally {
      this.saving.set(false);
    }
  }
}
