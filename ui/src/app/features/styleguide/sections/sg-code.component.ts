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
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import { SfCodeEditorComponent } from '../../../shared/code-editor/code-editor.component';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfBadgeComponent, SfBadgeTone } from '../../../shared/components/display/sf-badge.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { CodePalette, SYNTAX_TOKENS, applyCodePalette, codePaletteParam } from '../code-palette.util';
import { Rgba, TEXT_CONTRAST, contrastRatio, formatRatio, meetsContrast, parseColor, toHex } from '../contrast.util';
import { CODE_DEMO } from '../styleguide.code-demo';
import { sectionOf } from '../styleguide.sections';

/** One row of the syntax colour table. */
interface SwatchView {
  readonly name: string;
  readonly value: string | null;
  readonly ratio: string | null;
  readonly tone: SfBadgeTone;
  /** `styleguide.page.colors.*` key of the verdict. */
  readonly verdict: string;
}

const DASH = '—';

/**
 * The code editor section of the style guide (M35.9, decisions 16–18): `sf-code-panel` with a CDL source (one error),
 * an OCTL HTML channel (one warning), JSON (Format pretty-prints it) and a read-only template, the compact `where`
 * field, and the two highlighting palettes to compare with their syntax colours and contrast on the editor background.
 *
 * **Palette preview.** The switch sets `data-code-palette` on `<html>` for this page only (`refined`; `current` is the
 * default and removes it); `?palette=current|refined` chooses the starting one; leaving the page removes the attribute.
 */
@Component({
  selector: 'sf-sg-code',
  standalone: true,
  imports: [SfBadgeComponent, SfCodeEditorComponent, SfCodePanelComponent, SfSegmentedComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-code.component.html',
  styleUrl: './sg-code.component.scss',
})
export class SgCodeComponent {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly s = sectionOf('code');
  protected readonly d = CODE_DEMO;
  protected readonly dash = DASH;

  readonly palette = signal<CodePalette>('current');

  protected readonly cdl = signal<string>(CODE_DEMO.cdl.source);
  protected readonly octl = signal<string>(CODE_DEMO.octl.source);
  protected readonly json = signal<string>(CODE_DEMO.json.source);
  protected readonly where = signal<string>(CODE_DEMO.where.source);

  private readonly labels = {
    current: translateSignal('styleguide.page.code.palette.current'),
    refined: translateSignal('styleguide.page.code.palette.refined'),
  };
  protected readonly paletteOptions = computed<SfSegmentedOption<CodePalette>[]>(() => [
    { value: 'current', label: this.labels.current() },
    { value: 'refined', label: this.labels.refined() },
  ]);

  private readonly colors = signal<ReadonlyMap<string, Rgba | null>>(new Map());
  protected readonly swatches = computed<SwatchView[]>(() => {
    const colors = this.colors();
    const bg = colors.get('code-bg') ?? null;
    return SYNTAX_TOKENS.map((name) => swatchView(name, colors.get(name) ?? null, bg));
  });

  constructor() {
    const root = this.document.documentElement;
    this.palette.set(codePaletteParam(inject(ActivatedRoute).snapshot.queryParamMap.get('palette')) ?? 'current');
    applyCodePalette(root, this.palette());
    effect(() => applyCodePalette(root, this.palette()));

    afterNextRender({ read: () => this.readValues() });
    const destroyRef = inject(DestroyRef);
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => this.readValues());
      observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-code-palette'] });
      destroyRef.onDestroy(() => observer.disconnect());
    }
    destroyRef.onDestroy(() => applyCodePalette(root, 'current'));
  }

  protected setPalette(value: CodePalette | null): void {
    if (value) {
      this.palette.set(value);
    }
  }

  protected cssVar(name: string): string {
    return `var(--sf-${name})`;
  }

  /** The syntax colours and the editor background as the computed styles give them. */
  private readValues(): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const probe = this.document.createElement('span');
    probe.hidden = true;
    this.host.nativeElement.appendChild(probe);
    const colors = new Map<string, Rgba | null>();
    for (const name of [...SYNTAX_TOKENS, 'code-bg']) {
      probe.style.color = '';
      probe.style.color = this.cssVar(name);
      colors.set(name, parseColor(view.getComputedStyle(probe).color));
    }
    probe.remove();
    this.colors.set(colors);
  }
}

function swatchView(name: string, fg: Rgba | null, bg: Rgba | null): SwatchView {
  const ratio = fg && bg ? contrastRatio(fg, bg) : null;
  const pass = ratio !== null && meetsContrast(ratio, TEXT_CONTRAST);
  return {
    name,
    value: fg ? toHex(fg) : null,
    ratio: ratio === null ? null : formatRatio(ratio),
    tone: ratio === null ? 'neutral' : pass ? 'success' : 'danger',
    verdict:
      ratio === null ? 'styleguide.page.colors.unmeasured' : pass ? 'styleguide.page.colors.pass' : 'styleguide.page.colors.fail',
  };
}
