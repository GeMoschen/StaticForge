import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfCodeEditorComponent } from '../../../../shared/code-editor/code-editor.component';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfFileDropComponent } from '../../../../shared/components/forms/sf-file-drop.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { SampleFocal, SampleMediaFile, mediaFolderPath, mediaHashOf, mediaTypeOf, storagePathOf } from './sample-media-data';
import { SampleMediaState } from './sample-media-state';

/** The preview's largest height, rem (a portrait picture gets narrower). */
const PREVIEW_HEIGHT_REM = 20;
const ACCEPT: Readonly<Record<string, string>> = { JPG: 'image/*', PNG: 'image/*', SVG: '.svg', CSS: '.css', PDF: 'application/pdf' };

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * The Details tab (decision 21): a large preview — the picture fitted, a checkerboard behind transparent files, the
 * first page of a PDF, the text of a CSS file — with the focal point of an image set by clicking the preview (a
 * crosshair; arrow keys move it while the preview has focus, Shift for 10 %); alt text and caption; the file's facts;
 * a styled Replace; and in developer mode the focal point as numbers, the UID, the hash, the media type and the storage
 * path. Only photos have a focal point; every other file says so under its preview. Edits are kept by the drawer's Save.
 */
@Component({
  selector: 'sf-sample-media-details-tab',
  standalone: true,
  imports: [
    SfCodeEditorComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfFileDropComponent,
    SfFileSizePipe,
    SfInputComponent,
    SfNumberInputComponent,
    SfRelativeTimeComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-details-tab.component.html',
  styleUrl: './sample-media-details-tab.component.scss',
})
export class SampleMediaDetailsTabComponent {
  protected readonly state = inject(SampleMediaState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly now = Date.now();

  protected readonly file = computed(() => this.state.asset()!);
  protected readonly details = computed(() => this.state.details()!);
  protected readonly focal = computed(() => this.details().focal);
  /** Only photos get a focal point: PNG and SVG pictures, PDFs and text files are used as they are (decision 101). */
  protected readonly hasFocal = computed(() => this.file().format === 'JPG' && this.focal() !== null);
  protected readonly hasAlt = computed(() => this.file().kind === 'image' || this.file().format === 'SVG');
  protected readonly hasCaption = computed(() => this.file().format !== 'CSS');
  protected readonly checker = computed(() => this.file().format === 'SVG' || this.file().format === 'PNG');
  /** The text preview is highlighted like the Source tab: OCTL instructions plus the file's own format. */
  protected readonly highlight = computed(() => this.state.highlightOf(this.file()));
  protected readonly accept = computed(() => ACCEPT[this.file().format] ?? null);

  /** The preview frame keeps the picture's aspect, within the preview's height. */
  protected readonly frameWidth = computed(() => {
    const { width, height } = this.file();
    return width && height ? `min(100%, ${((PREVIEW_HEIGHT_REM * width) / height).toFixed(2)}rem)` : null;
  });
  protected readonly frameAspect = computed(() => {
    const { width, height } = this.file();
    return width && height ? `${width} / ${height}` : null;
  });

  protected readonly path = computed(() => {
    const folders = mediaFolderPath(this.file().folderId).map((f) => f.uid);
    return `/media/${[...folders, this.file().name].join('/')}`;
  });

  protected readonly hash = computed(() => mediaHashOf(this.file()));
  protected readonly mediaType = computed(() => mediaTypeOf(this.file()));
  protected readonly storagePath = computed(() => storagePathOf(this.file()));

  protected readonly focalLabel = computed(() => {
    const focal = this.focal();
    return focal ? this.state.t('details.focalLabel', { x: focal.x, y: focal.y }) : '';
  });

  constructor() {
    // "Replace" from the ⋮ menu: bring the Replace field into view and focus its button.
    effect(() => {
      if (this.state.replaceRequest()) {
        untracked(() => this.state.replaceRequest.set(false));
        setTimeout(() => {
          const field = this.host.querySelector<HTMLElement>('.replace');
          field?.scrollIntoView?.({ block: 'nearest' });
          field?.querySelector<HTMLElement>('button')?.focus();
        });
      }
    });
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected kindLabel(file: SampleMediaFile): string {
    return this.state.t(`details.kinds.${file.format}`);
  }

  /** A click on the preview puts the focal point there. */
  protected onPreviewClick(event: MouseEvent): void {
    if (!this.hasFocal()) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    this.setFocal({ x: clamp(((event.clientX - rect.left) / rect.width) * 100), y: clamp(((event.clientY - rect.top) / rect.height) * 100) });
  }

  /** Arrow keys move the focal point by 1 % (Shift: 10 %). */
  protected onPreviewKeydown(event: KeyboardEvent): void {
    const focal = this.focal();
    if (!focal || !this.hasFocal()) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, SampleFocal> = {
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
    event.stopPropagation();
    this.setFocal(next);
  }

  protected setFocalX(value: number | null): void {
    const focal = this.focal();
    if (focal && value !== null) {
      this.setFocal({ x: value, y: focal.y });
    }
  }

  protected setFocalY(value: number | null): void {
    const focal = this.focal();
    if (focal && value !== null) {
      this.setFocal({ x: focal.x, y: value });
    }
  }

  protected onReplace(files: File[]): void {
    if (files.length > 0) {
      this.state.notice('media.details.replaced', { name: files[0].name });
    }
  }

  private setFocal(focal: SampleFocal): void {
    this.state.edit({ focal: { x: clamp(focal.x), y: clamp(focal.y) } });
  }
}
