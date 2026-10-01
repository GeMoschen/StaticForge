import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { I18nFormatService } from '../../../core/i18n/i18n-format.service';

export type SfAvatarSize = 'sm' | 'md' | 'lg';

/** How many colour pairs `sf-avatar.component.scss` defines (`.sf-avatar--tone-N`). */
const TONE_COUNT = 4;

/** Up to two initials: the first letters of the first and the last word, upper case. */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toLocaleUpperCase();
}

/** A stable colour index for a name, so a person keeps their colour everywhere. */
function toneOf(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % TONE_COUNT;
}

/**
 * A user avatar (M35.6): the initials of `name` on a colour picked from the name, or the `src` image (falling back to
 * the initials when it fails to load).
 *
 * - `size`: `sm | md | lg`.
 * - Named by default: `role=img` with the name as `aria-label` (an image gets the name as `alt`); "Unknown user" without
 *   a name. Set `decorative` when the name is written next to it, so it isn't read twice.
 */
@Component({
  selector: 'sf-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showImage()) {
      <img class="sf-avatar__image" [src]="src()" [alt]="decorative() ? '' : accessibleName()" (error)="onError()" />
    } @else {
      <span class="sf-avatar__initials" aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styleUrl: './sf-avatar.component.scss',
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'decorative() || showImage() ? null : "img"',
    '[attr.aria-label]': 'decorative() || showImage() ? null : accessibleName()',
    '[attr.aria-hidden]': 'decorative() || null',
  },
})
export class SfAvatarComponent {
  readonly name = input<string | null>(null);
  readonly src = input<string | null>(null);
  readonly size = input<SfAvatarSize>('md');
  /** Hidden from assistive tech: the name is already shown beside the avatar. */
  readonly decorative = input(false, { transform: booleanAttribute });

  private readonly format = inject(I18nFormatService);
  /** The `src` that failed to load; a new `src` gets a fresh try. */
  private readonly failedSrc = signal<string | null>(null);

  protected readonly showImage = computed(() => !!this.src() && this.src() !== this.failedSrc());
  protected readonly initials = computed(() => avatarInitials(this.name()));
  protected readonly accessibleName = computed(() => {
    this.format.lang();
    return this.name()?.trim() || this.format.translate('shared.avatar.unknown');
  });
  protected readonly classes = computed(
    () => `sf-avatar sf-avatar--${this.size()} sf-avatar--tone-${toneOf(this.name()?.trim() ?? '')}`,
  );

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
