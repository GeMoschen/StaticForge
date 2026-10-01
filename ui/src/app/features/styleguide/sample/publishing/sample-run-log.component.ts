import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfVirtualScrollDirective } from '../../../../shared/virtual/virtual-window';
import { LogLine, SampleRun, logOf, renderLine } from './publishing-data';
import { PublishingState } from './publishing-state';

/** Fake lines arrive this often (ms); slower when the user prefers reduced motion. */
export const LOG_TICK = 800;
export const LOG_TICK_REDUCED = 2400;
/** The fake run stops growing here. */
const LOG_CAP = 3000;

/**
 * A run's log: monospace, virtualized (`sfVirtualScroll`, fixed rows of `--sample-log-row`), with line numbers, times
 * and stages; warnings and errors are marked by colour *and* their bracketed code.
 *
 * For the running run, fake lines are appended on a timer (stopped on destroy) and the view **follows the tail**:
 * after each render it jumps to the end while following. Scrolling up pauses following ("Jump to end" resumes).
 * The jump is never animated; with `prefers-reduced-motion: reduce` lines also arrive less often, so the view moves
 * less.
 */
@Component({
  selector: 'sf-sample-run-log',
  standalone: true,
  imports: [SfButtonComponent, SfVirtualScrollDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-run-log.component.html',
  styleUrl: './sample-run-log.component.scss',
})
export class SampleRunLogComponent implements OnInit {
  readonly run = input.required<SampleRun>();

  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly view = viewChild.required<ElementRef<HTMLElement>>('view');
  private readonly virtual = viewChild.required(SfVirtualScrollDirective);

  private readonly base = computed(() => logOf(this.run()));
  /** Lines the fake tail appended. */
  private readonly appended = signal<readonly LogLine[]>([]);
  readonly lines = computed<readonly LogLine[]>(() => [...this.base(), ...this.appended()]);
  /** Whether the view keeps to the newest line (only a running run's log follows). */
  readonly following = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;
  private programmatic = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    afterRender(() => {
      if (this.following() && this.run().status === 'running') {
        this.scrollToEnd();
      }
    });
  }

  ngOnInit(): void {
    if (this.run().status !== 'running') {
      return;
    }
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.timer = setInterval(() => this.append(), reduced ? LOG_TICK_REDUCED : LOG_TICK);
  }

  private append(): void {
    const current = this.lines();
    if (current.length >= LOG_CAP) {
      this.stop();
      return;
    }
    this.appended.update((lines) => [...lines, renderLine(current.length + 1), renderLine(current.length + 2)]);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  protected onScroll(): void {
    if (this.programmatic) {
      this.programmatic = false;
      return;
    }
    const el = this.view().nativeElement;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - this.virtual().rowHeight();
    this.following.set(atEnd);
  }

  protected jumpToEnd(): void {
    this.following.set(true);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    const el = this.view().nativeElement;
    const end = el.scrollHeight - el.clientHeight;
    if (end > 0 && el.scrollTop < end) {
      this.programmatic = true;
      el.scrollTop = end;
      this.virtual().measure();
    }
  }
}
