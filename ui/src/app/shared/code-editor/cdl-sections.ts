import type { components } from '../../core/api/generated/schema.d.ts';

type Diagnostic = components['schemas']['Diagnostic'];

/**
 * A content holder's CDL as the three sections it is edited and stored as (M34): the text inside `content { … }`,
 * `bodies { … }` and `rules { … }`, without the keyword and braces. Templates, datasets and global sets edit one
 * section per tab; the server compiles them as one definition and names each diagnostic's section in `field`.
 */
export type CdlSection = 'content' | 'bodies' | 'rules';

export interface CdlSections {
  content: string;
  bodies: string;
  rules: string;
}

export const EMPTY_SECTIONS: CdlSections = { content: '', bodies: '', rules: '' };

export const SECTION_LABELS: Record<CdlSection, string> = { content: 'Content', bodies: 'Bodies', rules: 'Rules' };

/** The sections of a detail or request body carrying `contentCdl`/`bodiesCdl`/`rulesCdl`. */
export function sectionsOf(
  value: { contentCdl?: string | null; bodiesCdl?: string | null; rulesCdl?: string | null } | null | undefined,
): CdlSections {
  return {
    content: value?.contentCdl ?? '',
    bodies: value?.bodiesCdl ?? '',
    rules: value?.rulesCdl ?? '',
  };
}

/** The request fields of `sections`. */
export function cdlFields(sections: CdlSections): { contentCdl: string; bodiesCdl: string; rulesCdl: string } {
  return { contentCdl: sections.content, bodiesCdl: sections.bodies, rulesCdl: sections.rules };
}

export function sectionsEqual(a: CdlSections, b: CdlSections): boolean {
  return a.content === b.content && a.bodies === b.bodies && a.rules === b.rules;
}

/** The `field` of a channel template's diagnostics. */
export function channelField(channelKey: string): string {
  return `channel:${channelKey}`;
}

/** The channel a diagnostic's `field` names, or `null` for a CDL section. */
export function channelOfField(field: string | null | undefined): string | null {
  return field?.startsWith('channel:') ? field.slice('channel:'.length) : null;
}

/** The CDL diagnostics of one section; a CDL diagnostic without a section belongs to Content. */
export function diagnosticsIn(diagnostics: readonly Diagnostic[], section: CdlSection): Diagnostic[] {
  return diagnostics.filter((d) => (d.field ?? 'content') === section);
}

export function errorCount(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((d) => d.severity === 'ERROR').length;
}

/** The first of `sections` holding an error, for a rejected save to open. */
export function firstSectionWithErrors(diagnostics: readonly Diagnostic[], sections: readonly CdlSection[]): CdlSection | null {
  return sections.find((section) => errorCount(diagnosticsIn(diagnostics, section)) > 0) ?? null;
}

/** Splits a save's diagnostics into the CDL ones and the ones of each channel. */
export function splitDiagnostics(diagnostics: readonly Diagnostic[]): {
  cdl: Diagnostic[];
  channels: Record<string, Diagnostic[]>;
} {
  const cdl: Diagnostic[] = [];
  const channels: Record<string, Diagnostic[]> = {};
  for (const d of diagnostics) {
    const channel = channelOfField(d.field);
    if (channel === null) {
      cdl.push(d);
    } else {
      (channels[channel] ??= []).push(d);
    }
  }
  return { cdl, channels };
}

/** Whether a keyboard event is the save shortcut (Ctrl+S, ⌘S). */
export function isSaveShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's';
}
