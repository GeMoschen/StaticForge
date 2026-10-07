import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfCheckboxComponent } from '../../shared/components/forms/sf-checkbox.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, type SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { ChannelsService } from '../channels/channels.service';
import { GenerationService } from './generation.service';

type GenerationTargetView = components['schemas']['GenerationTargetView'];

/**
 * Mode, target and channels of a build that doesn't start now (M27.6.5): a generation schedule and a scheduled
 * release's "then generate". The same choices as the generation dialog; `channels` empty means every enabled channel
 * (what the server does with an empty list), so a channel enabled later is included too.
 */
@Component({
  selector: 'sf-generation-options',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfCheckboxComponent, SfFieldComponent, SfSegmentedComponent, SfSelectComponent, TranslocoPipe],
  template: `
    <div class="options">
      @if (showMode() || (targets().length > 0 && anyTarget())) {
        <div class="options__row">
          @if (targets().length > 0 && anyTarget()) {
            <sf-field [label]="'release.generationOptions.target' | transloco">
              <sf-select [options]="targetOptions()" [value]="targetId()" (valueChange)="targetId.set($event)" required />
            </sf-field>
          }
          @if (showMode()) {
            <sf-field [label]="'release.generationOptions.mode' | transloco">
              <sf-segmented size="sm" [options]="modeOptions()" [value]="mode()" (valueChange)="mode.set($event ?? 'FULL')" />
            </sf-field>
          }
        </div>
      }
      @if (targets().length === 0) {
        <p class="options__note">{{ 'release.generationOptions.noTargets' | transloco }}</p>
      } @else if (!anyTarget()) {
        <p class="options__note">{{ 'release.generationOptions.defaultOnly' | transloco }}</p>
      }
      @if (channelOptions().length > 0) {
        <sf-field [label]="'release.generationOptions.channels' | transloco">
          <div class="options__channels">
            @for (channel of channelOptions(); track channel) {
              <sf-checkbox [value]="isChecked(channel)" [disabled]="isOnlyChannel(channel)" (valueChange)="toggleChannel(channel, $event)">{{ channel }}</sf-checkbox>
            }
          </div>
        </sf-field>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: var(--sf-space-3);
      }
      .options__row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: var(--sf-space-3);
      }
      .options__channels {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sf-space-2) var(--sf-space-4);
      }
      .options__note {
        margin: 0;
        color: var(--sf-text-muted);
        font-size: var(--sf-fs-12);
        line-height: var(--sf-lh-12);
      }
    `,
  ],
})
export class GenerationOptionsComponent {
  private readonly generation = inject(GenerationService);
  private readonly channelsApi = inject(ChannelsService);
  private readonly transloco = inject(TranslocoService);

  readonly projectKey = input.required<string>();
  readonly showMode = input(true);
  /** Whether any target may be chosen (M28: `FULL_BUILD`); otherwise the build goes to the default target, shown. */
  readonly anyTarget = input(true);
  readonly mode = model<'FULL' | 'INCREMENTAL'>('FULL');
  readonly targetId = model<number | null>(null);
  readonly channels = model<string[]>([]);

  protected readonly targets = signal<GenerationTargetView[]>([]);
  protected readonly channelOptions = signal<string[]>([]);
  protected readonly modeOptions = computed<SfSegmentedOption<'FULL' | 'INCREMENTAL'>[]>(() => [
    { value: 'FULL', label: this.transloco.translate('release.generationOptions.full') },
    { value: 'INCREMENTAL', label: this.transloco.translate('release.generationOptions.incremental') },
  ]);
  /** "Default target" first (no target id: the server's default output), then the project's targets. */
  protected readonly targetOptions = computed<SfSelectOption<number | null>[]>(() => [
    { value: null, label: this.transloco.translate('release.generationOptions.defaultTarget') },
    ...this.targets().map((target) => ({
      value: target.id ?? null,
      label: target.name || this.transloco.translate('release.generationOptions.untitled') || '',
    })),
  ]);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  protected isChecked(channel: string): boolean {
    const chosen = this.channels();
    return chosen.length === 0 || chosen.includes(channel);
  }

  /** The last ticked channel can't be unticked: no channel at all isn't a build (an empty list means "every channel"). */
  protected isOnlyChannel(channel: string): boolean {
    const chosen = this.channels().length === 0 ? this.channelOptions() : this.channels();
    return chosen.length === 1 && chosen[0] === channel;
  }

  protected toggleChannel(channel: string, checked: boolean): void {
    const all = this.channelOptions();
    const current = this.channels().length === 0 ? all : this.channels();
    if (!checked && current.length <= 1) {
      return;
    }
    const next = checked ? [...new Set([...current, channel])] : current.filter((c) => c !== channel);
    // Every channel ticked is "all channels" — including ones enabled later.
    this.channels.set(all.every((c) => next.includes(c)) ? [] : all.filter((c) => next.includes(c)));
  }

  private load(projectKey: string): void {
    if (!projectKey) {
      return;
    }
    this.generation.listTargets(projectKey).subscribe({
      next: (targets) => this.targets.set(targets ?? []),
      error: () => this.targets.set([]),
    });
    this.channelsApi.list(projectKey).subscribe({
      next: (list) => this.channelOptions.set((list ?? []).filter((c) => c.enabled && c.key).map((c) => c.key as string)),
      error: () => this.channelOptions.set([]),
    });
  }
}
