import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';

let nextId = 0;

/**
 * The group editor (M35.17 sample): related fields in a bordered panel with a **collapsible** header — a disclosure
 * button (`aria-expanded`) with the group's name and, while it is collapsed, a **summary line** of what is inside
 * ("Spring harvest arrives — Lumen Coffee · /news/spring-harvest"), so a closed group still tells its content. The fields
 * are projected; the group opens expanded.
 */
@Component({
  selector: 'sf-sample-group-field',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-group-field.component.scss',
  template: `
    <section class="group" [class.is-collapsed]="!expanded()">
      <h3 class="group__title">
        <button type="button" class="group__toggle" [attr.aria-expanded]="expanded()" [attr.aria-controls]="id" (click)="expanded.set(!expanded())">
          <sf-icon class="group__chevron" [name]="expanded() ? 'expand_more' : 'chevron_right'" />
          <span class="group__name">{{ name() }}</span>
          @if (!expanded() && summary()) {
            <span class="group__summary">{{ summary() }}</span>
          }
        </button>
      </h3>
      <div class="group__body" [id]="id" [hidden]="!expanded()">
        <ng-content />
      </div>
    </section>
  `,
})
export class SampleGroupFieldComponent {
  readonly name = input.required<string>();
  /** What the closed group shows after its name. */
  readonly summary = input<string>('');
  readonly expanded = model(true);

  protected readonly id = `sample-group-${nextId++}`;
}
