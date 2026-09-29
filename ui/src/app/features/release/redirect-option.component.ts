import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { ChannelsService } from '../channels/channels.service';
import { indexUidOf } from '../settings/redirect.util';
import { type RedirectIntent, type RedirectSource, NO_REDIRECT, commonIndexPage } from './redirect-option.util';

/**
 * "Redirect old URL to…" in the unpublish and delete dialogs of a page (M30.6.3): opt-in, with the shared page picker
 * preselected with the index page of the nearest folder above that is online (or nothing). The host dialog reads the
 * `intent` and, after its own action succeeded, hands it to `RedirectAfterService`.
 *
 * The host renders the page picker (on `pickRequested`) as a sibling of its dialog panel — a fixed-position picker
 * nested in the transformed `.dialog` would be positioned against it (`design/_dialog-shell.scss`) — and passes the
 * result to {@link choose}.
 */
@Component({
  selector: 'sf-redirect-option',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="option">
      <label class="option__toggle">
        <input type="checkbox" [checked]="intent().wanted" (change)="toggle($event)" />
        <span>{{ sources().length > 1 ? 'Redirect the old URLs to…' : 'Redirect old URL to…' }}</span>
      </label>
      @if (intent().wanted) {
        <div class="option__target">
          @if (loading()) {
            <span class="option__muted">Looking for the nearest folder page…</span>
          } @else {
            <span class="option__page" [class.option__muted]="!intent().page">
              {{ intent().page?.name ?? 'No page chosen' }}
            </span>
          }
          <button type="button" class="option__pick" (click)="pickRequested.emit()">
            {{ intent().page ? 'Change page…' : 'Choose page…' }}
          </button>
        </div>
        @if (pickError(); as message) {
          <p class="option__error" role="alert">{{ message }}</p>
        }
        <p class="option__hint">
          Requests for the page’s current URLs are sent to this page once a build no longer contains
          {{ sources().length > 1 ? 'them' : 'it' }}.
        </p>
      }
    </div>
  `,
  styles: `
    .option {
      display: flex;
      flex-direction: column;
      gap: var(--sf-1);
      padding: var(--sf-2) var(--sf-3);
      border: 1px solid var(--sf-line);
      border-radius: var(--sf-radius-md);
    }
    .option__toggle {
      display: flex;
      align-items: center;
      gap: var(--sf-2);
      font-size: var(--sf-text-sm);
      color: var(--sf-ink);
      cursor: pointer;
    }
    .option__target {
      display: flex;
      align-items: center;
      gap: var(--sf-2);
      min-width: 0;
      padding-left: var(--sf-4);
    }
    .option__page {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--sf-text-sm);
      color: var(--sf-ink);
    }
    .option__pick {
      padding: 2px var(--sf-2);
      border: 1px solid var(--sf-line);
      border-radius: var(--sf-radius-md);
      background: var(--sf-surface);
      color: var(--sf-ink);
      font-size: var(--sf-text-xs);
      cursor: pointer;
    }
    .option__hint,
    .option__muted {
      margin: 0;
      font-size: var(--sf-text-xs);
      color: var(--sf-slate);
    }
    .option__hint,
    .option__error {
      padding-left: var(--sf-4);
    }
    .option__error {
      margin: 0;
      font-size: var(--sf-text-xs);
      color: var(--sf-rust);
    }
  `,
})
export class RedirectOptionComponent {
  private readonly api = inject(ApiClient);
  private readonly channelsApi = inject(ChannelsService);

  readonly projectKey = input.required<string>();
  /** The pages going offline. */
  readonly sources = input.required<RedirectSource[]>();
  readonly intent = model<RedirectIntent>(NO_REDIRECT);
  /** "Choose page…": the host opens the page picker and passes the result to {@link choose}. */
  readonly pickRequested = output<void>();

  protected readonly loading = signal(false);
  protected readonly pickError = signal<string | null>(null);
  /** Once the user picked, a late preselection must not overwrite the choice. */
  private picked = false;
  private readonly sourceKey = computed(() =>
    this.sources()
      .map((source) => `${source.uuid}@${source.folderPath ?? ''}`)
      .join(','),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      this.sourceKey();
      untracked(() => this.preselect(key));
    });
  }

  protected toggle(event: Event): void {
    const wanted = (event.target as HTMLInputElement).checked;
    this.intent.update((intent) => ({ ...intent, wanted }));
  }

  /** The page the user picked; a page that goes offline itself is refused. */
  choose(picked: AssetPicked): void {
    if (this.sources().some((source) => source.uuid === picked.uuid)) {
      this.pickError.set(`“${picked.label}” is going offline itself — choose another page.`);
      return;
    }
    this.pickError.set(null);
    this.picked = true;
    this.intent.update((intent) => ({ ...intent, page: { uuid: picked.uuid, name: picked.label } }));
  }

  private preselect(projectKey: string): void {
    const sources = this.sources();
    if (sources.length === 0) {
      return;
    }
    this.loading.set(true);
    forkJoin({
      pages: this.api.listPages(projectKey).pipe(catchError(() => of([]))),
      channels: this.channelsApi.list(projectKey).pipe(catchError(() => of([]))),
    }).subscribe(({ pages, channels }) => {
      this.loading.set(false);
      if (this.picked) {
        return;
      }
      const indexUids = new Set((channels.length > 0 ? channels : [null]).map((channel) => indexUidOf(channel)));
      const hit = commonIndexPage(sources, pages ?? [], indexUids);
      this.intent.update((intent) => ({
        ...intent,
        page: hit?.uuid ? { uuid: hit.uuid, name: hit.displayName || hit.uid || 'Untitled' } : null,
      }));
    });
  }
}
