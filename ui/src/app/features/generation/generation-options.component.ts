import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
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
  template: `
    <div class="options">
      @if (showMode()) {
        <fieldset class="options__group">
          <legend class="options__legend">Mode</legend>
          <label class="options__choice">
            <input type="radio" [name]="name() + '-mode'" value="FULL" [checked]="mode() === 'FULL'" (change)="mode.set('FULL')" />
            Full
          </label>
          <label class="options__choice">
            <input
              type="radio"
              [name]="name() + '-mode'"
              value="INCREMENTAL"
              [checked]="mode() === 'INCREMENTAL'"
              (change)="mode.set('INCREMENTAL')"
            />
            Incremental
          </label>
        </fieldset>
      }
      <label class="options__field">
        <span class="options__legend">Target</span>
        @if (targets().length === 0) {
          <span class="options__note">No generation target yet — the build uses the project's default output.</span>
        } @else if (!anyTarget()) {
          <span class="options__fixed">Default target</span>
        } @else {
          <select class="options__select" [value]="targetValue()" (change)="onTarget($event)">
            <option value="">Default target</option>
            @for (target of targets(); track target.id) {
              <option [value]="target.id">{{ target.name ?? 'Untitled' }}</option>
            }
          </select>
        }
      </label>
      @if (channelOptions().length > 0) {
        <fieldset class="options__group">
          <legend class="options__legend">Channels</legend>
          @for (channel of channelOptions(); track channel) {
            <label class="options__choice">
              <input type="checkbox" [checked]="isChecked(channel)" (change)="toggleChannel(channel, $event)" />
              {{ channel }}
            </label>
          }
        </fieldset>
      }
    </div>
  `,
  styles: [
    `
      .options {
        display: flex;
        flex-direction: column;
        gap: var(--sf-2);
      }
      .options__group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sf-3);
        margin: 0;
        padding: 0;
        border: none;
      }
      .options__legend {
        width: 100%;
        padding: 0;
        font-size: var(--sf-text-xs);
        font-weight: 600;
        color: var(--sf-slate);
      }
      .options__field {
        display: flex;
        flex-direction: column;
        gap: var(--sf-1);
      }
      .options__choice {
        display: inline-flex;
        align-items: center;
        gap: var(--sf-1);
        font-size: var(--sf-text-sm);
      }
      .options__select {
        padding: var(--sf-1) var(--sf-2);
        border: 1px solid var(--sf-line);
        border-radius: var(--sf-radius-md);
        background: var(--sf-surface);
        color: var(--sf-ink);
        font-size: var(--sf-text-sm);
      }
      .options__fixed {
        font-size: var(--sf-text-sm);
        color: var(--sf-ink);
      }
      .options__note {
        font-size: var(--sf-text-xs);
        color: var(--sf-slate);
      }
    `,
  ],
})
export class GenerationOptionsComponent {
  private readonly generation = inject(GenerationService);
  private readonly channelsApi = inject(ChannelsService);

  readonly projectKey = input.required<string>();
  readonly showMode = input(true);
  /** Whether any target may be chosen (M28: `FULL_BUILD`); otherwise the build goes to the default target, shown. */
  readonly anyTarget = input(true);
  /** Distinguishes the radio groups when two option blocks are on one page. */
  readonly name = input('generation');
  readonly mode = model<'FULL' | 'INCREMENTAL'>('FULL');
  readonly targetId = model<number | null>(null);
  readonly channels = model<string[]>([]);

  protected readonly targets = signal<GenerationTargetView[]>([]);
  protected readonly channelOptions = signal<string[]>([]);
  protected readonly targetValue = computed(() => (this.targetId() == null ? '' : String(this.targetId())));

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

  protected toggleChannel(channel: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const all = this.channelOptions();
    const current = this.channels().length === 0 ? all : this.channels();
    if (!checked && current.length <= 1) {
      // No channel at all isn't a build; an empty list would even mean "every channel".
      (event.target as HTMLInputElement).checked = true;
      return;
    }
    const next = checked ? [...new Set([...current, channel])] : current.filter((c) => c !== channel);
    // Every channel ticked is "all channels" — including ones enabled later.
    this.channels.set(all.every((c) => next.includes(c)) ? [] : all.filter((c) => next.includes(c)));
  }

  protected onTarget(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.targetId.set(value ? Number(value) : null);
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
