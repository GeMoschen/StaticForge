import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AnchorOptions } from '../../overlay/anchored-position';
import { SfButtonComponent, SfButtonSize, SfButtonVariant } from '../sf-button.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfMenuItem } from './sf-menu-item';
import { SfMenuCloseReason, SfMenuPanelComponent } from './sf-menu-panel.component';

export type { SfMenuItem } from './sf-menu-item';

/**
 * A menu button (M35.6; M35.7 moved the panel into {@link SfMenuPanelComponent}, shared with the context menu, and added
 * submenus, groups, shortcut hints and disabled reasons): a trigger with `aria-haspopup=menu` that opens a `role=menu`
 * of items.
 *
 * Keyboard (WAI-ARIA menu button): `Enter`/`Space`/`↓` open on the first item, `↑` on the last; inside the menu see
 * {@link SfMenuPanelComponent}. `Escape` closes and returns focus to the trigger; `Tab` closes (focus returns to the
 * trigger, then moves on). A click outside closes. The open panel lives in `<body>`, so no dialog transform or overflow
 * can offset or clip it.
 */
@Component({
  selector: 'sf-menu',
  standalone: true,
  imports: [SfButtonComponent, SfMenuPanelComponent],
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

  /** A leaf item was chosen (from the menu or a submenu); its `action` runs too. */
  readonly itemSelected = output<SfMenuItem>();

  protected readonly open = signal(false);
  protected readonly initialFocus = signal<'first' | 'last'>('first');
  protected readonly menuId = sfUniqueId('sf-menu');
  protected readonly anchorOptions = computed<AnchorOptions>(() => ({ align: this.align() }));

  private readonly trigger = viewChild.required(SfButtonComponent);
  private readonly triggerHost = viewChild.required('trigger', { read: ElementRef });
  private readonly panel = viewChild(SfMenuPanelComponent);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);

  private readonly onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    const inside = this.panel()?.containsNode(target) || (target && this.triggerHost().nativeElement.contains(target));
    if (!inside) {
      this.close(false);
    }
  };

  /** The trigger's element: what the panel is anchored to. */
  protected triggerElement(): HTMLElement {
    return this.triggerHost().nativeElement;
  }

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
      this.panel()?.focusItem(focus);
      return;
    }
    this.initialFocus.set(focus);
    this.open.set(true);
    // Render the panel now: it places itself and focuses its item in this same task.
    this.changeDetector.detectChanges();
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  close(restoreFocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    // Remove the panel (and its submenus) from <body> now.
    this.changeDetector.detectChanges();
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    if (restoreFocus) {
      this.trigger().focus();
    }
  }

  protected onActivated(item: SfMenuItem): void {
    this.close(true);
    this.itemSelected.emit(item);
    item.action?.();
  }

  protected onCloseRequest(reason: SfMenuCloseReason): void {
    if (reason !== 'back') {
      this.close(true);
    }
  }

  ngOnDestroy(): void {
    // The panel is destroyed with this view (and leaves <body> then); only the listener needs removing.
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
  }
}
