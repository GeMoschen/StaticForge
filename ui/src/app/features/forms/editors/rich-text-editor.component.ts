import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import type { SfFinding } from '../../../shared/components/forms/sf-finding.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { SfEditorBase, isEmptyValue } from '../editor-base';
import { errorMessageFor } from '../form-builder.service';
import { SF_FORM_CONTEXT } from '../form.context';
import { SfRichTextLinkDialogComponent, type RichTextLink } from './rich-text-link-dialog.component';
import { RichTextCommand, RichTextCommandDef, RICH_TEXT_COMMANDS, enabledCommands, escapeHtml, textLength } from './rich-text.util';

/**
 * The rich-text editor (M35.17): a `role="toolbar"` of icon buttons (`aria-pressed` follows the caret's format, tooltips
 * name each button and its shortcut) above the editable text, in one `sf-field` with the language chip and the findings.
 *
 * - **Keyboard:** the toolbar is one tab stop (arrows, Home and End move along it); **Alt+F10** moves the focus to it and
 *   Escape returns to the text; Ctrl+B, Ctrl+I and Ctrl+K format — all through the shortcut registry, so the `?` sheet lists
 *   them and they only act while this editor holds the focus.
 * - **Link:** a dialog (address, a page through the picker, "Open in a new tab") replaces `window.prompt`; with the caret in
 *   a link it edits that link and can remove it.
 * - **Read-only** (the definition, or a rule disabling the control): the text is readable, the toolbar is disabled.
 *
 * The value stays `{ format, value: <html> }`; links are plain `<a href>`.
 */
@Component({
  selector: 'sf-rich-text-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldComponent, SfIconComponent, SfRichTextLinkDialogComponent, SfTooltipDirective, TranslocoPipe],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss',
})
export class SfRichTextEditor extends SfEditorBase<FormGroup> {
  private readonly bodyRef = viewChild.required<ElementRef<HTMLDivElement>>('body');
  protected readonly field = viewChild(SfFieldComponent);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formContext = inject(SF_FORM_CONTEXT, { optional: true });
  protected readonly projectKey = computed(() => this.formContext?.projectKey());

  readonly valueControl = computed(() => this.control().get('value') as FormControl);

  protected readonly commands = computed<readonly RichTextCommandDef[]>(() => enabledCommands(this.definition().features));
  /** The commands pressed at the caret (bold, a heading …). */
  protected readonly pressed = signal<ReadonlySet<RichTextCommand>>(new Set());
  /** The toolbar's one tab stop (roving tabindex). */
  protected readonly tab = signal(0);

  protected readonly readonly = computed(() => {
    this.changes();
    return !!this.definition().readOnly || this.valueControl().disabled;
  });

  readonly count = computed(() => {
    this.changes();
    return textLength(String(this.valueControl().value ?? ''));
  });

  /** The control's own message (length, pattern …) as a finding; the value control carries the validators. */
  private readonly ownRichFinding = computed<SfFinding | null>(() => {
    this.changes();
    const errors = this.valueControl().errors;
    if (!errors || errors['required']) {
      return null;
    }
    const message = errorMessageFor(this.definition(), this.valueControl(), (key, params) => this.transloco.translate(key, params));
    return message ? { level: 'error', message } : null;
  });
  readonly findings = computed<readonly SfFinding[]>(() => {
    const own = this.ownRichFinding();
    return own ? [...(this.chrome()?.findings ?? []), own] : (this.chrome()?.findings ?? []);
  });

  // ── The link dialog ────────────────────────────────────────────────────────
  protected readonly linkOpen = signal(false);
  protected readonly linkAddress = signal('');
  protected readonly linkNewTab = signal(false);
  protected readonly linkEditing = signal(false);
  private saved: Range | null = null;

  constructor() {
    super();
    effect(() => {
      const element = this.bodyRef().nativeElement;
      this.changes();
      const value = String(this.valueControl().value ?? '');
      if (document.activeElement !== element && element.innerHTML !== value) {
        element.innerHTML = value;
      }
    });
    this.registerShortcuts();
  }

  /** "Empty" is the text being blank, not the group having a value. */
  protected override isEmpty(value: unknown): boolean {
    const html = value && typeof value === 'object' ? (value as { value?: unknown }).value : value;
    return isEmptyValue(typeof html === 'string' ? html.replace(/<[^>]*>/g, '') : html);
  }

