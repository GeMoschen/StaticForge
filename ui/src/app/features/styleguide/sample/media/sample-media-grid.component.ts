import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import { SampleMediaFile } from './sample-media-data';
import { SampleMediaState } from './sample-media-state';

/** The first lines of a text file, for its card. */
const SNIPPET_LINES = 7;

/**
 * The library grid (decision 22): one focusable card per file — the thumbnail on the sunken surface, the name
 * (truncated at the end only), "JPG · 1.2 MB", a labelled checkbox top left (shown on hover, focus or when selected)
 * and a status icon when the file is not released.
 *
 * A `role=grid` with a roving tabindex: ←/→/↑/↓ move across the cards as laid out, Home/End go to the first/last,
 * Space toggles the selection, Enter opens the detail, Ctrl/⌘+A selects all. A click opens the file; Ctrl/⌘+click
 * toggles it, Shift+click selects a range.
 */
@Component({
  selector: 'sf-sample-media-grid',
  standalone: true,
  imports: [SfCheckboxComponent, SfFileSizePipe, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-grid.component.html',
  styleUrl: './sample-media-grid.component.scss',
})
export class SampleMediaGridComponent {
  protected readonly state = inject(SampleMediaState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  /** The card in the tab order (by id, so it survives sorting and filtering). */
  private readonly activeId = signal<string | null>(null);
  /** The anchor of Shift+click ranges. */
  private anchor: string | null = null;
  private readonly fileSize = new SfFileSizePipe();

  protected readonly tabStop = computed(() => {
    const files = this.state.visible();
    const active = this.activeId();
    return files.some((f) => f.id === active) ? active : (files[0]?.id ?? null);
  });

  /** The card's name: file name, type and size, and the status when not released. */
  protected cardLabel(file: SampleMediaFile): string {
    const meta = this.state.t('grid.meta', { type: file.format, size: this.fileSize.transform(file.sizeBytes) });
    const status = file.status === 'released' ? [] : [this.state.sample.statusLabel(file.status)];
    return [file.name, meta, ...status].join(', ');
  }

  protected snippet(file: SampleMediaFile): string {
    return (file.source ?? '').split('\n').slice(0, SNIPPET_LINES).join('\n');
  }

  protected onFocus(file: SampleMediaFile): void {
    this.activeId.set(file.id);
  }

  protected onClick(file: SampleMediaFile, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('.card__check')) {
      return; // the checkbox toggles on its own
    }
    this.activeId.set(file.id);
    if (event.shiftKey && this.anchor) {
      this.state.selectRange(this.anchor, file.id);
    } else if (event.ctrlKey || event.metaKey) {
      this.state.toggle(file.id);
      this.anchor = file.id;
    } else {
      this.anchor = file.id;
      this.state.openAsset(file.id);
    }
  }

  protected onCheck(file: SampleMediaFile): void {
    this.state.toggle(file.id);
    this.anchor = file.id;
  }

  protected onKeydown(event: KeyboardEvent): void {
    const files = this.state.visible();
    const current = files.findIndex((f) => f.id === this.tabStop());
    if (current < 0) {
      return;
    }
    const columns = this.columns();
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(files.length - 1, current + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, current - 1);
        break;
      case 'ArrowDown':
        next = current + columns < files.length ? current + columns : current;
        break;
      case 'ArrowUp':
        next = current - columns >= 0 ? current - columns : current;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = files.length - 1;
        break;
      case ' ':
        event.preventDefault();
        this.onCheck(files[current]);
        return;
      case 'Enter':
        event.preventDefault();
        this.state.openAsset(files[current].id);
        return;
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.state.selection.set(files.map((f) => f.id));
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.activeId.set(files[next].id);
    this.host.querySelectorAll<HTMLElement>('.card')[next]?.focus();
  }

  /** How many cards share the first row (the grid reflows with the width). */
  private columns(): number {
    const cards = Array.from(this.host.querySelectorAll<HTMLElement>('.card'));
    const top = cards[0]?.offsetTop ?? 0;
    const inRow = cards.filter((card) => card.offsetTop === top).length;
    return Math.max(1, inRow);
  }
}
