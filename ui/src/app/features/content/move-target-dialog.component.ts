import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import type { MoveTarget } from './content-tree.util';

/**
 * "Move to…" for the Content store (M25.5.1): a list of the places an asset may go — the caller
 * decides which ({@link folderMoveTargets} for a record set, {@link recordMoveTargets} for a record),
 * so a target the server would reject is never offered. The current place is listed but can't be
 * chosen, and nothing is preselected: Move stays disabled until the user picks somewhere new.
 */
@Component({
  selector: 'sf-move-target-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfSpinnerComponent],
  template: `
    @if (open()) {
      <div class="scrim" (click)="cancel()"></div>
      <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()">
        <header class="dialog__header">
          <h2 class="dialog__title">{{ title() }}</h2>
          <button type="button" class="dialog__close" aria-label="Close" (click)="cancel()">×</button>
        </header>
        <div class="dialog__body">
          @if (description()) {
            <p class="move__description">{{ description() }}</p>
          }
          @if (targets().length === 0) {
            <p class="move__empty">{{ emptyText() }}</p>
          } @else {
            <ul class="move__list" role="radiogroup" [attr.aria-label]="title()">
              @for (target of targets(); track $index) {
                <li>
                  <label
                    class="move__target"
                    [class.move__target--current]="target.current"
                    [style.padding-left.px]="12 + target.depth * 16"
                  >
                    <input
                      type="radio"
                      name="move-target"
                      [checked]="isChosen(target)"
                      [disabled]="target.current"
                      (change)="choose(target)"
                    />
                    <span class="move__label">{{ target.label }}</span>
                    @if (target.detail) {
                      <span class="move__detail">{{ target.detail }}</span>
                    }
                    @if (target.current) {
                      <span class="move__detail">(current)</span>
                    }
                  </label>
                </li>
              }
            </ul>
          }
          <div class="dialog__actions">
            <sf-button type="button" variant="ghost" [disabled]="submitting()" (click)="cancel()">Cancel</sf-button>
            <sf-button type="button" variant="primary" [disabled]="!canMove()" (click)="confirm()">
              @if (submitting()) {
                <sf-spinner label="Moving…" />
              } @else {
                Move
              }
            </sf-button>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './move-target-dialog.component.scss',
})
export class MoveTargetDialogComponent {
  readonly open = input.required<boolean>();
  readonly title = input<string>('Move to…');
  readonly description = input<string>('');
  readonly targets = input<MoveTarget[]>([]);
  readonly emptyText = input<string>('There is nowhere else to move this to.');
  readonly submitting = input(false);

  /** The chosen target's uuid; `null` is the store root. */
  readonly chosen = output<string | null>();
  readonly closed = output<void>();

  /** `undefined` until the user picks — distinct from `null`, the store root. */
  private readonly selection = signal<string | null | undefined>(undefined);

  protected readonly canMove = computed(() => this.selection() !== undefined && !this.submitting());

  constructor() {
    effect(
      () => {
        if (!this.open()) {
          untracked(() => this.selection.set(undefined));
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** Escape goes through the shortcut registry, which orders it among the open layers (M35.14). */
  private readonly escapeShortcut = inject(ShortcutService).useEscape(() => this.onEscape());

  protected onEscape(): boolean {
    if (!this.open()) {
      return false;
    }
    this.cancel();
    return true;
  }

  protected isChosen(target: MoveTarget): boolean {
    return this.selection() === target.uuid;
  }

  protected choose(target: MoveTarget): void {
    if (!target.current) {
      this.selection.set(target.uuid);
    }
  }

  protected confirm(): void {
    const selection = this.selection();
    if (selection !== undefined && !this.submitting()) {
      this.chosen.emit(selection);
    }
  }

  protected cancel(): void {
    this.selection.set(undefined);
    this.closed.emit();
  }
}
