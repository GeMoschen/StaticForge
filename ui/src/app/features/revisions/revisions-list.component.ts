import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { RevisionsService } from './revisions.service';

type RevisionView = components['schemas']['RevisionView'];
type ProjectMemberView = components['schemas']['ProjectMemberView'];

const ITEM_HEIGHT = 64;
const OVERSCAN = 8;

@Component({
  selector: 'sf-revisions-list',
  standalone: true,
  imports: [RouterLink, SfRelativeTimePipe, SfEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revisions-list.component.html',
  styleUrl: './revisions-list.component.scss',
})
export class RevisionsListComponent {
  private readonly service = inject(RevisionsService);
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);

  readonly projectKey = input.required<string>();

  protected readonly ITEM_HEIGHT = ITEM_HEIGHT;

  protected readonly revisions = this.service.revisions;
  protected readonly loading = this.service.loading;

  protected readonly members = signal<ProjectMemberView[]>([]);
  protected readonly userId = signal<number | null>(null);
  protected readonly assetUuid = signal<string | null>(null);
  protected readonly changeType = signal<string | null>(null);

  protected readonly scrollTop = signal(0);
  protected readonly viewportHeight = signal(0);

  private assetTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly changeTypes = computed<string[]>(() => {
    const set = new Set<string>();
    for (const rev of this.revisions()) {
      if (rev.changeType) {
        set.add(rev.changeType);
      }
    }
    return Array.from(set).sort();
  });

  protected readonly totalHeight = computed(
    () => this.revisions().length * ITEM_HEIGHT,
  );
  protected readonly startIndex = computed(() =>
    Math.max(0, Math.floor(this.scrollTop() / ITEM_HEIGHT) - OVERSCAN),
  );
  protected readonly endIndex = computed(() =>
    Math.min(
      this.revisions().length,
      Math.ceil((this.scrollTop() + this.viewportHeight()) / ITEM_HEIGHT) + OVERSCAN,
    ),
  );
  protected readonly slice = computed(() =>
    this.revisions().slice(this.startIndex(), this.endIndex()),
  );
  protected readonly offset = computed(() => this.startIndex() * ITEM_HEIGHT);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.api.listMembers(key).subscribe({
        next: (list) => this.members.set(list ?? []),
      });
      this.service.load(key);
    });
  }

  ngOnInit(): void {
    void this.projectKey();
  }

  protected onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.scrollTop.set(el.scrollTop);
    this.viewportHeight.set(el.clientHeight);
  }

  protected onUserChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.userId.set(value === '' ? null : Number(value));
    this.service.setFilter({ userId: this.userId() ?? undefined });
  }

  protected onAssetInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.assetUuid.set(value === '' ? null : value);
    if (this.assetTimer) {
      clearTimeout(this.assetTimer);
    }
    this.assetTimer = setTimeout(() => {
      this.service.setFilter({ assetUuid: this.assetUuid() ?? undefined });
    }, 300);
  }

  protected onTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.changeType.set(value === '' ? null : value);
    this.service.setFilter({ changeType: this.changeType() ?? undefined });
  }

  protected isOwn(rev: RevisionView): boolean {
    const me = this.auth.userId();
    return me != null && rev.createdBy === me;
  }

  protected nameFor(rev: RevisionView): string {
    if (this.isOwn(rev)) {
      return 'you';
    }
    const member = this.members().find((m) => m.userId === rev.createdBy);
    return member?.displayName ?? member?.username ?? String(rev.createdBy ?? 'unknown');
  }

  protected summaryFor(rev: RevisionView): string {
    return rev.comment ?? rev.changeType ?? '';
  }
}
