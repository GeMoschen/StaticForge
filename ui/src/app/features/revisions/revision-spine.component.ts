import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { revisionSummaryLabel } from '../../shared/revision-summary.util';
import type { components } from '../../core/api/generated/schema.d.ts';
import { COMPACTED_REVISION_HINT } from './compaction.util';

type RevisionView = components['schemas']['RevisionView'];

const MAX_TICKS = 40;
/** How often to re-poll the revision list so the spine reflects newly saved revisions. */
const POLL_MS = 5000;

@Component({
  selector: 'sf-revision-spine',
  standalone: true,
  imports: [SfRelativeTimePipe, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revision-spine.component.html',
  styleUrl: './revision-spine.component.scss',
})
export class RevisionSpineComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly store = inject(ProjectContextStore);

  readonly projectKey = input<string | null>();
  readonly revisions = input<RevisionView[]>([]);
  readonly currentRevision = input<number | null>(null);
  readonly tickSelected = output<number>();

  protected readonly pulseRevision = signal<number | null>(null);
  protected readonly compactedHint = COMPACTED_REVISION_HINT;

  private readonly members = signal<Record<number, string>>({});
  private membersLoadedFor = '';
  private prevMaxRevision = 0;
  private prevKey = '';
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly visibleRevisions = computed<RevisionView[]>(() => {
    const sorted = [...this.revisions()].filter((r) => r.revisionId != null);
    sorted.sort((a, b) => (b.revisionId ?? 0) - (a.revisionId ?? 0));
    return sorted.slice(0, MAX_TICKS);
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key || key === this.membersLoadedFor) {
        return;
      }
      this.membersLoadedFor = key;
      this.api.listMembers(key).subscribe({
        next: (list) => {
          const map: Record<number, string> = {};
          for (const member of list ?? []) {
            if (member.userId != null && member.displayName) {
              map[member.userId] = member.displayName;
            }
          }
          this.members.set(map);
        },
      });
    });

    effect(
      () => {
        const key = this.projectKey() ?? '';
        if (key !== this.prevKey) {
          this.prevKey = key;
          this.prevMaxRevision = 0;
        }
        const revs = this.revisions();
        const max = revs.reduce(
          (acc, r) => Math.max(acc, r.revisionId ?? 0),
          0,
        );
        if (max <= this.prevMaxRevision) {
          return;
        }
        const newest = revs.find((r) => r.revisionId === max);
        if (
          this.prevMaxRevision !== 0 &&
          newest &&
          newest.createdBy !== this.auth.userId()
        ) {
          this.pulse(max);
        }
        this.prevMaxRevision = max;
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      const key = this.projectKey();
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (!key) {
        return;
      }
      this.pollTimer = setInterval(() => {
        this.store.refreshRevision(key);
      }, POLL_MS);
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  protected isOwn(rev: RevisionView): boolean {
    const me = this.auth.userId();
    return me != null && rev.createdBy === me;
  }

  protected nameFor(rev: RevisionView): string {
    if (this.isOwn(rev)) {
      return 'you';
    }
    return this.members()[rev.createdBy ?? -1] ?? String(rev.createdBy ?? 'unknown');
  }

  protected summaryFor(rev: RevisionView): string {
    return revisionSummaryLabel(rev);
  }

  protected onTick(rev: RevisionView): void {
    if (rev.revisionId != null) {
      this.tickSelected.emit(rev.revisionId);
    }
  }

  private pulse(revision: number): void {
    this.pulseRevision.set(revision);
    if (this.pulseTimer) {
      clearTimeout(this.pulseTimer);
    }
    this.pulseTimer = setTimeout(() => this.pulseRevision.set(null), 200);
  }
}
