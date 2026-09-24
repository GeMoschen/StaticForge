import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { SfIconComponent } from '../../shared/components/sf-icon.component';

/** Up to two initials of a display name or username ("Ada Lovelace" → "AL", "admin" → "A"). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/[\s._@-]+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return '?';
  }
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The signed-in user's menu (M26): who is signed in, My account, Administration for instance admins, Sign out.
 * Sits in the dashboard header and at the bottom of the project nav rail (`compact` shows the initials only). The
 * panel is `position: fixed`, so the rail's `overflow: hidden` can't clip it.
 */
@Component({
  selector: 'sf-user-menu',
  standalone: true,
  imports: [RouterLink, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
})
export class UserMenuComponent {
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Initials only (the collapsed nav rail). */
  readonly compact = input(false);
  /** `below` opens under the trigger, aligned right (a header); `beside` opens to its right, bottom-aligned (a rail). */
  readonly placement = input<'below' | 'beside'>('below');

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);
  protected readonly position = signal<Record<string, string>>({});

  protected readonly displayName = computed(() => this.auth.displayName() ?? this.auth.username() ?? '');
  protected readonly username = this.auth.username;
  protected readonly initials = computed(() => initialsOf(this.displayName()));
  protected readonly isInstanceAdmin = this.auth.isInstanceAdmin;

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.position.set(
      this.placement() === 'beside'
        ? { left: `${rect.right + 8}px`, bottom: `${Math.max(8, window.innerHeight - rect.bottom)}px` }
        : { top: `${rect.bottom + 4}px`, right: `${Math.max(8, window.innerWidth - rect.right)}px` },
    );
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected signOut(): void {
    this.close();
    this.session.signOut();
  }

  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.close();
      this.trigger().nativeElement.focus();
    }
  }
}
