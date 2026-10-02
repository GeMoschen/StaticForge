import { TranslocoPipe } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { SfButtonComponent } from './sf-button.component';
import { SfFieldComponent } from './sf-field.component';
import { SfSpinnerComponent } from './sf-spinner.component';
import { SfUidRenameComponent } from './sf-uid-rename.component';

/**
 * Shared "rename asset" modal — one dialog for every asset type that carries
 * both a displayName and a UID (folders, pages, page/section templates,
 * media, navigation folders/references). Two independent sections/actions:
 *
 *  - Display name: a plain text field with its own Save button. This dialog
 *    never calls a rename API itself — the caller does that via
 *    `renameDisplayName` and is expected to either toggle `open` back to
 *    `false` on success, or leave it `true` so the user can fix and retry on
 *    error, exactly mirroring `sf-create-asset-dialog`'s "caller performs
 *    the mutation" contract.
 *  - UID: delegated entirely to the self-contained `sf-uid-rename`, which
 *    owns its own API call; `uidChanged` just re-emits its output once it
 *    has already completed successfully, so the caller can refresh/toast as
 *    it would after any other `sf-uid-rename` usage in this codebase.
 */
@Component({
  selector: 'sf-rename-asset-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfFieldComponent, SfSpinnerComponent, SfUidRenameComponent, TranslocoPipe],
  templateUrl: './sf-rename-asset-dialog.component.html',
  styleUrl: './sf-rename-asset-dialog.component.scss',
})
export class SfRenameAssetDialogComponent {
  readonly open = input.required<boolean>();
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  readonly uid = input.required<string>();
  readonly displayName = input.required<string>();
  readonly submittingName = input(false);
  /** Offers Undo after a UID change (see `sf-uid-rename`). */
  readonly undoableUid = input(false);

  readonly renameDisplayName = output<string>();
  readonly uidChanged = output<string>();
  readonly closed = output<void>();

  private readonly panelRef = viewChild<ElementRef<HTMLDivElement>>('panel');
  private readonly nameInputRef = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly draft = signal('');
  protected readonly touched = signal(false);

  protected readonly invalid = () => this.draft().trim().length === 0;

  constructor() {
    // Reset/prefill the draft and place focus whenever the dialog transitions
    // to open — never merely because `submittingName` flipped back to false,
    // so a failed rename leaves the user's entry intact to retry.
    effect(
      () => {
        const isOpen = this.open();
        if (isOpen) {
          const name = this.displayName();
          untracked(() => {
            this.draft.set(name);
            this.touched.set(false);
            this.focusNameField();
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** Escape goes through the shortcut registry (M35.14). */
  private readonly escapeShortcut = inject(ShortcutService).useEscape(() => {
    if (!this.open()) {
      return false;
    }
    this.close();
    return true;
  });

  @HostListener('keydown.tab', ['$event'])
  protected onTab(event: KeyboardEvent): void {
    if (this.open()) {
      this.trapFocus(event);
    }
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected close(): void {
    this.closed.emit();
  }

  protected saveName(): void {
    this.touched.set(true);
    if (this.invalid() || this.submittingName()) {
      return;
    }
    this.renameDisplayName.emit(this.draft().trim());
  }

  protected onUidChanged(newUid: string): void {
    this.uidChanged.emit(newUid);
  }

  private focusNameField(): void {
    queueMicrotask(() => this.nameInputRef()?.nativeElement.focus());
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) {
      return;
    }
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
