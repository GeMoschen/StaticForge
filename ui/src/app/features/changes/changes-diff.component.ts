import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SfDiffComponent } from '../../shared/components/sf-diff.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { assetRoute } from '../../shared/asset-route.util';
import { assetName } from '../release/release-choice.util';
import { statusLabel } from '../release/release-status.util';
import { typeInfo } from './changes-query.util';
import { type ChangeRowView, ChangesStore } from './changes.store';

/** The released-to-draft diff of the focused row, beside the list. */
@Component({
  selector: 'sf-changes-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfDiffComponent, SfIconComponent, SfSpinnerComponent],
  templateUrl: './changes-diff.component.html',
  styleUrl: './changes-diff.component.scss',
})
export class ChangesDiffComponent {
  protected readonly store = inject(ChangesStore);
  readonly projectKey = input.required<string>();

  protected typeInfo = typeInfo;
  protected statusLabel = statusLabel;
  protected name = assetName;

  protected editorRoute(row: ChangeRowView) {
    return assetRoute(this.projectKey(), row);
  }
}
