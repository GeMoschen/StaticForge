import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DocumentTitleService } from './core/frame/app-title.strategy';
import { CommandPaletteComponent } from './core/ui/command-palette/command-palette.component';
import { ShortcutSheetComponent } from './core/ui/shortcut-sheet.component';
import { ToastHostComponent } from './core/ui/toast-host.component';
import { SfContextMenuComponent } from './shared/components/sf-context-menu.component';

@Component({
  selector: 'sf-root',
  standalone: true,
  imports: [RouterOutlet, CommandPaletteComponent, ShortcutSheetComponent, SfContextMenuComponent, ToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {
  // Keeps `<title>` on "Item · Section · Project — StaticForge" for every screen, framed or not.
  private readonly documentTitle = inject(DocumentTitleService);
}
