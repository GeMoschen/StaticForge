import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent } from '../../shared/components/dialog/sf-dialog.component';
import { SfKbdComponent } from '../../shared/components/display/sf-kbd.component';
import { ShortcutService } from './shortcut.service';

/** The shortcuts that exist today; M35.14 replaces this list with the shortcut registry. */
const SHORTCUTS: readonly { id: string; keys: string }[] = [
  { id: 'search', keys: 'Mod+K' },
  { id: 'sheet', keys: 'Shift+?' },
];

/** The `?` sheet (M35.10): a dialog listing the keyboard shortcuts. Opened from the top bar or with `?`. */
@Component({
  selector: 'sf-shortcut-sheet',
  standalone: true,
  imports: [SfDialogComponent, SfKbdComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shortcut-sheet.component.scss',
  template: `
    @if (shortcuts.shortcutSheetOpen()) {
      <sf-dialog size="sm" [title]="'frame.shortcuts.title' | transloco" (closed)="shortcuts.shortcutSheetOpen.set(false)">
        <dl class="sheet">
          @for (shortcut of list; track shortcut.id) {
            <div class="sheet__row">
              <dt>{{ 'frame.shortcuts.' + shortcut.id | transloco }}</dt>
              <dd><sf-kbd [keys]="shortcut.keys" /></dd>
            </div>
          }
        </dl>
      </sf-dialog>
    }
  `,
})
export class ShortcutSheetComponent {
  protected readonly shortcuts = inject(ShortcutService);
  protected readonly list = SHORTCUTS;
}
