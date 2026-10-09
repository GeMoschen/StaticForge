import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { GenerationService } from '../generation/generation.service';
import { BuildDialogService } from './runs/build-dialog/build-dialog.service';

/**
 * *Build now* in the Publishing page header (M35.24, gate decisions 189–190): opens the Build now dialog. Without a
 * target the button stays but is disabled with the reason, next to a link to Targets; whoever may not build is told who
 * does (a read-only project shows nothing).
 */
@Component({
  selector: 'sf-publishing-build-action',
  standalone: true,
  imports: [SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!permissions.canIncrementalBuild()) {
      @if (!access.readOnly()) {
        <span class="note">{{ 'publishing.header.editorNote' | transloco }}</span>
      }
    } @else if (noTargets()) {
      <sf-button variant="ghost" icon="dns" [link]="['/p', projectKey(), 'publishing', 'targets']">{{ 'publishing.header.noTargetsLink' | transloco }}</sf-button>
      <sf-button icon="rocket_launch" disabled [disabledReason]="'publishing.header.noTargetsReason' | transloco">{{ 'publishing.header.buildNow' | transloco }}</sf-button>
    } @else {
      <sf-button icon="rocket_launch" aria-keyshortcuts="Alt+Shift+B" (click)="dialog.open()">{{ 'publishing.header.buildNow' | transloco }}</sf-button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sf-space-2);
    }
    .note {
      color: var(--sf-text-muted);
      font-size: var(--sf-fs-13);
      line-height: var(--sf-lh-13);
    }
  `,
})
export class PublishingBuildActionComponent {
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly dialog = inject(BuildDialogService);
  private readonly generation = inject(GenerationService);
  protected readonly projectKey = inject(FrameContextStore).projectKey;

  /** Whether the project has a target; unknown (`null`) until read. */
  private readonly hasTargets = signal<boolean | null>(null);
  protected readonly noTargets = computed(() => this.hasTargets() === false);

  private readonly navigations = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).id),
    ),
    { initialValue: 0 },
  );

  constructor() {
    // Re-read after each navigation inside Publishing: a target created in Targets enables the button at once.
    effect(() => {
      const key = this.projectKey();
      this.navigations();
      if (key) {
        untracked(() =>
          this.generation.listTargets(key).subscribe({
            next: (targets) => this.hasTargets.set((targets ?? []).length > 0),
            error: () => undefined,
          }),
        );
      }
    });
  }
}
