import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { PickerItem } from './picker-data';
import { isValidLinkTarget } from './forms-util';
import { SampleAssetPickerComponent } from './sample-asset-picker.component';

/** The toolbar commands; a field switches each of them on or off. */
export type RichTextCommand = 'bold' | 'italic' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'link' | 'clear';
export const RICH_TEXT_COMMANDS: readonly RichTextCommand[] = ['bold', 'italic', 'h2', 'h3', 'ul', 'ol', 'quote', 'link', 'clear'];

interface CommandDef {
  readonly id: RichTextCommand;
  readonly icon: string;
  readonly shortcut?: string;
  /** `queryCommandState` name for the pressed state. */
  readonly state?: string;
  /** The block tag the caret must be in for the pressed state. */
  readonly block?: string;
}

const DEFS: readonly CommandDef[] = [
  { id: 'bold', icon: 'format_bold', shortcut: 'Ctrl+B', state: 'bold' },
  { id: 'italic', icon: 'format_italic', shortcut: 'Ctrl+I', state: 'italic' },
  { id: 'h2', icon: 'format_h2', block: 'h2' },
  { id: 'h3', icon: 'format_h3', block: 'h3' },
  { id: 'ul', icon: 'format_list_bulleted', state: 'insertUnorderedList' },
  { id: 'ol', icon: 'format_list_numbered', state: 'insertOrderedList' },
  { id: 'quote', icon: 'format_quote', block: 'blockquote' },
  { id: 'link', icon: 'link', shortcut: 'Ctrl+K', block: 'a' },
  { id: 'clear', icon: 'format_clear' },
];

/**
 * The rich-text editor (M35.17 sample): a `role="toolbar"` of icon buttons (`aria-pressed` reflects the caret's format,
 * tooltips name each button and its shortcut) above an editable area. **Alt+F10** moves the focus to the toolbar; arrow
 * keys, Home and End move within it (one tab stop) and Escape returns to the text. Ctrl+B / Ctrl+I / Ctrl+K format.
 * *Link* opens a dialog (address, an internal page through the picker, "Open in a new tab") instead of `window.prompt`;
 * Apply stays disabled until the address is valid. Read-only: no toolbar actions, text not editable.
 */
