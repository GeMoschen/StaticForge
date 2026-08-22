import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommandPaletteComponent } from './core/ui/command-palette/command-palette.component';

@Component({
  selector: 'sf-root',
  standalone: true,
  imports: [RouterOutlet, CommandPaletteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {}