  protected tooltip(def: RichTextCommandDef): string {
    const name = this.transloco.translate(`forms.rich.${def.id}`);
    return def.shortcut ? `${name} (${def.shortcut})` : name;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  run(id: RichTextCommand): void {
    if (this.readonly()) {
      return;
    }
    const element = this.bodyRef().nativeElement;
    // Read the caret's block before the focus moves: a block command toggles off where it is already on.
    const block = id === 'h2' || id === 'h3' || id === 'quote' ? (id === 'quote' ? 'blockquote' : id) : null;
    const inBlock = block !== null && this.inBlock(block);
    element.focus();
    switch (id) {
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'h2':
      case 'h3':
      case 'quote':
        document.execCommand('formatBlock', false, inBlock ? 'p' : block!);
        break;
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
    this.sync();
  }

  protected onInput(): void {
    this.sync();
  }

  private sync(): void {
    this.valueControl().setValue(this.bodyRef().nativeElement.innerHTML);
    this.valueControl().markAsDirty();
    this.syncState();
  }

  /** Reflects the caret's format in the buttons' `aria-pressed`. */
  protected syncState(): void {
    const next = new Set<RichTextCommand>();
    for (const def of RICH_TEXT_COMMANDS) {
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
    const body = this.bodyRef().nativeElement;
    for (let node: Node | null = window.getSelection()?.anchorNode ?? null; node && node !== body; node = node.parentNode) {
      if (node.nodeName.toLowerCase() === tag) {
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

  // ── Keyboard (through the shortcut registry) ───────────────────────────────

  private registerShortcuts(): void {
    const inBody = () => {
      const active = document.activeElement;
      return !!active && this.bodyRef().nativeElement.contains(active);
    };
    const inEditor = () => !!document.activeElement && this.host.nativeElement.contains(document.activeElement);
    const format = (id: RichTextCommand) => () => {
      if (!inBody() || this.readonly() || !this.commands().some((def) => def.id === id)) {
        return false;
      }
      this.run(id);
      return true;
    };
    const def = (id: string, keys: string, handler: () => boolean) => ({
      id,
      keys,
      scope: 'component' as const,
      group: 'editing' as const,
      description: `frame.shortcuts.items.${id}`,
      allowInInput: true,
      handler,
    });
    inject(ShortcutService).use([
      def('richToolbar', 'Alt+F10', () => {
        if (!inEditor()) {
          return false;
        }
        this.focusToolbar();
        return true;
      }),
      def('richBold', 'Mod+B', format('bold')),
      def('richItalic', 'Mod+I', format('italic')),
      def('richLink', 'Mod+K', format('link')),
    ]);
  }

  /** Alt+F10: the toolbar's tab stop gets the focus. */
  focusToolbar(): void {
    this.toolbarButtons()[this.tab()]?.focus();
  }

  private toolbarButtons(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.sf-richtext__toolbar button'));
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
    this.toolbarButtons()[next]?.focus();
  }

  /** The tab stop follows a button that took the focus by mouse or Alt+F10. */
  protected onToolbarFocus(index: number): void {
    this.tab.set(index);
  }

  // ── Link ───────────────────────────────────────────────────────────────────

  private openLink(): void {
    this.rememberSelection();
    const anchor = this.anchorAtCaret();
    this.linkAddress.set(anchor?.getAttribute('href') ?? '');
    this.linkNewTab.set(anchor?.getAttribute('target') === '_blank');
    this.linkEditing.set(!!anchor);
    this.linkOpen.set(true);
  }

  private anchorAtCaret(): HTMLAnchorElement | null {
    const node = this.saved?.commonAncestorContainer ?? null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    const anchor = element?.closest('a') ?? null;
    return anchor && this.bodyRef().nativeElement.contains(anchor) ? anchor : null;
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.bodyRef().nativeElement.focus();
  }

  private restoreSelection(): void {
    this.bodyRef().nativeElement.focus();
    const selection = window.getSelection();
    if (this.saved && selection) {
      selection.removeAllRanges();
      selection.addRange(this.saved);
    }
  }

  protected applyLink(link: RichTextLink): void {
    this.linkOpen.set(false);
    this.restoreSelection();
    const existing = this.anchorAtCaret();
    const selection = window.getSelection();
    if (existing) {
      existing.setAttribute('href', link.href);
    } else if (selection?.isCollapsed) {
      // Nothing selected: the address itself becomes the link text.
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(link.href)}">${escapeHtml(link.href)}</a>`);
    } else {
      document.execCommand('createLink', false, link.href);
    }
    const anchor = existing ?? (window.getSelection()?.anchorNode?.parentElement?.closest('a') ?? null);
    if (anchor) {
      if (link.newTab) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    }
    this.sync();
  }

  protected removeLink(): void {
    this.linkOpen.set(false);
    this.restoreSelection();
    const anchor = this.anchorAtCaret();
    if (anchor) {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    document.execCommand('unlink');
    this.sync();
  }
}
