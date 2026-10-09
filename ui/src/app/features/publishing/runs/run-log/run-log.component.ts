import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { I18nFormatService, toDate } from '../../../../core/i18n/i18n-format.service';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfVirtualScrollDirective } from '../../../../shared/virtual/virtual-window';
import { type GenerationRunView, isActiveRun } from '../runs.util';
import { RunLogStore } from './run-log.store';

/**
 * A run's log (M35.24, decisions 186 and 195): monospace, virtualized (fixed rows), with line numbers, times and a
 * fixed-width bold `[STAGE]` prefix; warnings and errors are marked by colour *and* a text cue for screen readers. The
 * bar counts lines, files, errors and warnings (the newest line carries the run's current totals). A queued run
 * without events says *Awaiting events…*.
 *
 * A running run follows the tail: after each render the view sits at the end while following. Scrolling up pauses
 * following; *Jump to the end* resumes (never animated). A finished run opens at the top. `finished` fires once, when a
 * log that was live is final.
 */
@Component({
  selector: 'sf-run-log',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfEmptyStateComponent, SfVirtualScrollDirective, TranslocoPipe],
  providers: [RunLogStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-log.component.html',
  styleUrl: './run-log.component.scss',
})
export class RunLogComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();
  readonly finished = output<void>();

  protected readonly store = inject(RunLogStore);
  private readonly format = inject(I18nFormatService);
  private readonly view = viewChild<ElementRef<HTMLElement>>('view');
  private readonly virtual = viewChild(SfVirtualScrollDirective);

  private readonly runId = computed(() => this.run().id ?? 0);
  private readonly active = computed(() => isActiveRun(this.run()));
  /** Whether the view keeps to the newest line. */
  protected readonly following = signal(true);
  private programmatic = false;

  private readonly clock = computed(
    () => new Intl.DateTimeFormat(this.format.locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const id = this.runId();
      untracked(() => {
        this.following.set(true);
        this.store.open(key, id, this.active(), () => this.finished.emit());
      });
    });
    effect(() => {
      if (!this.active()) {
        untracked(() => this.store.settle());
      }
    });
    afterRender(() => {
      if (this.following() && this.store.live()) {
        this.scrollToEnd();
      }
    });
  }

  protected time(value: string | undefined): string {
    const date = toDate(value);
    return date ? this.clock().format(date) : '';
  }

  protected onScroll(): void {
    if (this.programmatic) {
      this.programmatic = false;
      return;
    }
    const el = this.view()?.nativeElement;
    const virtual = this.virtual();
    if (el && virtual) {
      this.following.set(el.scrollTop + el.clientHeight >= el.scrollHeight - virtual.rowHeight());
    }
  }

  protected jumpToEnd(): void {
    this.following.set(true);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    const el = this.view()?.nativeElement;
    if (!el) {
      return;
    }
    const end = el.scrollHeight - el.clientHeight;
    if (end > 0 && el.scrollTop < end) {
      this.programmatic = true;
      el.scrollTop = end;
      this.virtual()?.measure();
    }
  }
}
