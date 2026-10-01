import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { HashMap, TranslocoPipe } from '@jsverse/transloco';
import { SfFileSizePipe } from '../../pipes/sf-file-size.pipe';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';
import { optionalNumber } from './optional-number';
import { SfControlBase, provideSfControl } from './sf-control';

interface RejectMessage {
  readonly key: string;
  readonly params: HashMap;
}

/**
 * A file picker with a drop zone (M35.6). Files come from dropping them on the zone or from the "Choose…" button,
 * which opens the hidden native `<input type=file>`; the button is the keyboard target (the zone is no tab stop).
 * `accept` (as on the native input: `.png`, `image/*`, `application/pdf`) and `maxSize` (bytes) are enforced for
 * dropped files as well: a rejected file is not added, and why is said in a polite live region. The value is the
 * chosen `File[]`; without `multiple` a new file replaces the old one.
 *
 * The control is a `role=group` named by its field label (or `aria-label`); the field's hint and error describe the
 * button.
 */
@Component({
  selector: 'sf-file-drop',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, SfFileSizePipe, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-file-drop.component.scss',
  providers: [provideSfControl(() => SfFileDropComponent)],
  template: `
    <div
      class="sf-file-drop"
      role="group"
      [id]="controlId()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="groupLabelledBy()"
      [attr.aria-invalid]="isInvalid() || null"
      (focusout)="markTouched()"
    >
      <div
        class="sf-file-drop__zone"
        [class.is-dragover]="dragging()"
        [class.is-invalid]="isInvalid()"
        [class.is-readonly]="readonly()"
        [class.is-disabled]="isDisabled()"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave()"
        (drop)="onDrop($event)"
      >
        <sf-icon class="sf-file-drop__icon" name="upload_file" />
        <span class="sf-file-drop__prompt">
          @if (dragging()) {
            {{ 'shared.fileDrop.dropping' | transloco }}
          } @else {
            {{ (multiple() ? 'shared.fileDrop.promptMultiple' : 'shared.fileDrop.prompt') | transloco }}
          }
        </span>
        <sf-button
          #choose
          variant="secondary"
          size="sm"
          [disabled]="!editable()"
          [aria-describedby]="describedBy()"
          (click)="openPicker()"
          >{{ (multiple() ? 'shared.fileDrop.chooseMultiple' : 'shared.fileDrop.choose') | transloco }}</sf-button
        >
        <input
          #picker
          class="sf-file-drop__picker"
          type="file"
          hidden
          [attr.accept]="accept()"
          [multiple]="multiple()"
          [disabled]="!editable()"
          (change)="onPicked($event)"
        />
      </div>

      @if (value().length) {
        <ul class="sf-file-drop__files">
          @for (file of value(); track file) {
            <li class="sf-file-drop__file">
              <sf-icon class="sf-file-drop__file-icon" name="draft" />
              <span class="sf-file-drop__file-name">{{ file.name }}</span>
              <span class="sf-file-drop__file-size">{{ file.size | sfFileSize }}</span>
              @if (!readonly()) {
                <sf-button
                  class="sf-file-drop__remove"
                  variant="ghost"
                  size="sm"
                  icon="close"
                  [disabled]="isDisabled()"
                  [label]="'shared.fileDrop.remove' | transloco: { name: file.name }"
                  (click)="remove($index)"
                />
              }
            </li>
          }
        </ul>
      }

      <div class="sf-file-drop__messages" aria-live="polite">
        @for (message of messages(); track $index) {
          <p class="sf-file-drop__message">
            <sf-icon class="sf-file-drop__message-icon" name="error" />
            <span>{{ message.key | transloco: message.params }}</span>
          </p>
        }
      </div>
    </div>
  `,
})
export class SfFileDropComponent extends SfControlBase<File[]> {
  readonly value = model<File[]>([]);
  /** Accepted types, as the native `accept`: extensions (`.svg`) and MIME types (`image/*`), comma-separated. */
  readonly accept = input<string | null>(null);
  readonly multiple = input(false, { transform: booleanAttribute });
  /** The largest accepted file, in bytes. */
  readonly maxSize = input(null, { transform: optionalNumber });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private readonly chooseButton = viewChild.required<SfButtonComponent>('choose');
  private readonly fileSize = new SfFileSizePipe();

  /** Why files of the last drop or pick were not added. */
  protected readonly messages = signal<readonly RejectMessage[]>([]);
  protected readonly dragging = signal(false);
  protected readonly editable = computed(() => !this.isDisabled() && !this.readonly());
  /** dragenter/dragleave also fire for the zone's children: count them to know when the pointer really left. */
  private dragDepth = 0;

  constructor() {
    super('group');
  }

  focus(): void {
    this.chooseButton().focus();
  }

  protected writeModel(value: File[] | null | undefined): void {
    this.value.set(Array.isArray(value) ? [...value] : []);
  }

  protected openPicker(): void {
    this.picker().nativeElement.click();
  }

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(Array.from(input.files ?? []));
    // Picking the same file again must fire `change` again.
    input.value = '';
  }

  protected onDragEnter(event: DragEvent): void {
    if (!this.editable()) {
      return;
    }
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.editable()) {
      return;
    }
    // Allows the drop.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.dragging.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    this.dragDepth = 0;
    this.dragging.set(false);
    if (!this.editable()) {
      return;
    }
    event.preventDefault();
    this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  protected remove(index: number): void {
    const next = this.value().filter((_, i) => i !== index);
    this.update(next);
    // The removed file's button is gone: move focus to the next file's, else to "Choose".
    this.changeDetector.detectChanges();
    const removeButtons = this.host.nativeElement.querySelectorAll<HTMLElement>('.sf-file-drop__remove button');
    const target = removeButtons[Math.min(index, removeButtons.length - 1)];
    if (target) {
      target.focus();
    } else {
      this.focus();
    }
  }

  private add(files: File[]): void {
    const accepted: File[] = [];
    const messages: RejectMessage[] = [];
    const maxSize = this.maxSize();
    for (const file of files) {
      if (!accepts(file, this.accept())) {
        messages.push({ key: 'shared.fileDrop.rejectedType', params: { name: file.name } });
      } else if (maxSize !== null && file.size > maxSize) {
        messages.push({ key: 'shared.fileDrop.tooLarge', params: { name: file.name, max: this.fileSize.transform(maxSize) } });
      } else {
        accepted.push(file);
      }
    }
    this.messages.set(messages);
    if (!accepted.length) {
      return;
    }
    if (!this.multiple()) {
      this.update([accepted[0]]);
      return;
    }
    const current = this.value();
    const fresh = accepted.filter((file) => !current.some((known) => sameFile(known, file)));
    if (fresh.length) {
      this.update([...current, ...fresh]);
    }
  }

  private update(value: File[]): void {
    this.value.set(value);
    this.emitChange(value);
  }
}

/** Whether `file` matches a native `accept` list (extensions, `type/*`, exact MIME types). */
export function accepts(file: File, accept: string | null): boolean {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) {
    return true;
  }
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) {
      return name.endsWith(rule);
    }
    if (rule.endsWith('/*')) {
      return type.startsWith(rule.slice(0, -1));
    }
    return type === rule;
  });
}

function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}
