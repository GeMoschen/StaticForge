import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { SamplePagesReview } from './sample-pages-review';

/**
 * The Pages area of a project that has no pages yet (M35.18 review round 8): an empty state that says why — a page is made
 * from a template, and the project has none — and what to do. A developer gets the primary action **Go to Templates**; an
 * editor, who cannot create templates, is told to **ask a developer** (no dead button). *Create folder* is always offered:
 * folders do not need a template. A project that **has** page templates (`etemplates=1`) says a page needs one of them and
 * offers **Create a page** as the primary action for everyone.
 */
@Component({
  selector: 'sf-sample-pages-empty',
  standalone: true,
  imports: [SfEmptyStateComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-pages-empty.component.scss',
  template: `
    <sf-empty-state
      icon="note_add"
      [title]="t('empty.title')"
      [description]="hasTemplates() ? t('empty.templates') : state.devMode() ? t('empty.developer') : t('empty.editor')"
      [primaryLabel]="hasTemplates() ? t('empty.createPage') : state.devMode() ? t('empty.goTemplates') : null"
      [primaryIcon]="hasTemplates() ? 'note_add' : 'code_blocks'"
      [secondaryLabel]="t('empty.createFolder')"
      (primary)="hasTemplates() ? state.notice() : state.openArea('templates')"
      (secondary)="state.notice()"
    />
  `,
})
export class SamplePagesEmptyComponent {
  protected readonly state = inject(SampleState);
  protected readonly hasTemplates = inject(SamplePagesReview).hasTemplates;
  protected readonly t = injectSampleText('styleguide.sample.pages');
}
