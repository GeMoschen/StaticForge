import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, model, untracked, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { mediaFocalShortcuts } from '../../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { SfCodeEditorComponent } from '../../../shared/code-editor/code-editor.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfFileDropComponent } from '../../../shared/components/forms/sf-file-drop.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { formatOf, isTransparent, mediaIconFor } from '../library/media-library.util';
import { resolveHighlight } from './media-drawer-highlight';
import { MediaDrawerFilesStore } from './media-drawer-files.store';
import { MediaDrawerMetadataStore, clampPercent, hasFocalPoint, type FocalPercent } from './media-drawer-metadata.store';
import { MediaDrawerPreviewStore } from './media-drawer-preview.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { MediaDrawerVersionsStore } from './media-drawer-versions.store';
import { MediaDrawerStore } from './media-drawer.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';

/** The preview's largest height, rem (a portrait picture gets narrower). */
const PREVIEW_HEIGHT_REM = 20;

/** The accept filter of Replace: a file of the kind the open file is. */
function acceptFor(mimeType: string | undefined, format: string): string | null {
  if (!mimeType) {
    return null;
  }
  if (mimeType === 'image/svg+xml') {
    return '.svg,image/svg+xml';
  }
  if (mimeType.startsWith('image/')) {
    return 'image/*';
  }
  return format ? `${mimeType},.${format.toLowerCase()}` : mimeType;
}

/**
 * The Details tab (decision 21): a large preview — the picture fitted, a checkerboard behind transparent files, an icon
 * for a PDF, the highlighted text of a text file — with the focal point of a photo set by clicking the preview (arrow
 * keys move it while the preview has focus, Shift for 10 %); alt text and caption of the editing language; the file's
 * facts; a styled Replace; and in developer mode the focal point as numbers, the UID, the path, the media type, the
 * hash and the storage path. The edits are kept by the drawer's Save.
 */
