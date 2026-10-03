import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { MediaLibraryStore } from './media-library.store';
import { mediaIconFor } from './media-library.util';
import { type UploadItem, MediaUploadStore } from './media-upload.store';

/** Space between the panel and the open detail drawer, in px. */
const DRAWER_GAP = 16;
/** The open drawer's panel (`sf-drawer` moves its host to `<body>`); a modal drawer covers the panel anyway. */
const DRAWER_PANEL = 'sf-drawer:not(.sf-drawer-host--modal) > .sf-drawer';

/**
 * The upload panel (M35.19 phase C, decision 98), docked bottom right of the library and shifted left of the detail
 * drawer while one is open. The header names the target folder and says how the uploads are going (a polite live
 * region) and collapses the list; per file it shows the name, size and a real progress bar with Cancel; a finished
 * picture asks for its alt text right there (field + Save) and can open its details; a refused file says why and offers
 * what fits the reason: *Retry* only for a lost connection (the other reasons would fail again), *Replace* / *Keep both*
 * for a name that is taken, *Remove* for every failure.
 */
@Component({
  selector: 'sf-media-library-uploads',
  standalone: true,
  imports: [SfButtonComponent, SfFileSizePipe, SfIconComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-library-uploads.component.html',
  styleUrl: './media-library-uploads.component.scss',
  host: { '[style.inset-inline-end.px]': 'offset()', '[style.--uploads-offset.px]': 'offset()' },
})
export class MediaLibraryUploadsComponent {
  protected readonly store = inject(MediaUploadStore);
  private readonly library = inject(MediaLibraryStore);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly fileSize = new SfFileSizePipe();

  protected readonly collapsed = signal(false);
  /** The alt texts being typed, by upload. */
  private readonly alts = signal<Readonly<Record<number, string>>>({});
  /** The open drawer's width, 0 while none is open. */
  private readonly drawerWidth = signal(0);
  /** `null` keeps the stylesheet's own distance from the edge. */
  protected readonly offset = computed(() => (this.drawerWidth() > 0 ? this.drawerWidth() + DRAWER_GAP : null));

  protected readonly summary = computed(() => {
    const total = this.store.uploads().length;
    const running = this.store.running();
    return running > 0
      ? this.transloco.translate('media.uploads.running', { count: running, total })
      : this.transloco.translate('media.uploads.finished', { failed: this.store.failed() });
  });
  protected readonly title = computed(() => {
    const { folder, count } = this.store.target();
    return this.transloco.translate(count === 1 ? 'media.uploads.titleTo' : 'media.uploads.titleMany', { folder, count });
  });

  constructor() {
    // Follow the drawer's width (it can be resized) while a file is open.
    effect((onCleanup) => {
      if (!this.library.selectedMedia()) {
        untracked(() => this.drawerWidth.set(0));
        return;
      }
      let frame = 0;
      let observer: ResizeObserver | undefined;
      const attach = (triesLeft: number): void => {
        const panel = this.document.querySelector<HTMLElement>(DRAWER_PANEL);
        if (!panel) {
          if (triesLeft > 0) {
            frame = requestAnimationFrame(() => attach(triesLeft - 1));
          }
          return;
        }
        const measure = (): void => this.drawerWidth.set(Math.round(panel.getBoundingClientRect().width));
        measure();
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure);
          observer.observe(panel);
        }
      };
      attach(30);
      onCleanup(() => {
        cancelAnimationFrame(frame);
        observer?.disconnect();
      });
    }, { allowSignalWrites: true });
  }

  protected iconOf(upload: UploadItem): string {
    if (upload.state === 'error') {
      return 'error';
    }
    if (upload.state === 'done') {
      return 'check_circle';
    }
    return upload.file.type.startsWith('image/') ? 'image' : mediaIconFor(upload.file.type);
  }

  /** Why a file was refused, in words. */
  protected errorText(upload: UploadItem): string {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(`media.uploads.errors.${key}`, params);
    switch (upload.error) {
      case 'type': {
        const types = this.store.allowedTypes().filter((type) => type !== '*' && type !== '*/*');
        return this.store.allowedTypes().length > 0 && types.length === this.store.allowedTypes().length ? t('typeList', { types: types.join(', ') }) : t('type');
      }
      case 'size': {
        const max = this.store.maxBytes();
        return max === null ? t('sizeUnknown') : t('size', { size: this.fileSize.transform(upload.sizeBytes), limit: this.fileSize.transform(max) });
      }
      case 'duplicate':
        return t('duplicate', { folder: upload.folderLabel });
      case 'server':
        return upload.detail ?? t('server');
      default:
        return t('network');
    }
  }

  protected doneText(upload: UploadItem): string {
    return this.transloco.translate('media.uploads.done', {
      name: upload.name,
      outcome: upload.outcome ?? 'plain',
      altSaved: String(upload.alt !== undefined),
    });
  }

  protected altOf(upload: UploadItem): string {
    return this.alts()[upload.id] ?? '';
  }

  protected setAlt(upload: UploadItem, value: string): void {
    this.alts.update((all) => ({ ...all, [upload.id]: value }));
  }

  protected saveAlt(upload: UploadItem): void {
    this.store.saveAlt(upload.id, this.altOf(upload));
  }

  protected openDetails(upload: UploadItem): void {
    if (upload.media?.uuid) {
      this.library.openAsset(upload.media.uuid);
    }
  }
}
