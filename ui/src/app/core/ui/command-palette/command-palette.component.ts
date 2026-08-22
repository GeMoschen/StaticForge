import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ShortcutService } from '../shortcut.service';
import { SfAutofocusDirective } from '../../../shared/directives/sf-autofocus.directive';

@Component({
  selector: 'sf-command-palette',
  standalone: true,
  imports: [SfAutofocusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private readonly shortcuts = inject(ShortcutService);
  readonly open = this.shortcuts.commandPaletteOpen;

  close(): void {
    this.shortcuts.closePalette();
  }
}