@Component({
  selector: 'sf-sample-rich-text',
  standalone: true,
  imports: [
    SampleAssetPickerComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-rich-text.component.scss',
  host: { '(keydown)': 'onHostKeydown($event)' },
  template: `
    <div class="rt" [class.is-readonly]="readonly()" [class.is-invalid]="invalid()">
      <div
        class="rt__toolbar"
        role="toolbar"
        [attr.aria-label]="'styleguide.sample.forms.rich.toolbar' | transloco"
        [attr.aria-controls]="id + '-body'"
        (keydown)="onToolbarKeydown($event)"
      >
        @for (cmd of commands(); track cmd.id; let i = $index) {
          <button
            type="button"
            class="rt__button"
            [attr.aria-label]="'styleguide.sample.forms.rich.' + cmd.id | transloco"
            [sfTooltip]="tooltip(cmd)"
            [sfTooltipDescribes]="false"
            [attr.aria-pressed]="pressed().has(cmd.id)"
            [disabled]="readonly()"
            [attr.data-tool]="cmd.id"
            [attr.tabindex]="i === tab() ? 0 : -1"
            (mousedown)="$event.preventDefault()"
            (click)="run(cmd.id)"
          >
            <sf-icon [name]="cmd.icon" />
          </button>
        }
      </div>
      <div
        #body
        class="rt__body"
        role="textbox"
        aria-multiline="true"
        [id]="id + '-body'"
        [attr.aria-label]="label()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-readonly]="readonly() ? 'true' : null"
        [attr.contenteditable]="readonly() ? 'false' : 'true'"
        (input)="onInput()"
        (keyup)="syncState()"
        (mouseup)="syncState()"
        (focus)="syncState()"
        (blur)="rememberSelection()"
      ></div>
    </div>

    @if (linkOpen()) {
      <sf-dialog size="sm" [title]="'styleguide.sample.forms.rich.linkTitle' | transloco" (closed)="closeLink()">
        <div class="link">
          <sf-field [label]="'styleguide.sample.forms.rich.address' | transloco" [error]="addressError() ? ('styleguide.sample.forms.rich.addressInvalid' | transloco) : null">
            <!-- i18n-ignore -->
            <sf-input icon="link" placeholder="https://" [value]="address()" (valueChange)="address.set($event)" />
          </sf-field>
          <div class="link__pick">
            <sf-button variant="secondary" size="sm" icon="description" (click)="pickPage.set(true)">{{
              'styleguide.sample.forms.rich.pickPage' | transloco
            }}</sf-button>
            @if (pickedName(); as name) {
              <span class="link__picked">{{ 'styleguide.sample.forms.rich.picked' | transloco: { name } }}</span>
            }
          </div>
          <sf-checkbox [value]="newTab()" (valueChange)="newTab.set($event)">{{ 'styleguide.sample.forms.rich.newTab' | transloco }}</sf-checkbox>
        </div>
        <ng-container sfDialogFooter>
          <sf-button variant="ghost" (click)="closeLink()">{{ 'styleguide.sample.forms.rich.cancel' | transloco }}</sf-button>
          <sf-button variant="primary" [disabled]="!addressValid()" (click)="applyLink()">{{ 'styleguide.sample.forms.rich.apply' | transloco }}</sf-button>
        </ng-container>
      </sf-dialog>
    }
    @if (pickPage()) {
      <sf-sample-asset-picker [allowedTypes]="['PAGE']" (choose)="onPicked($event)" (cancelled)="pickPage.set(false)" />
    }
  `,
})
export class SampleRichTextComponent {
  /** The content as HTML. */
  readonly value = model('');
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly label = input<string | null>(null);
  /** The commands the field offers (its definition's `features`). */
  readonly features = input<readonly RichTextCommand[]>(RICH_TEXT_COMMANDS);

  protected readonly id = `sample-rt-${Math.random().toString(36).slice(2, 8)}`;
  private readonly bodyRef = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly commands = computed(() => DEFS.filter((def) => this.features().includes(def.id)));
  protected readonly pressed = signal<ReadonlySet<RichTextCommand>>(new Set());
  /** The toolbar's one tab stop (roving tabindex). */
  protected readonly tab = signal(0);

  protected readonly linkOpen = signal(false);
  protected readonly pickPage = signal(false);
  protected readonly address = signal('');
  protected readonly newTab = signal(false);
  protected readonly pickedName = signal<string | null>(null);
  private saved: Range | null = null;

  protected readonly addressValid = computed(() => isValidLinkTarget(this.address()));
  protected readonly addressError = computed(() => this.address().trim() !== '' && !this.addressValid());

  constructor() {
    afterNextRender(() => {
      this.bodyRef().nativeElement.innerHTML = this.value();
    });
  }

  protected tooltip(cmd: CommandDef): string {
    return cmd.shortcut ? `${cmd.id} (${cmd.shortcut})` : cmd.id;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  protected run(id: RichTextCommand): void {
    if (this.readonly()) {
      return;
    }
    this.bodyRef().nativeElement.focus();
    switch (id) {
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'h2':
      case 'h3':
      case 'quote': {
        const tag = id === 'quote' ? 'blockquote' : id;
        document.execCommand('formatBlock', false, this.inBlock(tag) ? 'p' : tag);
        break;
      }
      case 'ul':
        document.execCommand('insertUnorderedList');
        break;
      case 'ol':
        document.execCommand('insertOrderedList');
        break;
      case 'clear':
        document.execCommand('removeFormat');
        document.execCommand('formatBlock', false, 'p');
        break;
      case 'link':
        this.openLink();
        return;
    }
    this.onInput();
  }

  protected onInput(): void {
    this.value.set(this.bodyRef().nativeElement.innerHTML);
    this.syncState();
  }

  /** Reflects the caret's format in the buttons' `aria-pressed`. */
  protected syncState(): void {
    const next = new Set<RichTextCommand>();
    for (const def of DEFS) {
      const on = def.state ? this.safeState(def.state) : def.block ? this.inBlock(def.block) : false;
      if (on) {
        next.add(def.id);
      }
    }
    this.pressed.set(next);
  }

  private safeState(command: string): boolean {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  }

  private inBlock(tag: string): boolean {
    const node = window.getSelection()?.anchorNode ?? null;
    const body = this.bodyRef().nativeElement;
    for (let el: Node | null = node; el && el !== body; el = el.parentNode) {
      if (el.nodeName.toLowerCase() === tag) {
        return true;
      }
    }
    return false;
  }

  protected rememberSelection(): void {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && this.bodyRef().nativeElement.contains(selection.anchorNode)) {
      this.saved = selection.getRangeAt(0).cloneRange();
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  protected onHostKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === 'F10') {
      event.preventDefault();
      this.focusToolbar();
      return;
    }
    if (this.readonly() || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const command: RichTextCommand | null = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : null;
    if (command && this.features().includes(command) && this.bodyRef().nativeElement.contains(event.target as Node)) {
      event.preventDefault();
      this.run(command);
    }
  }

  /** Alt+F10: the toolbar's tab stop gets the focus. */
  focusToolbar(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.rt__toolbar button[tabindex="0"]')?.focus();
  }

  protected onToolbarKeydown(event: KeyboardEvent): void {
    const count = this.commands().length;
    let next = this.tab();
    switch (event.key) {
      case 'ArrowRight':
        next = (next + 1) % count;
        break;
      case 'ArrowLeft':
        next = (next - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.bodyRef().nativeElement.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    this.tab.set(next);
    // The focus goes straight to the button: its tabindex only follows on the next render.
    this.host.nativeElement.querySelectorAll<HTMLElement>('.rt__toolbar button')[next]?.focus();
  }

  // ── Link dialog ────────────────────────────────────────────────────────────

  private openLink(): void {
    this.rememberSelection();
    const anchor = this.saved?.commonAncestorContainer.parentElement?.closest('a') ?? null;
    this.address.set(anchor?.getAttribute('href') ?? '');
    this.newTab.set(anchor?.getAttribute('target') === '_blank');
    this.pickedName.set(null);
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.bodyRef().nativeElement.focus();
  }

  protected onPicked(item: PickerItem): void {
    this.address.set(item.path);
    this.pickedName.set(item.name);
    this.pickPage.set(false);
  }

  protected applyLink(): void {
    if (!this.addressValid()) {
      return;
    }
    const body = this.bodyRef().nativeElement;
    this.linkOpen.set(false);
    body.focus();
    const selection = window.getSelection();
    if (this.saved && selection) {
      selection.removeAllRanges();
      selection.addRange(this.saved);
    }
    document.execCommand('createLink', false, this.address().trim());
    const anchor = window.getSelection()?.anchorNode?.parentElement?.closest('a');
    if (anchor) {
      if (this.newTab()) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    }
    this.onInput();
  }
}
