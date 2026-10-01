import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { anchorPanel } from '../../overlay/anchored-position';
import { SfButtonComponent, SfButtonSize, SfButtonVariant } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';
import { sfUniqueId } from '../forms/sf-field-context';

export interface SfMenuItem {
  id: string;
  label: string;
  icon?: string;
  /** Shown but not choosable (`aria-disabled`); stays reachable with the arrow keys. */
  disabled?: boolean;
  /** Destructive action: danger colour. */
  danger?: boolean;
  /** A separator above this item. */
  separatorBefore?: boolean;
  /** A router link: the item is an `<a>`. */
  link?: string | unknown[];
}

const TYPEAHEAD_RESET_MS = 500;

/**
 * A menu button (M35.6, minimal; M35.7 adds context menus, submenus and shortcut hints): a trigger with
 * `aria-haspopup=menu` that opens a `role=menu` of items.
 *
 * Keyboard (WAI-ARIA menu button): `Enter`/`Space`/`↓` open on the first item, `↑` on the last; `↑`/`↓` move (wrapping),
 * `Home`/`End`, type-ahead on the labels; `Enter`/`Space` choose; `Escape` closes and returns focus to the trigger;
 * `Tab` closes (focus returns to the trigger, then moves on). A click outside closes. The open panel lives in `<body>`
 * (see {@link anchorPanel}), so no dialog transform or overflow can offset or clip it.
 */
@Component({
  selector: 'sf-menu',
  standalone: true,
  imports: [RouterLink, SfButtonComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-menu.component.html',
  styleUrl: './sf-menu.component.scss',
})
export class SfMenuComponent implements OnDestroy {
  readonly items = input.required<readonly SfMenuItem[]>();
  /** The menu's accessible name; also the trigger's name and tooltip when it has no `text`. */
  readonly label = input.required<string>();
  /** Visible trigger text; without it the trigger is icon-only. */
  readonly text = input<string | null>(null);
  readonly icon = input<string>('more_vert');
  readonly variant = input<SfButtonVariant>('ghost');
  readonly size = input<SfButtonSize>('md');
  readonly disabled = input(false);
  readonly align = input<'start' | 'end'>('end');

  readonly itemSelected = output<SfMenuItem>();

  protected readonly open = signal(false);
  protected readonly menuId = sfUniqueId('sf-menu');

  private readonly trigger = viewChild.required(SfButtonComponent);
  private readonly triggerHost = viewChild.required('trigger', { read: ElementRef });
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  private stopAnchor: (() => void) | null = null;
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    const inside =
      target && (this.panel()?.nativeElement.contains(target) || this.triggerHost().nativeElement.contains(target));
    if (!inside) {
      this.close(false);
    }
  };

  /** Whether the menu is open (for hosts and tests). */
  isOpen(): boolean {
    return this.open();
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
    } else {
      this.openMenu('first');
    }
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  }

  openMenu(focus: 'first' | 'last'): void {
    if (this.disabled() || this.items().length === 0) {
      return;
    }
    if (this.open()) {
      this.focusItem(focus === 'first' ? 0 : this.itemElements().length - 1);
      return;
    }
    this.open.set(true);
    // Render the panel now, so it can be placed and focused in this same task.
    this.changeDetector.detectChanges();
    const panel = this.panel()?.nativeElement;
    if (panel) {
      this.stopAnchor = anchorPanel(this.triggerHost().nativeElement, panel, { align: this.align() });
      this.focusItem(focus === 'first' ? 0 : this.itemElements().length - 1);
    }
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  close(restoreFocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    this.stopAnchor?.();
    this.stopAnchor = null;
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    if (restoreFocus) {
      this.trigger().focus();
    }
  }

  protected choose(item: SfMenuItem, event: Event): void {
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    this.close(true);
    this.itemSelected.emit(item);
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.itemElements();
    const index = items.indexOf(this.document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem((index + 1) % items.length);
        break;
      case 'ArrowUp':
        this.focusItem((index - 1 + items.length) % items.length);
        break;
      case 'Home':
        this.focusItem(0);
        break;
      case 'End':
        this.focusItem(items.length - 1);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        // The panel lives in <body>: put focus back on the trigger, then let Tab move on from there.
        this.close(true);
        return;
      case ' ':
        // Buttons activate on Space natively; a link item doesn't (the page would scroll instead).
        if (items[index]?.tagName === 'A') {
          items[index].click();
          break;
        }
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.typeAhead(event.key, index);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  ngOnDestroy(): void {
    this.close(false);
    if (this.typeaheadTimer) {
      clearTimeout(this.typeaheadTimer);
    }
  }

  private typeAhead(char: string, from: number): void {
    this.typeahead += char.toLowerCase();
    if (this.typeaheadTimer) {
      clearTimeout(this.typeaheadTimer);
    }
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), TYPEAHEAD_RESET_MS);
    const labels = this.items().map((item) => item.label.toLowerCase());
    // A repeated single letter cycles through the items starting with it; longer input matches from the current item.
    const repeated = this.typeahead.length > 1 && [...this.typeahead].every((c) => c === this.typeahead[0]);
    const prefix = repeated ? this.typeahead[0] : this.typeahead;
    const start = this.typeahead.length === 1 || repeated ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < labels.length; step++) {
      const candidate = (start + step) % labels.length;
      if (labels[candidate].startsWith(prefix)) {
        this.focusItem(candidate);
        return;
      }
    }
  }

  private itemElements(): HTMLElement[] {
    return Array.from(this.panel()?.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  private focusItem(index: number): void {
    this.itemElements()[index]?.focus();
  }
}
