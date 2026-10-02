import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The muted "12/80" counter under a length-limited text field (M35.17); the field's own limit, not a finding. */
@Component({
  selector: 'sf-editor-count',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin-block-start: var(--sf-space-1);
      color: var(--sf-text-muted);
      font-size: var(--sf-fs-12);
      line-height: var(--sf-lh-12);
      text-align: end;
    }
  `,
  template: `{{ count() }}/{{ max() }}`,
})
export class SfEditorCountComponent {
  readonly count = input.required<number>();
  readonly max = input.required<number>();
}
