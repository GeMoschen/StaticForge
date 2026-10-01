import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AnchorOptions, AnchorRef, pointAnchor } from '../overlay/anchored-position';
import { ContextMenuService, ContextMenuState } from '../services/context-menu.service';
import { SfMenuItem } from './menu/sf-menu-item';
import { SfMenuCloseReason, SfMenuPanelComponent } from './menu/sf-menu-panel.component';

/** At the pointer: the panel's corner sits on it. */
const POINT_OPTIONS: AnchorOptions = { side: 'bottom', align: 'start', offset: 0 };
/** Opened from the keyboard: below the focused element. */
const ELEMENT_OPTIONS: AnchorOptions = { side: 'bottom', align: 'start' };

/**
 * The single floating context menu (M35.7), mounted once in `app.component.html`; it renders whatever
 * `ContextMenuService.state` holds on the shared {@link SfMenuPanelComponent}.
 *
 * Focus goes to the first item on open and back to the element that had it on close. `Escape` and `Tab` close it
 * (focus restored), as do a click outside, the window losing focus and a resize. Choosing an item closes the menu,
 * then runs its `action`.
 */
@Component({
  selector: 'sf-context-menu',
  standalone: true,
  imports: [SfMenuPanelComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-context-menu.component.html',
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(window:blur)': 'dismiss()',
    '(window:resize)': 'dismiss()',
  },
})
export class SfContextMenuComponent {
  protected readonly menu = inject(ContextMenuService);

  /**
   * The open menu, as a list of zero or one: rendered with `@for` tracked by the state object, so a menu opened while
   * another is open gets a new panel (placed and focused afresh) instead of new inputs on the old one.
   */
  protected readonly open = computed(() => {
    const state = this.menu.state();
    return state ? [{ state, ...placementOf(state) }] : [];
  });

  private readonly panel = viewChild(SfMenuPanelComponent);

  protected onDocumentPointerDown(event: Event): void {
    if (this.menu.state() && !this.panel()?.containsNode(event.target as Node | null)) {
      this.menu.close();
    }
  }

  protected dismiss(): void {
    if (this.menu.state()) {
      this.menu.close();
    }
  }

  protected onActivated(item: SfMenuItem): void {
    this.closeAndRestoreFocus();
    item.action?.();
  }

  protected onCloseRequest(reason: SfMenuCloseReason): void {
    if (reason !== 'back') {
      this.closeAndRestoreFocus();
    }
  }

  private closeAndRestoreFocus(): void {
    const opener = this.menu.state()?.opener;
    this.menu.close();
    if (opener?.isConnected) {
      opener.focus();
    }
  }
}

function placementOf(state: ContextMenuState): { anchor: AnchorRef; options: AnchorOptions } {
  return state.anchor.kind === 'point'
    ? { anchor: pointAnchor(state.anchor.x, state.anchor.y), options: POINT_OPTIONS }
    : { anchor: state.anchor.element, options: ELEMENT_OPTIONS };
}
