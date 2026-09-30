import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** One tab: `errors` shows a count badge, `dirty` an unsaved dot, `note` a muted word such as "disabled". */
export interface SfTab {
  id: string;
  label: string;
  errors?: number;
  dirty?: boolean;
  note?: string;
}

let nextId = 0;

/**
 * A tab strip (M34): `role="tablist"` with a roving `tabindex` — Tab enters the selected tab, the arrow keys, Home
 * and End move between tabs and select them. The host renders the panel; {@link panelId} names it for
 * `aria-controls`, and {@link tabId} labels it (`aria-labelledby`).
 */
@Component({
  selector: 'sf-tabs',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sf-tabs" role="tablist" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          role="tab"
          class="sf-tabs__tab"
          [id]="tabId(tab.id)"
          [class.sf-tabs__tab--active]="tab.id === selected()"
          [attr.aria-selected]="tab.id === selected()"
          [attr.aria-controls]="panelId(tab.id)"
          [attr.tabindex]="tab.id === selected() ? 0 : -1"
          (click)="selectTab.emit(tab.id)"
          (keydown)="onKeydown($event, tab.id)"
        >
          {{ tab.label }}
          @if (tab.note) {
            <span class="sf-tabs__note">{{ tab.note }}</span>
          }
          @if (tab.errors) {
            <span class="sf-tabs__errors">{{ tab.errors }}<span class="sf-sr-only"> {{ 'shared.tabs.errors' | transloco: { count: tab.errors } }}</span></span>
          }
          @if (tab.dirty) {
            <span class="sf-tabs__dirty" aria-hidden="true">•</span><span class="sf-sr-only"> {{ 'shared.tabs.unsaved' | transloco }}</span>
          }
        </button>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .sf-tabs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sf-1);
      border-bottom: 1px solid var(--sf-line);
    }
    .sf-tabs__tab {
      display: inline-flex;
      align-items: center;
      gap: var(--sf-1);
      padding: var(--sf-2);
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--sf-slate);
      font-size: var(--sf-text-sm);
      cursor: pointer;
    }
    .sf-tabs__tab:hover {
      color: var(--sf-ink);
    }
    .sf-tabs__tab--active {
      color: var(--sf-ink);
      border-bottom-color: var(--sf-signal);
    }
    .sf-tabs__note {
      color: var(--sf-slate);
      font-size: var(--sf-text-xs);
    }
    .sf-tabs__errors {
      min-width: 1.25rem;
      padding: 0 var(--sf-1);
      border-radius: 999px;
      background: color-mix(in srgb, var(--sf-rust) 14%, transparent);
      color: var(--sf-rust);
      font-size: var(--sf-text-xs);
      text-align: center;
    }
    .sf-tabs__dirty {
      color: var(--sf-signal);
      font-weight: 700;
    }
  `,
})
export class SfTabsComponent {
  readonly tabs = input.required<readonly SfTab[]>();
  readonly selected = input.required<string>();
  /** The tab list's accessible name. */
  readonly label = input.required<string>();
  /** The prefix of the tab and panel ids, when the host renders its panels with ids of its own. */
  readonly idPrefix = input<string | null>(null);

  readonly selectTab = output<string>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly ownPrefix = `sf-tabs-${nextId++}`;

  tabId(id: string): string {
    return tabIdOf(this.idPrefix() ?? this.ownPrefix, id);
  }

  panelId(id: string): string {
    return panelIdOf(this.idPrefix() ?? this.ownPrefix, id);
  }

  protected onKeydown(event: KeyboardEvent, id: string): void {
    const ids = this.tabs().map((tab) => tab.id);
    const index = ids.indexOf(id);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % ids.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectTab.emit(ids[next]);
    const target = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${CSS.escape(this.tabId(ids[next]))}`);
    target?.focus();
  }
}

/** The id of tab `id` under `prefix`. */
export function tabIdOf(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** The id of the panel of tab `id` under `prefix`. */
export function panelIdOf(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}
