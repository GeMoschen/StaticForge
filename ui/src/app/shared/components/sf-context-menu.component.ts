import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  viewChild,
} from '@angular/core';
import { ContextMenuService } from '../services/context-menu.service';
import { SfIconComponent } from './sf-icon.component';

/**
 * Single floating context-menu, mounted once in `app.component.html`.
 * Renders whatever `ContextMenuService.state` currently holds; closes on
 * outside click, Escape, or after an item's action runs.
 */
@Component({
  selector: 'sf-context-menu',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-context-menu.component.html',
  styleUrl: './sf-context-menu.component.scss',
})
export class SfContextMenuComponent {
  protected readonly menu = inject(ContextMenuService);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.menu.state()) {
      return;
    }
    const el = this.panel()?.nativeElement;
    if (el && !el.contains(event.target as Node)) {
      this.menu.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menu.close();
  }

  @HostListener('window:blur')
  @HostListener('window:resize')
  onDismiss(): void {
    this.menu.close();
  }

  protected select(action?: () => void): void {
    action?.();
    this.menu.close();
  }
}
