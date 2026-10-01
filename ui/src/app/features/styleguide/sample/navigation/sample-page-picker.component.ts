import { ChangeDetectionStrategy, Component, afterNextRender, computed, input, output, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTreeComponent } from '../../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { SampleEntry, SampleLang } from '../sample-data';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import { pageById, pageChildren, pagePath } from './navigation-data';

/**
 * The restyled page picker (M35.9 decision 24, M35.17 "pick through the asset picker"): an `sf-dialog` (lg) with the
 * Pages tree — filterable, each page with its public URL — and a preview line of the chosen page (name, URL, status).
 * OK hands the page to the host; folders can't be targets.
 */
@Component({
  selector: 'sf-sample-page-picker',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfIconComponent, SfStatusComponent, SfTreeComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-page-picker.component.html',
  styleUrl: './sample-page-picker.component.scss',
})
export class SamplePagePickerComponent {
  /** The current target (selected and revealed when the dialog opens). */
  readonly current = input<string | null>(null);
  /** The editing language: which status the pages show. */
  readonly lang = input<SampleLang>('en');

  /** OK: the chosen page's id. */
  readonly picked = output<string>();
  /** Cancel, Escape, × or the backdrop. */
  readonly closed = output<void>();

  private readonly tree = viewChild.required<SfTreeComponent<SampleEntry>>(SfTreeComponent);

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  /** The row the user selected (a page or a folder); starts on the current target. */
  protected readonly chosen = signal<string | null>(null);
  protected readonly initialSelection = computed(() => {
    const id = this.current();
    return id ? [id] : [];
  });
  protected readonly candidateEntry = computed(() => pageById(this.chosen() ?? this.current()));
  /** The page OK would pick; a folder isn't one. */
  protected readonly candidate = computed(() => {
    const entry = this.candidateEntry();
    return entry?.kind === 'page' ? entry : null;
  });

  protected readonly loader: SfTreeLoader<SampleEntry> = (parent) =>
    pageChildren(parent?.id ?? null).map(
      (entry): SfTreeNode<SampleEntry> => ({
        id: entry.id,
        label: entry.name,
        icon: entry.kind === 'folder' ? 'folder' : entry.startPage ? 'home' : 'description',
        // The public URL is user-facing: always shown, not only in developer mode.
        secondary: entry.kind === 'page' ? entry.url : null,
        hasChildren: entry.kind === 'folder' && (entry.children?.length ?? 0) > 0,
        data: entry,
      }),
    );

  constructor() {
    // Open where the current target is.
    afterNextRender(() => {
      const id = this.current();
      if (id) {
        void this.tree().reveal(pagePath(id));
      }
    });
  }

  protected onSelection(ids: readonly string[]): void {
    this.chosen.set(ids[0] ?? null);
  }

  protected confirm(): void {
    const page = this.candidate();
    if (page) {
      this.picked.emit(page.id);
    }
  }
}
