import {
  ChangeDetectionStrategy,
  Component,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { ContentDefinition, EditorDefinition } from './form.model';
import { SfEditorOutlet } from './editor-outlet.component';
import { SF_FORM_CONTEXT, SfFormContext } from './form.context';
import { EditingLocale, resolve, resolvedLocale } from './l10n.util';

/**
 * Host component of the CDL-driven dynamic form engine. Renders the top-level
 * editors (flattening GROUPs by delegating their items to {@link SfGroupEditor},
 * and expanding LIST rows inside {@link SfListEditor}) via {@link SfEditorOutlet}.
 *
 * Provides the shared {@link SF_FORM_CONTEXT} so nested editors can reactively
 * evaluate their own `visibleWhen` expressions and resolve the project key.
 */
@Component({
  selector: 'sf-content-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEditorOutlet],
  providers: [
    {
      provide: SF_FORM_CONTEXT,
      useFactory: () => {
        const host = inject(forwardRef(() => SfContentFormComponent));
        return {
          formValue: host.formValue,
          projectKey: host.projectKey,
        } satisfies SfFormContext;
      },
    },
  ],
  templateUrl: './sf-content-form.component.html',
  styleUrl: './sf-content-form.component.scss',
})
export class SfContentFormComponent {
  readonly definition = input.required<ContentDefinition>();
  readonly formGroup = input.required<FormGroup>();
  readonly projectKey = input<string>();
  /**
   * Server validation findings (`ContentIssue`s) to show under the editor they belong to. Paths are
   * rooted at `issuePrefix` (`content.name`, `content.links[0].target`); a finding inside a list row
   * or a group member is shown under its top-level editor.
   */
  readonly issues = input<ReadonlyArray<{ path?: string; message?: string }>>([]);
  readonly issuePrefix = input<string>('content');
  /**
   * The language being edited (M24.4.1), or `null` in a project without languages — which is what
   * keeps this form exactly as it was before M24: no badges, no fallback hints.
   */
  readonly editingLocale = input<EditingLocale | null>(null);
  /**
   * The content object as stored, i.e. with every language still in it. The form itself only holds
   * the language being edited, so this is what the fallback hint reads the other languages from.
   */
  readonly storedValue = input<Record<string, unknown> | null>(null);
  /** Human-readable names of the languages, for "inherited from Deutsch" rather than "from de". */
  readonly localeLabels = input<Record<string, string>>({});

  readonly formValue = signal<Record<string, unknown>>({});

  constructor() {
    effect(
      (onCleanup) => {
        const form = this.formGroup();
        const update = () => this.formValue.set(form.getRawValue() as Record<string, unknown>);
        update();
        const subscription = form.valueChanges.subscribe(update);
        onCleanup(() => subscription.unsubscribe());
      },
      { allowSignalWrites: true },
    );
  }

  /** The messages of every issue under `editor` (or, for a group, under any of its members). */
  issuesFor(editor: EditorDefinition): string[] {
    const names = new Set<string>();
    const collect = (e: EditorDefinition) => {
      names.add(e.name);
      if (e.type === 'GROUP') {
        (e.items ?? []).forEach(collect);
      }
    };
    collect(editor);
    const prefix = this.issuePrefix() ? `${this.issuePrefix()}.` : '';
    return this.issues()
      .filter((issue) => {
        const path = issue.path ?? '';
        if (!path.startsWith(prefix)) {
          return false;
        }
        const head = path.slice(prefix.length).split(/[.[]/)[0];
        return names.has(head);
      })
      .map((issue) => issue.message ?? '');
  }

  controlFor(editor: EditorDefinition): FormControl | FormGroup | FormArray {
    return this.formGroup().get(editor.name) as FormControl | FormGroup | FormArray;
  }

  // ── Languages (M24.4.1) ──────────────────────────────────────────────

  /** Whether this form is editing one language of a multi-language project. */
  protected localized(): boolean {
    return this.editingLocale() !== null;
  }

  /** The project's default language — the one `required` is checked in. */
  protected defaultLocale(): string {
    const chain = this.editingLocale()?.chain ?? [];
    return chain.length > 0 ? chain[chain.length - 1] : '';
  }

  /** Whether the language being edited is the default one. */
  protected isDefaultLocale(): boolean {
    return this.editingLocale()?.locale === this.defaultLocale();
  }

  /** The label to show for a language tag. */
  protected labelOf(code: string): string {
    return this.localeLabels()[code] ?? code;
  }

  /**
   * The value this editor would fall back to: the first language in the chain *after* the one being
   * edited that has a value, or `null` when the field is translated here or nowhere.
   */
  protected fallbackFor(editor: EditorDefinition): { locale: string; text: string } | null {
    const binding = this.editingLocale();
    if (!binding || !editor.localizable) {
      return null;
    }
    const stored = this.storedValue()?.[editor.name];
    const own = this.formGroup().get(editor.name)?.value;
    if (own !== null && own !== undefined && own !== '') {
      return null;
    }
    const rest = binding.chain.filter((code) => code !== binding.locale);
    const locale = resolvedLocale(stored, rest);
    if (!locale) {
      return null;
    }
    const value = resolve(stored, [locale]);
    return { locale, text: this.asText(value) };
  }

  /** Copies the fallback language's value into this language, as a starting point to translate. */
  protected copyFallback(editor: EditorDefinition): void {
    const fallback = this.fallbackFor(editor);
    const binding = this.editingLocale();
    if (!fallback || !binding) {
      return;
    }
    const stored = this.storedValue()?.[editor.name];
    this.formGroup().get(editor.name)?.setValue(resolve(stored, [fallback.locale]));
  }

  /** A short, plain-text preview of any editor value, for the fallback hint. */
  private asText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      const inner = (value as Record<string, unknown>)['value'];
      return typeof inner === 'string' ? inner.replace(/<[^>]*>/g, ' ').trim() : JSON.stringify(value);
    }
    return JSON.stringify(value);
  }
}
