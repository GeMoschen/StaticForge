import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { statusColor } from './generation-run.util';
import { GenerationStore } from './generation.store';

/** The live log of a running (or just finished) generation: its events, counters and diagnostics. */
@Component({
  selector: 'sf-generation-live-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './generation-live-log.component.html',
  styleUrl: './generation-live-log.component.scss',
})
export class GenerationLiveLogComponent {
  protected readonly store = inject(GenerationStore);
  protected statusColor = statusColor;
}
