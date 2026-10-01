import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBadgeTone, SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { Rgba, contrastRatio, formatRatio, meetsContrast, parseColor, toHex } from '../contrast.util';
import { MONO_SAMPLE, SAMPLE_GLYPHS, TYPE_SAMPLE } from '../styleguide.demo';
import { sectionOf } from '../styleguide.sections';
import { COLOR_GROUPS, ContrastCheck, colorTokenNames } from './color-tokens';
import {
  DENSITY_TOKENS,
  DURATIONS,
  EASINGS,
  ELEVATIONS,
  FONT_FAMILIES,
  FONT_WEIGHTS,
  LAYOUT_TOKENS,
  RADII,
  SCALE_TOKEN_NAMES,
  SPACING_STEPS,
  TYPE_SIZES,
  Z_LAYERS,
} from './scale-tokens';

/** Shown for a value that could not be read. */
const DASH = '—';

interface CheckView extends ContrastCheck {
  /** The other token of the pair (the background for a foreground token, and vice versa). */
  readonly other: string;
  /** Whether the token is the foreground of the pair. */
  readonly onOther: boolean;
  readonly ratio: string | null;
  readonly tone: SfBadgeTone;
  readonly verdict: string;
}

/**
 * The token sections of the style guide (M35.9): colours with live contrast, type, spacing and layout, radius,
 * elevation, z-index, motion and density. Every value is read from the computed styles, so it is what the current
 * theme and density really resolve to. The values are read after the first render and again whenever `data-theme` or
 * `data-density` on `<html>` changes (a MutationObserver), whoever changed it — so the timing of the page's preview
 * and the theme service's own writes doesn't matter.
 */
@Component({
  selector: 'sf-sg-tokens',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-tokens.component.html',
  styleUrl: './sg-tokens.component.scss',
})
export class SgTokensComponent {
  /** The previewed density, named in the density section's intro. */
  readonly density = input.required<string>();

  protected readonly s = {
    colors: sectionOf('colors'),
    type: sectionOf('type'),
    spacing: sectionOf('spacing'),
    radius: sectionOf('radius'),
    elevation: sectionOf('elevation'),
    stacking: sectionOf('zIndex'),
    motion: sectionOf('motion'),
    density: sectionOf('density'),
  };
  protected readonly glyphs = SAMPLE_GLYPHS;
  protected readonly typeSample = TYPE_SAMPLE;
  protected readonly monoSample = MONO_SAMPLE;
  protected readonly typeSizes = TYPE_SIZES;
  protected readonly weights = FONT_WEIGHTS;
  protected readonly families = FONT_FAMILIES;
  protected readonly spacing = SPACING_STEPS;
  protected readonly layoutTokens = LAYOUT_TOKENS;
  protected readonly radii = RADII;
  protected readonly elevations = ELEVATIONS;
  protected readonly zLayers = Z_LAYERS;
  protected readonly durations = DURATIONS;
  protected readonly easings = EASINGS;
  protected readonly densityTokens = DENSITY_TOKENS;
  protected readonly playing = signal(false);
  protected readonly dash = DASH;

  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly colors = signal<ReadonlyMap<string, Rgba | null>>(new Map());
  private readonly scales = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly colorGroups = computed(() => {
    const colors = this.colors();
    return COLOR_GROUPS.map((group) => ({
      ...group,
      tokens: group.tokens.map((token) => {
        const value = colors.get(token.name) ?? null;
        return {
          name: token.name,
          value: value ? toHex(value) : null,
          checks: token.checks.map((check) => checkView(check, token.name, colors)),
        };
      }),
    }));
  });

  constructor() {
    afterNextRender({ read: () => this.readValues() });
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => this.readValues());
      observer.observe(this.document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density', 'data-code-palette'] });
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  /** The value of a scale token as the computed styles give it. */
  protected scale(name: string): string {
    return this.scales().get(name) || DASH;
  }

  protected cssVar(name: string): string {
    return `var(--sf-${name})`;
  }

  private readValues(): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const probe = this.document.createElement('span');
    probe.hidden = true;
    this.host.nativeElement.appendChild(probe);
    const colors = new Map<string, Rgba | null>();
    for (const name of colorTokenNames()) {
      probe.style.color = '';
      probe.style.color = this.cssVar(name);
      colors.set(name, parseColor(view.getComputedStyle(probe).color));
    }
    probe.remove();
    const root = view.getComputedStyle(this.document.documentElement);
    const scales = new Map<string, string>();
    for (const name of SCALE_TOKEN_NAMES) {
      scales.set(name, root.getPropertyValue(`--sf-${name}`).trim());
    }
    this.colors.set(colors);
    this.scales.set(scales);
  }
}

function checkView(check: ContrastCheck, token: string, colors: ReadonlyMap<string, Rgba | null>): CheckView {
  const onOther = check.fg === token;
  const fg = colors.get(check.fg) ?? null;
  const bg = colors.get(check.bg) ?? null;
  const ratio = fg && bg ? contrastRatio(fg, bg) : null;
  let tone: SfBadgeTone = 'neutral';
  let verdict = 'styleguide.page.colors.unmeasured';
  if (check.min === null) {
    verdict = 'styleguide.page.colors.decorative';
  } else if (ratio !== null) {
    const pass = meetsContrast(ratio, check.min);
    tone = pass ? 'success' : 'danger';
    verdict = pass ? 'styleguide.page.colors.pass' : 'styleguide.page.colors.fail';
  }
  return {
    ...check,
    other: onOther ? check.bg : check.fg,
    onOther,
    ratio: ratio === null ? null : formatRatio(ratio),
    tone,
    verdict,
  };
}
