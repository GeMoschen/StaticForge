import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toast, ToastService } from './toast.service';

/**
 * Renders the {@link ToastService} queue in a corner of the app: a polite live region for news, an assertive one for
 * errors. Each toast can be dismissed; one with an action offers its button (M28.3.3's "Build now").
 */
@Component({
  selector: 'sf-toast-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (toast of polite(); track toast.id) {
        <ng-container *ngTemplateOutlet="item; context: { $implicit: toast }" />
      }
    </div>
    <div class="toasts toasts--errors" role="alert" aria-live="assertive">
      @for (toast of assertive(); track toast.id) {
        <ng-container *ngTemplateOutlet="item; context: { $implicit: toast }" />
      }
    </div>
    <ng-template #item let-toast>
      <div class="toast" [class]="'toast toast--' + toast.kind" [attr.data-kind]="toast.kind">
        <span class="toast__message">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button type="button" class="toast__action" (click)="run(toast)">{{ action.label }}</button>
        }
        <button type="button" class="toast__close" aria-label="Dismiss" (click)="service.dismiss(toast.id)">×</button>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      position: fixed;
      right: var(--sf-4);
      bottom: var(--sf-4);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: var(--sf-2);
      max-width: min(28rem, calc(100vw - 2 * var(--sf-4)));
      pointer-events: none;
    }
    .toasts {
      display: flex;
      flex-direction: column;
      gap: var(--sf-2);
    }
    .toast {
      display: flex;
      align-items: center;
      gap: var(--sf-2);
      padding: var(--sf-2) var(--sf-3);
      border: 1px solid var(--sf-line);
      border-left-width: 4px;
      border-radius: var(--sf-radius-md);
      background: var(--sf-surface);
      color: var(--sf-ink);
      font-size: var(--sf-text-sm);
      box-shadow: 0 4px 16px color-mix(in srgb, var(--sf-ink) 12%, transparent);
      pointer-events: auto;
    }
    .toast--success {
      border-left-color: var(--sf-jade);
    }
    .toast--info {
      border-left-color: var(--sf-signal);
    }
    .toast--warning {
      border-left-color: var(--sf-amber);
    }
    .toast--error {
      border-left-color: var(--sf-rust);
    }
    .toast__message {
      flex: 1;
      min-width: 0;
    }
    .toast__action {
      padding: var(--sf-1) var(--sf-2);
      border: 1px solid var(--sf-signal);
      border-radius: var(--sf-radius-md);
      background: var(--sf-signal);
      color: var(--sf-surface);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .toast__close {
      border: none;
      background: none;
      color: var(--sf-slate);
      font-size: var(--sf-text-md, 1rem);
      line-height: 1;
      cursor: pointer;
    }
  `,
})
export class ToastHostComponent {
  protected readonly service = inject(ToastService);

  protected polite(): Toast[] {
    return this.service.toasts().filter((t) => t.kind !== 'error');
  }

  protected assertive(): Toast[] {
    return this.service.toasts().filter((t) => t.kind === 'error');
  }

  protected run(toast: Toast): void {
    this.service.dismiss(toast.id);
    toast.action?.run();
  }
}