@Component({
  selector: 'sf-media-drawer-details',
  standalone: true,
  imports: [
    SfCodeEditorComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfFileDropComponent,
    SfFileSizePipe,
    SfIconComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfRelativeTimeComponent,
    SfSkeletonComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-drawer-details.component.html',
  styleUrl: './media-drawer-details.component.scss',
})
export class MediaDrawerDetailsComponent {
  /** The folder the file lives in (`/media_root/photos/`), for the developer view's path. */
  readonly folderPath = input<string | null>(null);
  /** "Replace" was chosen in the ⋮ menu: bring the Replace field into view and focus it. */
  readonly replaceRequest = model(false);

  protected readonly core = inject(MediaDrawerStore);
  protected readonly metadata = inject(MediaDrawerMetadataStore);
  protected readonly preview = inject(MediaDrawerPreviewStore);
  protected readonly text = inject(MediaDrawerTextStore);
  protected readonly files = inject(MediaDrawerFilesStore);
  protected readonly versions = inject(MediaDrawerVersionsStore);
  protected readonly devMode = inject(DeveloperModeService).enabled;
  private readonly project = inject(ProjectContextStore);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly drop = viewChild(SfFileDropComponent);

  protected readonly media = this.core.media;
  protected readonly draft = this.metadata.draft;
  protected readonly format = computed(() => formatOf({ mimeType: this.media().mimeType, displayName: this.media().fileName, uid: this.media().uid }));
  protected readonly isImage = computed(() => (this.media().mimeType ?? '').startsWith('image/'));
  /** What the preview shows: the picture, the text of a text file, or the file's icon (PDFs and the rest). */
  protected readonly kind = computed<'image' | 'text' | 'icon'>(() => {
    if (this.isImage()) {
      return 'image';
    }
    return this.media().textEditable ? 'text' : 'icon';
  });
  protected readonly icon = computed(() => mediaIconFor(this.media().mimeType));
  protected readonly checker = computed(() => this.isImage() && isTransparent(this.media().mimeType));
  /** Only photos get a focal point: PNG and SVG pictures, PDFs and text files are used as they are (decision 101). */
  protected readonly hasFocal = computed(() => hasFocalPoint(this.media()) && this.draft().focal !== null);
  protected readonly hasAlt = computed(() => this.isImage());
  protected readonly hasCaption = computed(() => this.media().mimeType !== 'text/css');
  protected readonly editable = computed(() => !this.core.readOnly());
  protected readonly accept = computed(() => acceptFor(this.media().mimeType, this.format()));
  protected readonly highlight = computed(() => resolveHighlight(this.media(), this.project.project()?.codeHighlighting));
  protected readonly textTooLarge = this.text.tooLarge;

  /** The preview frame keeps the picture's aspect, within the preview's height. */
  protected readonly frameWidth = computed(() => {
    const image = this.media().image;
    return image?.width && image.height ? `min(100%, ${((PREVIEW_HEIGHT_REM * image.width) / image.height).toFixed(2)}rem)` : null;
  });
  protected readonly frameAspect = computed(() => {
    const image = this.media().image;
    return image?.width && image.height ? `${image.width} / ${image.height}` : null;
  });

  protected readonly kindLabel = computed(() => {
    const key = `media.drawer.details.kinds.${this.format()}`;
    const label = this.transloco.translate(key);
    return label === key ? this.format() : label;
  });
  protected readonly path = computed(() => {
    const folder = (this.folderPath() ?? '').replace(/^\/?media_root/, '/media');
    return `${folder.replace(/\/?$/, '/')}${this.media().fileName ?? ''}`;
  });
  protected readonly storagePath = computed(() => {
    const hash = this.media().blobSha256;
    return hash ? `blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}` : '';
  });
  /** The locale code the alt text and caption are written for; `null` in a project without languages. */
  protected readonly locale = this.core.editingLocale.locale;

  constructor() {
    // The preview answers to the arrow keys itself (focus on the picture); the `?` sheet lists them (decision 100).
    inject(ShortcutService).use(mediaFocalShortcuts(() => this.hasFocal() && this.editable()));
    // "Replace" from the ⋮ menu: bring the Replace field into view and focus its button.
    effect(() => {
      if (!this.replaceRequest()) {
        return;
      }
      untracked(() => {
        this.replaceRequest.set(false);
        setTimeout(() => {
          const field = this.host.querySelector<HTMLElement>('.replace');
          field?.scrollIntoView?.({ block: 'nearest' });
          field?.querySelector<HTMLElement>('button')?.focus();
        });
      });
    });
  }

  /** A click on the preview puts the focal point there. */
  protected onPreviewClick(event: MouseEvent): void {
    if (!this.hasFocal() || !this.editable()) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    this.metadata.setFocal({
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    });
  }

  /** Arrow keys move the focal point by 1 % (Shift: 10 %). */
  protected onPreviewKeydown(event: KeyboardEvent): void {
    const focal = this.draft().focal;
    if (!focal || !this.hasFocal() || !this.editable() || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, FocalPercent> = {
      ArrowLeft: { x: focal.x - step, y: focal.y },
      ArrowRight: { x: focal.x + step, y: focal.y },
      ArrowUp: { x: focal.x, y: focal.y - step },
      ArrowDown: { x: focal.x, y: focal.y + step },
    };
    const next = moves[event.key];
    if (!next) {
      return;
    }
    event.preventDefault();
    // The arrow keys move the point here, not through the drawer's files.
    event.stopPropagation();
    this.metadata.setFocal(next);
  }

  protected setFocalX(value: number | null): void {
    const focal = this.draft().focal;
    if (focal && value !== null) {
      this.metadata.setFocal({ x: value, y: focal.y });
    }
  }

  protected setFocalY(value: number | null): void {
    const focal = this.draft().focal;
    if (focal && value !== null) {
      this.metadata.setFocal({ x: focal.x, y: value });
    }
  }

  protected onReplace(files: File[]): void {
    if (files.length === 0) {
      return;
    }
    // The chosen file goes straight to the server: the drop zone does not keep a list of it (emptying it reports again,
    // with no file, which ends here).
    this.drop()?.value.set([]);
    void this.files.replaceFile(files[0]);
  }
}
