import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SampleState } from '../sample-state';
import { SampleLoginComponent } from './sample-login.component';
import { SampleSetPasswordComponent } from './sample-set-password.component';

/**
 * The screens outside the frame (M35.16): Sign in (`area=login`) and Set password (`area=setpassword`). The sample
 * screen leaves out the top bar and the rail for them (`SampleState.bare`).
 */
@Component({
  selector: 'sf-sample-auth-area',
  standalone: true,
  imports: [SampleLoginComponent, SampleSetPasswordComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-auth-area.component.scss',
  template: `
    @if (state.area() === 'setpassword') {
      <sf-sample-set-password />
    } @else {
      <sf-sample-login />
    }
  `,
})
export class SampleAuthAreaComponent {
  protected readonly state = inject(SampleState);
}
