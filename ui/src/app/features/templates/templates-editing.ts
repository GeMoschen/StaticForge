import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, map, of, Subject, switchMap } from 'rxjs';
import { ToastService } from '../../core/ui/toast.service';
import { cdlFields, type CdlSection, type CdlSections } from '../../shared/code-editor/cdl-sections';
import { sortDiagnostics } from './inheritance.util';
import { TemplatesService, type Diagnostic } from './templates.service';
import { TemplatesStore } from './templates.store';

/** How long channel typing pauses before the source is validated against the template's context (M20.4.1). */
const OCTL_VALIDATE_DEBOUNCE_MS = 300;
/** How long after the last keystroke the CDL is validated live (M33). */
const CDL_VALIDATE_DEBOUNCE_MS = 500;

interface OctlValidation {
  key: string;
  templateUuid: string;
  channelKey: string;
  source: string;
  sections: CdlSections;
}

/**
 * Editing the CDL sections and the channel sources, with their live validation: the edits go into `TemplatesStore`,
 * nothing is written until the one Save (`TemplatesSaveCoordinator`).
 */
@Injectable()
export class TemplatesEditing {
  private readonly store = inject(TemplatesStore);
  private readonly service = inject(TemplatesService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly octlValidation = new Subject<OctlValidation>();
  private readonly cdlValidation = new Subject<{ key: string; sections: CdlSections; section: boolean }>();

  constructor() {
    // Live OCTL diagnostics: debounced, and a newer keystroke cancels the request still in flight.
    this.octlValidation
      .pipe(
        debounceTime(OCTL_VALIDATE_DEBOUNCE_MS),
        switchMap((request) =>
          this.service
            .validateOctl(request.key, {
              source: request.source,
              channelKey: request.channelKey,
              templateUuid: request.templateUuid,
              ...cdlFields(request.sections),
            })
            .pipe(
              catchError(() => of(null)),
              map((response) => ({ channelKey: request.channelKey, response })),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ channelKey, response }) => {
        if (response) {
          this.store.octlDiagnostics.update((all) => ({
            ...all,
            [channelKey]: sortDiagnostics(response.diagnostics ?? []) as Diagnostic[],
          }));
        }
      });

    this.cdlValidation
      .pipe(
        debounceTime(CDL_VALIDATE_DEBOUNCE_MS),
        switchMap((request) =>
          this.service
            .validateCdl(request.key, request.sections, request.section ? 'SECTION_TEMPLATE' : undefined)
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        if (response) {
          this.store.cdlDiagnostics.set(sortDiagnostics(response.diagnostics ?? []) as Diagnostic[]);
        }
      });
  }

  onSectionInput(change: { section: CdlSection; value: string }): void {
    this.store.sections.update((sections) => ({ ...sections, [change.section]: change.value }));
    // Unsaved editors change what the channel may use.
    this.requestOctlValidation();
    this.requestCdlValidation();
  }

  /** Live CDL diagnostics (M33): debounced, silent (the Validate button still reports with a toast). */
  private requestCdlValidation(): void {
    const key = this.store.projectKey();
    if (key) {
      this.cdlValidation.next({ key, sections: this.store.sections(), section: this.store.isSection() });
    }
  }

  /** Queues a context-aware validation of the selected channel's current (unsaved) source. */
  requestOctlValidation(): void {
    const key = this.store.projectKey();
    const uuid = this.store.selectedUuid();
    const channelKey = this.store.selectedChannel();
    if (!key || !uuid || !channelKey || this.store.datasetSelected()) {
      return;
    }
    this.octlValidation.next({
      key,
      templateUuid: uuid,
      channelKey,
      source: this.store.channelSource(),
      sections: this.store.sections(),
    });
  }

  /** The Validate button: validates now and reports with a toast. */
  validateCdl(): void {
    const key = this.store.projectKey();
    if (!key) {
      return;
    }
    this.service.validateCdl(key, this.store.sections(), this.store.isSection() ? 'SECTION_TEMPLATE' : undefined).subscribe({
      next: (res) => {
        this.store.cdlDiagnostics.set(sortDiagnostics(res.diagnostics ?? []) as Diagnostic[]);
        this.toast.show(
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'CDL has errors'
            : 'CDL is valid',
          (res.diagnostics ?? []).some((d) => d.severity === 'ERROR')
            ? 'error'
            : 'success',
        );
      },
      error: () => this.toast.show('Could not validate CDL — check your connection and try again.', 'error'),
    });
  }

  selectChannel(channelKey: string): void {
    this.store.selectedChannel.set(channelKey);
    this.requestOctlValidation();
  }

  onChannelInput(source: string, channel = this.store.selectedChannel()): void {
    if (!channel) {
      return;
    }
    this.store.channelSources.update((sources) => ({ ...sources, [channel]: source }));
    this.requestOctlValidation();
  }

  /** Adds a channel with an empty source; it is written with the next Save (M34). */
  addChannel(channelKey: string): void {
    if (!channelKey || this.store.readOnly() || channelKey in this.store.channelSources()) {
      return;
    }
    this.store.channelSources.update((sources) => ({
      ...sources,
      [channelKey]: this.store.savedChannelSources()[channelKey] ?? '',
    }));
    this.selectChannel(channelKey);
  }

  /** Removes a channel (default: the selected one); the next Save deletes it (M34), until then it can be restored. */
  removeChannel(channel = this.store.selectedChannel()): void {
    if (!channel || this.store.readOnly() || !(channel in this.store.channelSources())) {
      return;
    }
    const wasSelected = channel === this.store.selectedChannel();
    this.store.channelSources.update((sources) => {
      const { [channel]: _removed, ...rest } = sources;
      return rest;
    });
    this.store.octlDiagnostics.update((all) => {
      const { [channel]: _dropped, ...rest } = all;
      return rest;
    });
    if (wasSelected) {
      const next = this.store.channelKeys()[0] ?? '';
      this.store.selectedChannel.set(next);
      if (next) {
        this.requestOctlValidation();
      }
    }
  }

  /** Brings back a channel removed since the last save, with its saved source. */
  restoreChannel(channelKey: string): void {
    this.addChannel(channelKey);
  }
}
