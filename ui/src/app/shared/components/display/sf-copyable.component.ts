import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { I18nFormatService } from '../../../core/i18n/i18n-format.service';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { SfButtonComponent } from '../sf-button.component';

/** How long the button shows its "copied" check mark. */
const FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A monospace identifier with a copy button (M35.6), for the developer-mode identifiers (UIDs, UUIDs, internal paths).
 *
 * - The value is truncated with an ellipsis; the full value is its tooltip (and its text for screen readers).
 * - The icon-only button is named "Copy" or, with `label`, "Copy {label}" ("Copy UUID").
 * - After copying, the icon turns into a check mark for 1.5 s and a polite live region says "Copied" ("Copy failed"
 *   when the clipboard refuses).
 */
@Component({
  selector: 'sf-copyable',
  standalone: true,
  imports: [SfButtonComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <code class="sf-copyable__value" [sfTooltip]="value()" [sfTooltipDescribes]="false">{{ value() }}</code>
    <sf-button
      class="sf-copyable__button"
      variant="ghost"
      size="sm"
      [icon]="state() === 'copied' ? 'check' : 'content_copy'"
      [label]="buttonLabel()"
      (click)="copy()"
    />
    <span class="sf-sr-only" aria-live="polite">{{ messageKey() ? (messageKey()! | transloco) : '' }}</span>
  `,
  styleUrl: './sf-copyable.component.scss',
  host: {
    class: 'sf-copyable',
  },
})
export class SfCopyableComponent {
  readonly value = input.required<string>();
  /** What the value is ("UUID", "Path"): names the button "Copy {label}". */
  readonly label = input<string | null>(null);

  private readonly format = inject(I18nFormatService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly state = signal<CopyState>('idle');
  protected readonly messageKey = computed(() => {
    switch (this.state()) {
      case 'copied':
        return 'shared.copyable.copied';
      case 'failed':
        return 'shared.copyable.failed';
      default:
        return null;
    }
  });
  protected readonly buttonLabel = computed(() => {
    this.format.lang();
    const label = this.label();
    return label
      ? this.format.translate('shared.copyable.copyLabel', { label })
      : this.format.translate('shared.copyable.copy');
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /** Copies the value to the clipboard and reports the outcome. */
  async copy(): Promise<void> {
    this.clearTimer();
    this.state.set('idle');
    let next: CopyState;
    try {
      await navigator.clipboard.writeText(this.value());
      next = 'copied';
    } catch {
      next = 'failed';
    }
    this.state.set(next);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.state.set('idle');
    }, FEEDBACK_MS);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
