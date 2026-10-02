import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { diffField } from '../changes/sample-change-diff.component';
import { HistoryField } from './history-data';

/**
 * The field changes of a history entry (M35.9 review round 2): per field, the old value (−) and the new one (+) with
 * the changed words marked, like the Changes diff. `change` shows what the revision wrote (before → after);
 * `current` compares the version's value with the one now ("Compare with current"). Labels are field names — never
 * UUIDs; a language is named in the entry's header, not here.
 */
@Component({
  selector: 'sf-sample-history-diff',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (d of diffs(); track d.label) {
      <section class="hdiff__field" [attr.aria-label]="d.label">
        <h4 class="hdiff__label">
          {{ d.label }}
          @if (d.unchanged) {
            <span class="hdiff__same">{{
              (mode() === 'current' ? 'styleguide.sample.history.diff.sameAsCurrent' : 'styleguide.sample.history.diff.unchanged') | transloco
            }}</span>
          }
        </h4>
        @if (!d.unchanged) {
          @for (side of ['removed', 'added']; track side) {
            @let segments = side === 'removed' ? d.before : d.after;
            <div class="hdiff__value" [class.hdiff__value--removed]="side === 'removed'" [class.hdiff__value--added]="side === 'added'">
              <span class="hdiff__marker" aria-hidden="true">{{ side === 'removed' ? '−' : '+' }}</span>
              <span class="sf-sr-only">{{
                (side === 'removed' ? 'styleguide.sample.history.diff.old' : 'styleguide.sample.history.diff.new') | transloco
              }}</span>
              <span class="hdiff__text">
                @if (segments) {
                  @for (s of segments; track $index) {
                    @if (s.changed) {
                      @if (side === 'removed') {
                        <del class="hdiff__del">{{ s.text }}</del>
                      } @else {
                        <ins class="hdiff__ins">{{ s.text }}</ins>
                      }
                    } @else {
                      <span>{{ s.text }}</span>
                    }
                  }
                } @else {
                  <em class="hdiff__empty">{{
                    (side === 'removed' ? 'styleguide.sample.history.diff.wasEmpty' : 'styleguide.sample.history.diff.nowEmpty') | transloco
                  }}</em>
                }
              </span>
            </div>
          }
        }
      </section>
    }
  `,
  styleUrl: './sample-history-diff.component.scss',
})
export class SampleHistoryDiffComponent {
  readonly fields = input.required<readonly HistoryField[]>();
  readonly mode = input<'change' | 'current'>('change');

  protected readonly diffs = computed(() =>
    this.fields().map((field) =>
      diffField(
        this.mode() === 'current'
          ? { label: field.label, before: field.after, after: field.current }
          : { label: field.label, before: field.before, after: field.after },
      ),
    ),
  );
}
