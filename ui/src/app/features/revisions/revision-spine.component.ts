import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionView = components['schemas']['RevisionView'];

const MAX_TICKS = 40;

@Component({
  selector: 'sf-revision-spine',
  standalone: true,
  imports: [SfRelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revision-spine.component.html',
  styleUrl: './revision-spine.component.scss',
})
export class RevisionSpineComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);

  readonly projectKey = input<string | null>();
  readonly revisions = input<RevisionView[]>([]);
  readonly currentRevision = input<number | null>(null);
  readonly tickSelected = output<number>();

  protected readonly pulseRevision = signal<number | null>(null);

  private readonly members = signal<Record<number, string>>({});
  private membersLoadedFor = '';
  private prevMaxRevision = 0;
  private prevKey = '';
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (rev.comment) {
      return rev.comment;
    }
    return rev.changeType ?? '';
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
