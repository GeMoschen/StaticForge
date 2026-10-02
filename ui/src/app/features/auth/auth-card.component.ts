import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SfLogoComponent } from '../../shared/components/display/sf-logo.component';

/**
 * The card of the screens outside the app frame (M35.16: Sign in, Set password): the product mark and name above the
 * content, centred on the page background, with a quiet footer slot (`[sfAuthFooter]`) for the small print.
 */
@Component({
  selector: 'sf-auth-card',
  standalone: true,
  imports: [SfLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-card.component.scss',
  template: `
    <main class="page">
      <div class="card">
        <sf-logo class="card__logo" />
        <ng-content />
      </div>
      <div class="page__footer"><ng-content select="[sfAuthFooter]" /></div>
    </main>
  `,
})
export class AuthCardComponent {}
