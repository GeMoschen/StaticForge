import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { SfCheckboxComponent } from '../../shared/components/forms/sf-checkbox.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
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
  imports: [SfButtonComponent, SfCheckboxComponent, TranslocoPipe],
  templateUrl: './redirect-option.component.html',
  styleUrl: './redirect-option.component.scss',
})
export class RedirectOptionComponent {
  private readonly api = inject(ApiClient);
  private readonly channelsApi = inject(ChannelsService);
  private readonly transloco = inject(TranslocoService);

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

  protected toggle(wanted: boolean): void {
    this.intent.update((intent) => ({ ...intent, wanted }));
  }

  /** The page the user picked; a page that goes offline itself is refused. */
  choose(picked: AssetPicked): void {
    if (this.sources().some((source) => source.uuid === picked.uuid)) {
      this.pickError.set(this.transloco.translate('release.redirect.offlineItself', { name: picked.label }));
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
        page: hit?.uuid ? { uuid: hit.uuid, name: hit.displayName || hit.uid || this.transloco.translate('release.redirect.untitled') } : null,
      }));
    });
  }
}
