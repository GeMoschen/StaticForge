import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SectionPaletteService } from './section-palette.service';

/** The dialog that lists the section templates a body allows and adds the chosen one. */
@Component({
  selector: 'sf-section-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './section-palette.component.html',
  styleUrl: './section-palette.component.scss',
})
export class SectionPaletteComponent {
  protected readonly palette = inject(SectionPaletteService);
}
