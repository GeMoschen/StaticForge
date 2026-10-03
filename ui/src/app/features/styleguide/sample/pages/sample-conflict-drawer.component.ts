import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleText } from '../changes/sample-area.util';
import { CONFLICT_FACTS, CONFLICT_FIELDS, SampleConflictField } from './pages-data';
import { ConflictReview } from './sample-pages-review';

type Pick = 'mine' | 'theirs';

/**
 * The revision conflict drawer (M35.18, gate round 12): what the page editor shows when a save finds that someone else saved a
 * newer revision. The app's drawer still has the old plain look and English text; this is the proposed design. A drawer from
 * the right that says **who** saved **when**, and then, **per field** that both changed, shows *Mine* and *Theirs* side by
 * side with a *Keep mine* / *Take theirs* choice; **Apply changes** stays disabled until every field has a choice and says
 * so. *Keep all mine* and *Take all theirs* answer for every field at once. When the server could not say which fields
 * differ (`whole`), the drawer lists them without values and offers only the two whole-page answers. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-conflict-drawer',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfDrawerComponent, SfDrawerFooterDirective, SfSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-conflict-drawer.component.scss',
  template: `
    <sf-drawer [title]="t('conflict.title')" [width]="460" (closed)="closed.emit()">
      <sf-banner tone="warning">{{
        t('conflict.summary', { by: facts.by, minutes: facts.minutes, yours: facts.yours, current: facts.current })
      }}</sf-banner>

      @if (mode() === 'fields') {
        <p class="conflict__lead">{{ t('conflict.leadFields', { by: facts.by }) }}</p>
        <div class="conflict__legend" aria-hidden="true">
          <span>{{ t('conflict.mine') }}</span>
          <span>{{ t('conflict.theirs') }}</span>
        </div>
        <ul class="conflict__fields">
          @for (field of fields; track field.id) {
            <li class="conflict__field">
              <p class="conflict__name" [id]="'conflict-field-' + field.id">{{ t('conflict.fields.' + field.id) }}</p>
              <div class="conflict__values">
                <p class="conflict__value" [class.is-picked]="picks()[field.id] === 'mine'">{{ field.mine }}</p>
                <p class="conflict__value" [class.is-picked]="picks()[field.id] === 'theirs'">{{ field.theirs }}</p>
              </div>
              <sf-segmented
                size="sm"
                [options]="options()"
                [value]="picks()[field.id] ?? null"
                [aria-labelledby]="'conflict-field-' + field.id"
                (valueChange)="pick(field, $event)"
              />
            </li>
          }
        </ul>
      } @else {
        <p class="conflict__lead">{{ t('conflict.leadWhole') }}</p>
        <ul class="conflict__changed" [attr.aria-label]="t('conflict.changedFields')">
          @for (field of fields; track field.id) {
            <li>{{ t('conflict.fields.' + field.id) }}</li>
          }
        </ul>
      }

      <div sfDrawerFooter class="conflict__footer">
        @if (mode() === 'fields') {
          <sf-button variant="ghost" size="sm" (click)="all('mine')">{{ t('conflict.keepAllMine') }}</sf-button>
          <sf-button variant="ghost" size="sm" (click)="all('theirs')">{{ t('conflict.takeAllTheirs') }}</sf-button>
          <sf-button [disabled]="!complete()" [disabledReason]="complete() ? null : t('conflict.chooseEach')" (click)="apply()">{{
            t('conflict.apply')
          }}</sf-button>
        } @else {
          <sf-button variant="secondary" (click)="finish('conflict.keptTheirs')">{{ t('conflict.takeTheirs') }}</sf-button>
          <sf-button (click)="finish('conflict.keptMine')">{{ t('conflict.keepMine') }}</sf-button>
        }
      </div>
    </sf-drawer>
  `,
})
export class SampleConflictDrawerComponent {
  private readonly toasts = inject(ToastService);
  protected readonly t = injectSampleText('styleguide.sample.pages');

  readonly mode = input<ConflictReview>('fields');
  readonly closed = output<void>();

  protected readonly facts = CONFLICT_FACTS;
  protected readonly fields: readonly SampleConflictField[] = CONFLICT_FIELDS;
  protected readonly picks = signal<Readonly<Partial<Record<SampleConflictField['id'], Pick>>>>({});
  protected readonly complete = computed(() => this.fields.every((field) => this.picks()[field.id] !== undefined));
  protected readonly options = computed<SfSegmentedOption<Pick>[]>(() => [
    { value: 'mine', label: this.t('conflict.keepMine') },
    { value: 'theirs', label: this.t('conflict.takeTheirs') },
  ]);

  protected pick(field: SampleConflictField, value: Pick | null): void {
    if (value) {
      this.picks.update((picks) => ({ ...picks, [field.id]: value }));
    }
  }

  protected all(value: Pick): void {
    this.picks.set(Object.fromEntries(this.fields.map((field) => [field.id, value])));
  }

  protected apply(): void {
    this.finish('conflict.applied');
  }

  protected finish(message: string): void {
    this.toasts.show(this.t(message), 'success');
    this.closed.emit();
  }
}
