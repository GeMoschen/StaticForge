import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastKind, ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfDialogComponent, SfDialogFooterDirective, SfDialogSize } from '../../../shared/components/dialog/sf-dialog.component';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../shared/components/dialog/sf-drawer.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../../../shared/components/popover/sf-popover.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { ContextMenuItem, ContextMenuService } from '../../../shared/services/context-menu.service';
import { CONFIRMS, CONTEXT_ITEMS, DIALOG_SIZES, MENU_ITEMS, OVERLAYS, TOASTS, UNDO_TOAST, UNDO_VARIANTS } from '../styleguide.demo';
import { UnsavedChangesService } from '../../../shared/components/dialog/unsaved-changes.service';
import { sectionOf } from '../styleguide.sections';

/**
 * The overlays section of the style guide (M35.9): dialogs in every size, the three confirmations, modal and
 * non-modal drawers, popovers, a menu with a submenu, groups, shortcuts and disabled reasons, a context-menu target,
 * tooltips and toasts. Nothing is saved; choices are echoed as toasts.
 */
@Component({
  selector: 'sf-sg-overlays',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfMenuComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-overlays.component.html',
  styleUrl: './sg-overlays.component.scss',
})
export class SgOverlaysComponent {
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly s = sectionOf('overlays');
  protected readonly o = OVERLAYS;
  protected readonly sizes = DIALOG_SIZES;
  protected readonly menuItems = MENU_ITEMS;
  protected readonly toastKinds = TOASTS;
  protected readonly confirmKinds = ['default', 'danger', 'bulk', 'typed'] as const;
  protected readonly undoVariants = UNDO_VARIANTS;

  protected readonly dialogSize = signal<SfDialogSize | null>(null);
  protected readonly drawer = signal<'modal' | 'plain' | null>(null);
  protected readonly dialogValue = signal<string>(OVERLAYS.dialog.value);

  protected async confirm(kind: keyof typeof CONFIRMS): Promise<void> {
    const confirmed = await this.confirms.confirm(CONFIRMS[kind]);
    this.toasts.show(confirmed ? OVERLAYS.confirmed : OVERLAYS.cancelled, confirmed ? 'success' : 'info');
  }

  protected toast(kind: ToastKind, message: string): void {
    this.toasts.show(message, kind);
  }

  /** "Leave with unsaved changes?" — `fails`: the save is refused, so the dialog stays with its reason. */
  protected async unsavedDialog(fails: boolean): Promise<void> {
    const left = await this.unsaved.confirmLeave({
      name: 'Spring campaign',
      save: async () => (fails ? { ok: false, message: '2 errors' } : { ok: true }),
    });
    this.toasts.show(left ? OVERLAYS.confirmed : OVERLAYS.cancelled, left ? 'success' : 'info');
  }

  protected undoVariant(message: string): void {
    this.toasts.undo(message, () => this.toasts.show(OVERLAYS.undone, 'info'));
  }

  protected undoToast(): void {
    this.toasts.undo(UNDO_TOAST, () => this.toasts.show(OVERLAYS.undone, 'info'));
  }

  protected chosen(item: SfMenuItem): void {
    this.toasts.show(OVERLAYS.menuChosen + item.label, 'info');
  }

  /** From `(contextmenu)` (a MouseEvent) or `(keydown.shift.f10)` (a KeyboardEvent, typed as a plain Event). */
  protected openContextMenu(event: Event): void {
    this.contextMenu.open(
      event as MouseEvent | KeyboardEvent,
      CONTEXT_ITEMS.map((item) => this.withEcho(item)),
    );
  }

  private withEcho(item: ContextMenuItem): ContextMenuItem {
    return {
      ...item,
      action: item.children || item.separator ? undefined : () => this.toasts.show(OVERLAYS.menuChosen + item.label, 'info'),
      children: item.children?.map((child) => this.withEcho(child)),
    };
  }
}
