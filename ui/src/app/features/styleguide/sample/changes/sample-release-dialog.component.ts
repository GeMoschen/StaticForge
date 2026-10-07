import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { CHANGE_LANG_NAMES, ChangeLang, DEFAULT_LANG, RELEASE_DEPENDENCIES, RELEASE_ERRORS, RELEASE_WARNINGS, ReleaseCheck } from './changes-data';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from './sample-area.util';

/** A language version offered for release: `changed` ones are pre-ticked, the others shown but not choosable. */
export interface ReleaseLanguage {
  readonly lang: ChangeLang;
  /** The translated status ("Changed", "New", "Released"). */
  readonly status: string;
  readonly changed: boolean;
}

/**
 * The release dialog of the sample (M35.9 decision 26, M35.23): one heading hierarchy (the dialog's h2, then h3 per
 * part); the languages with every changed one pre-ticked and an "All changed languages" toggle (a plain checkbox, not
 * an error); the dependencies released along; a blocking error with an Open link (it belongs to a language — unticking
 * that language drops it); and warnings that need "I've read the warnings" before Release enables.
 */
@Component({
  selector: 'sf-sample-release-dialog',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfIconComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-release-dialog.component.html',
  styleUrl: './sample-release-dialog.component.scss',
})
export class SampleReleaseDialogComponent {
  /** What is released: an item's name, or "2 items". */
  readonly subject = input.required<string>();
  readonly languages = input.required<readonly ReleaseLanguage[]>();
  /** How many selected items are not language-specific (media, globals, navigation links): one checkbox for all. */
  readonly sharedCount = input(0);

  /** Cancelled or released; the host removes the dialog. */
  readonly closed = output<void>();

  protected readonly t = injectSampleText('styleguide.sample.changes.release');
  protected readonly dev = injectSampleDevMode();
  private readonly notice = injectSampleNotice();
  protected readonly defaultLang = DEFAULT_LANG;
  protected readonly dependencies = RELEASE_DEPENDENCIES;

  /** The ticked languages: every changed one to start with. */
  protected readonly changedLangs = computed(() => this.languages().filter((l) => l.changed).map((l) => l.lang));
  /** The user's choice; `null` until they change it. */
  private readonly picked = signal<ReadonlySet<ChangeLang> | null>(null);
  protected readonly ticked = computed<ReadonlySet<ChangeLang>>(() => this.picked() ?? new Set(this.changedLangs()));
  protected readonly allTicked = computed(() => {
    const changed = this.changedLangs();
    return changed.length > 0 && changed.every((lang) => this.ticked().has(lang));
  });
  protected readonly someTicked = computed(() => !this.allTicked() && this.ticked().size > 0);
  /** The checkbox of the items without a language: ticked to start with, toggling all of them. */
  protected readonly sharedTicked = signal(true);
  /** Something is ticked: a language, or the items without a language. */
  private readonly anyTicked = computed(() => this.ticked().size > 0 || (this.sharedCount() > 0 && this.sharedTicked()));

  protected readonly errors = computed(() => this.relevant(RELEASE_ERRORS));
  protected readonly warnings = computed(() => this.relevant(RELEASE_WARNINGS));
  protected readonly acknowledged = signal(false);
  protected readonly comment = signal('');

  /** Why Release is disabled, or null when it may go. */
  protected readonly blocked = computed<string | null>(() => {
    if (!this.anyTicked()) {
      return this.t('reasonNothing');
    }
    if (this.errors().length > 0) {
      return this.t('reasonErrors', { count: this.errors().length });
    }
    if (this.warnings().length > 0 && !this.acknowledged()) {
      return this.t('reasonWarnings');
    }
    return null;
  });

  protected langName(lang: ChangeLang): string {
    return `${CHANGE_LANG_NAMES[lang]} (${lang.toUpperCase()})`;
  }

  protected isTicked(lang: ChangeLang): boolean {
    return this.ticked().has(lang);
  }

  protected tick(lang: ChangeLang, on: boolean): void {
    const next = new Set(this.ticked());
    if (on) {
      next.add(lang);
    } else {
      next.delete(lang);
    }
    this.picked.set(next);
  }

  protected tickAll(on: boolean): void {
    this.picked.set(new Set(on ? this.changedLangs() : []));
  }

  protected open(check: ReleaseCheck): void {
    this.notice(this.t('openNotice', { name: check.item }));
  }

  protected release(): void {
    if (this.blocked()) {
      return;
    }
    this.notice(this.t('released', { name: this.subject() }));
    this.closed.emit();
  }

  /** Checks of the ticked languages (and those of no language). */
  private relevant(checks: readonly ReleaseCheck[]): ReleaseCheck[] {
    const ticked = this.ticked();
    return this.anyTicked() ? checks.filter((c) => c.lang === null || ticked.has(c.lang)) : [];
  }
}
