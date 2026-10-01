import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import { DensityPreference } from '../../core/preferences/preferences.types';
import { DensityService } from '../../core/ui/density.service';
import { Theme, ThemeService } from '../../core/ui/theme.service';
import { SfLogoComponent } from '../../shared/components/display/sf-logo.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { applyIntersections, currentSection, spyRootMargin } from './scrollspy.util';
import { SgCardsComponent } from './sections/sg-cards.component';
import { SgCodeComponent } from './sections/sg-code.component';
import { SgControlsComponent } from './sections/sg-controls.component';
import { SgDataComponent } from './sections/sg-data.component';
import { SgDisplayComponent } from './sections/sg-display.component';
import { SgOverlaysComponent } from './sections/sg-overlays.component';
import { SgTokensComponent } from './sections/sg-tokens.component';
import { STYLEGUIDE_GROUPS, STYLEGUIDE_SECTIONS } from './styleguide.sections';

const THEMES: readonly Theme[] = ['light', 'dark'];
const DENSITIES: readonly DensityPreference[] = ['compact', 'comfortable'];

/** A query parameter value if it is one of the allowed ones. */
function allowed<T extends string>(value: string | null, values: readonly T[]): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

/**
 * The living style guide at `/styleguide` (M35.9): every design token and every M35.6–M35.8 component in its states,
 * under a sticky header with a theme and a density switch and beside a sticky section index.
 *
 * **Preview, not preference.** The switches set `data-theme` / `data-density` on `<html>` for this page only; the user's
 * preferences are never written. `?theme=light|dark&density=compact|comfortable` choose the starting values (the
 * screenshots are scripted with them); without them the page starts from what {@link ThemeService} and
 * {@link DensityService} show. Leaving the page puts the services' values back on `<html>`.
 *
 * **Index.** An IntersectionObserver watches the sections in a band under the header; the first one in it is marked
 * `aria-current` in the index (see `scrollspy.util.ts`). Without IntersectionObserver (jsdom) the first stays marked.
 */
@Component({
  selector: 'sf-styleguide-page',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfLogoComponent,
    SfPageHeaderComponent,
    SfSegmentedComponent,
    SfStatusComponent,
    SgCardsComponent,
    SgCodeComponent,
    SgControlsComponent,
    SgDataComponent,
    SgDisplayComponent,
    SgOverlaysComponent,
    SgTokensComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './styleguide-page.component.html',
  styleUrl: './styleguide-page.component.scss',
  host: { '[style.--sg-header-height]': 'headerHeightCss()' },
})
export class StyleguidePageComponent {
  private readonly themes = inject(ThemeService);
  private readonly densities = inject(DensityService);
  private readonly document = inject(DOCUMENT);
  private readonly header = viewChild.required<ElementRef<HTMLElement>>('header');

  protected readonly groups = STYLEGUIDE_GROUPS;

  /** The previewed theme and density. */
  readonly theme = signal<Theme>('light');
  readonly density = signal<DensityPreference>('compact');
  /** The id of the section marked current in the index. */
  readonly current = signal<string | null>(STYLEGUIDE_SECTIONS[0]?.id ?? null);

  private readonly headerHeight = signal<number | null>(null);
  protected readonly headerHeightCss = computed(() => {
    const height = this.headerHeight();
    return height === null ? null : `${height}px`;
  });

  private readonly labels = {
    light: translateSignal('styleguide.page.themeSwitch.light'),
    dark: translateSignal('styleguide.page.themeSwitch.dark'),
    compact: translateSignal('styleguide.page.densitySwitch.compact'),
    comfortable: translateSignal('styleguide.page.densitySwitch.comfortable'),
    reset: translateSignal('styleguide.page.actions.resetPreview'),
  };
  protected readonly themeOptions = computed<SfSegmentedOption<Theme>[]>(() => [
    { value: 'light', label: this.labels.light(), icon: 'light_mode' },
    { value: 'dark', label: this.labels.dark(), icon: 'dark_mode' },
  ]);
  protected readonly densityOptions = computed<SfSegmentedOption<DensityPreference>[]>(() => [
    { value: 'compact', label: this.labels.compact() },
    { value: 'comfortable', label: this.labels.comfortable() },
  ]);
  protected readonly headerMenu = computed<SfMenuItem[]>(() => [
    { id: 'reset', label: this.labels.reset(), icon: 'restart_alt', action: () => this.resetPreview() },
  ]);

  private spy: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    this.theme.set(allowed(params.get('theme'), THEMES) ?? this.themes.theme());
    this.density.set(allowed(params.get('density'), DENSITIES) ?? this.densities.density());

    const root = this.document.documentElement;
    // At once, so the first render already shows the preview; then on every change.
    this.applyPreview();
    effect(() => {
      // Tracking the services' values re-asserts the preview after they re-apply theirs (a late preferences load).
      this.themes.theme();
      this.densities.density();
      this.applyPreview();
    });

    inject(DestroyRef).onDestroy(() => {
      this.spy?.disconnect();
      this.resize?.disconnect();
      root.dataset['theme'] = this.themes.theme();
      root.dataset['density'] = this.densities.density();
    });

    afterNextRender(() => {
      this.measureHeader();
      if (typeof ResizeObserver !== 'undefined') {
        this.resize = new ResizeObserver(() => this.measureHeader());
        this.resize.observe(this.header().nativeElement);
      }
    });
  }

  private applyPreview(): void {
    const root = this.document.documentElement;
    root.dataset['theme'] = this.theme();
    root.dataset['density'] = this.density();
  }

  protected setTheme(value: Theme | null): void {
    if (value) {
      this.theme.set(value);
    }
  }

  protected setDensity(value: DensityPreference | null): void {
    if (value) {
      this.density.set(value);
    }
  }

  /** Back to what the user's preferences show. */
  protected resetPreview(): void {
    this.theme.set(this.themes.theme());
    this.density.set(this.densities.density());
  }

  /** Scrolls to a section (the index link's own navigation would leave the app) and moves focus to its heading. */
  protected go(event: Event, id: string): void {
    event.preventDefault();
    const section = this.document.getElementById(id);
    if (!section) {
      return;
    }
    const reduceMotion = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    section.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    this.current.set(id);
    this.document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  }

  private measureHeader(): void {
    const height = Math.round(this.header().nativeElement.getBoundingClientRect().height);
    if (height !== this.headerHeight()) {
      this.headerHeight.set(height);
      this.startSpy(height);
    }
  }

  private startSpy(headerHeight: number): void {
    this.spy?.disconnect();
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const order = STYLEGUIDE_SECTIONS.map((s) => s.id);
    let visible: ReadonlySet<string> = new Set();
    this.spy = new IntersectionObserver(
      (entries) => {
        visible = applyIntersections(
          visible,
          entries.map((entry) => ({ id: entry.target.id, isIntersecting: entry.isIntersecting })),
        );
        this.current.set(currentSection(order, visible, this.current()));
      },
      { rootMargin: spyRootMargin(headerHeight) },
    );
    for (const id of order) {
      const section = this.document.getElementById(id);
      if (section) {
        this.spy.observe(section);
      }
    }
  }
}
