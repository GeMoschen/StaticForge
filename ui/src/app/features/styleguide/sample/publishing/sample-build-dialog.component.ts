import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, output, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleQuery } from '../changes/sample-area.util';
import { BUILD_CHANNELS, BUILD_DIAGNOSTICS, BuildChannel, BuildPreview, DEFAULT_TARGET, PAGES, RunMode, TARGETS, previewFor } from './publishing-data';
import { PublishingState } from './publishing-state';

/** How long "Planning…" and the submitting spinner last in the demo. */
const DEMO_DELAY = 700;

/**
 * Build now (M35.24 preview): channels (one checkbox per enabled channel, the last one stays on), an optional comment,
 * the target (the default preselected), Full / Incremental, a page scope picker and an **explicit** plan preview:
 * "Validate templates" and **Preview plan** (Alt+P) compute it — nothing is computed before, and any later change to the
 * form marks the shown plan stale. The plan shows counts and the revision, the root kinds, the largest groups by the
 * change they come from, the changed assets, the redirects the run would add and the template diagnostics. Without a
 * target Start is disabled; an editor (limited permission) can only start incremental builds of the default target.
 * Nothing starts.
 *
 * Variants (query parameters, see {@link PublishingState}): `bplan=1` plan previewed, `bfallback=1`, `bempty=1`,
 * `berror=1`, `notargets=1`, `role=editor`; the dialog itself reads `bvalidate=1` (Validate templates on) and
 * `bdiag=1` (the validation reports problems).
 */
@Component({
  selector: 'sf-sample-build-dialog',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfCheckboxComponent,
    SfComboboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfIconComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfTextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-build-dialog.component.html',
  styleUrl: './sample-build-dialog.component.scss',
})
export class SampleBuildDialogComponent {
  readonly closed = output<void>();

  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly query = injectSampleQuery();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  protected readonly channelList = BUILD_CHANNELS;
  protected readonly channels = signal<readonly BuildChannel[]>(BUILD_CHANNELS);
  protected readonly comment = signal('');
  protected readonly target = signal<string | null>(DEFAULT_TARGET.id);
  protected readonly mode = signal<RunMode | null>('incremental');
  protected readonly scope = signal<string[]>([]);
  protected readonly validate = signal(this.query.get('bvalidate') === '1');

  /** The plan: `none` before the first preview, `loading` while it is computed, `ready` once shown. */
  protected readonly planState = signal<'none' | 'loading' | 'ready'>('none');
  /** The plan shown, with the form values it was computed for; a different form key later means it is stale. */
  protected readonly shown = signal<{ readonly preview: BuildPreview; readonly key: string } | null>(null);
  protected readonly showAssets = signal(false);
  protected readonly showRedirects = signal(false);
  protected readonly submitting = signal(false);
  protected readonly startError = signal(false);

  /** An editor starts incremental builds of the default target only. */
  protected readonly limited = computed(() => this.state.role() === 'editor');
  protected readonly noTargets = this.state.noTargets;
  protected readonly effectiveMode = computed<RunMode>(() => (this.limited() ? 'incremental' : (this.mode() ?? 'incremental')));

  protected readonly targetOptions = computed<SfSelectOption<string>[]>(() =>
    TARGETS.map((t) => ({ value: t.id, label: t.isDefault ? this.t('build.defaultTarget', { name: t.name }) : t.name })),
  );
  protected readonly modeOptions = computed<SfSegmentedOption<RunMode>[]>(() => [
    { value: 'incremental', label: this.t('mode.incremental'), icon: 'bolt' },
    { value: 'full', label: this.t('mode.full'), icon: 'all_inclusive' },
  ]);
  protected readonly scopeOptions = computed<SfComboboxOption<string>[]>(() =>
    PAGES.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.path,
      group: p.folder ? this.t('build.folders') : this.t('build.pages'),
    })).sort((a, b) => a.group.localeCompare(b.group)),
  );

  protected readonly stale = computed(() => {
    const shown = this.shown();
    return this.planState() === 'ready' && !!shown && shown.key !== this.formKey();
  });
  protected readonly diagnostics = computed(() => (this.query.get('bdiag') === '1' ? BUILD_DIAGNOSTICS : []));
  protected readonly planShown = computed(() => this.planState() !== 'none');
  protected readonly previewLabel = computed(() =>
    this.planState() === 'loading' ? this.t('build.planning') : this.planState() === 'ready' ? this.t('build.refresh') : this.t('build.previewPlan'),
  );
  protected readonly canStart = computed(() => !this.noTargets() && !!this.target() && !this.submitting());
  protected readonly defaultName = DEFAULT_TARGET.name;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((id) => clearTimeout(id)));
    if (this.state.buildPlan()) {
      this.computePlan();
    }
  }

  private formKey(): string {
    return JSON.stringify([this.target(), this.effectiveMode(), this.scope(), this.channels(), this.validate()]);
  }

  private computePlan(): void {
    const preview = previewFor(this.effectiveMode(), this.scope(), { fallback: this.state.buildFallback(), empty: this.state.buildEmpty() });
    this.shown.set({ preview, key: this.formKey() });
    this.planState.set('ready');
  }

  protected channelOn(channel: BuildChannel): boolean {
    return this.channels().includes(channel);
  }

  /** The only channel left stays checked and disabled, so a build always has an output. */
  protected channelLocked(channel: BuildChannel): boolean {
    return this.channels().length === 1 && this.channelOn(channel);
  }

  protected setChannel(channel: BuildChannel, on: boolean): void {
    this.channels.update((list) => this.channelList.filter((c) => (c === channel ? on : list.includes(c))));
  }

  protected setScope(value: unknown): void {
    this.scope.set(Array.isArray(value) ? (value as string[]) : []);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      this.previewPlan();
    }
  }

  protected previewPlan(): void {
    if (this.planState() === 'loading') {
      return;
    }
    this.planState.set('loading');
    this.later(() => this.computePlan());
  }

  protected start(): void {
    this.startError.set(false);
    this.submitting.set(true);
    this.later(() => {
      this.submitting.set(false);
      if (this.state.buildError()) {
        this.startError.set(true);
        return;
      }
      this.state.notice('build.notStarted');
      this.closed.emit();
    });
  }

  private later(action: () => void): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      action();
    }, DEMO_DELAY);
    this.timers.add(id);
  }
}
