import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { positionLabel } from '../text-media.util';
import { MediaDrawerTextStore } from './media-drawer-text.store';
import { MediaDrawerStore } from './media-drawer.store';

/**
 * The Processing tab (decision 21): the "Process CMS syntax" switch of text media and the findings of the last attempt.
 * The backend keeps no record of an attempt, so the findings are the answer of the switch (warnings, or the 422's
 * diagnostics) while this drawer is open, else the saved text checked now (`POST text/validate`).
 */
@Component({
  selector: 'sf-media-drawer-process',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfStatusComponent, SfSwitchComponent, TranslocoPipe],
  templateUrl: './media-drawer-process.component.html',
  styleUrl: './media-drawer-process.component.scss',
})
export class MediaDrawerProcessComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly text = inject(MediaDrawerTextStore);
  protected readonly positionLabel = positionLabel;
  private readonly toggle = viewChild(SfSwitchComponent);

  /** The findings shown: the switch's own answer, else the check of the saved text. */
  protected readonly findings = computed(() => {
    const attempt = this.core.processDiagnostics();
    return attempt.length > 0 ? attempt : (this.text.checkedDiagnostics() ?? []);
  });

  protected async onSwitch(wanted: boolean): Promise<void> {
    // Putting the switch back (below) reports a change too; it is the server's state already.
    if (wanted === this.core.processCms()) {
      return;
    }
    await this.text.setProcess(wanted);
    // A refused switch-on (the 422) leaves the switch where the server has it.
    this.toggle()?.value.set(this.core.processCms());
  }
}
