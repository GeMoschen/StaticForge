import type { components } from '../../core/api/generated/schema.d.ts';
import type { EditorDefinition } from '../forms/form.model';

type ChannelView = components['schemas']['ChannelView'];
type Diagnostic = components['schemas']['Diagnostic'];

/**
 * Pure helpers behind the dataset editor's record template tabs (M25.5.2), kept free of Angular so their
 * specs run without the component runner.
 */

/** One record template tab: a channel of the project, or a channel a stored template names. */
export interface RecordTemplateChannel {
  key: string;
  name: string;
  /** A disabled channel still shows its stored template, so saving never drops it unseen. */
  enabled: boolean;
}

/** A name the record template can read, offered for click-to-insert. */
export interface RecordTemplateHelper {
  name: string;
  /** What the chip's tooltip says: a field's label and type, or what a meta name holds. */
  description: string;
  snippet: string;
  /** Where the caret lands inside `snippet` after inserting it. */
  caret: number;
}

/** The record's meta names a record template can read (epic decision 4), with what they hold. */
const META_NAMES: readonly { name: string; description: string; flag: boolean }[] = [
  { name: '_uid', description: "the record's uid", flag: false },
  { name: '_displayName', description: "the record's display name", flag: false },
  { name: '_index', description: 'position in the rendered set, from 0', flag: false },
  { name: '_first', description: 'true for the first rendered record', flag: true },
  { name: '_last', description: 'true for the last rendered record', flag: true },
  { name: '_count', description: 'how many records the set renders', flag: false },
];

/** `channelTemplates` of a dataset (`{<channel>: {source, compiledHash}}`) as channel → source. */
export function readRecordTemplateSources(channelTemplates: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (channelTemplates && typeof channelTemplates === 'object') {
    for (const [channel, value] of Object.entries(channelTemplates as Record<string, unknown>)) {
      const source = (value as { source?: unknown } | null)?.source;
      if (typeof source === 'string') {
        out[channel] = source;
      }
    }
  }
  return out;
}

/**
 * The `channelTemplates` map a save sends: every channel with a non-blank source. The map replaces the stored
 * templates, so a channel left out (or blanked) loses its template — the server drops blank sources the same way.
 */
export function recordTemplatesForSave(sources: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [channel, source] of Object.entries(sources)) {
    if (source.trim()) {
      out[channel] = source;
    }
  }
  return out;
}

/** Whether the edited templates differ from the stored ones (a blank template equals no template). */
export function recordTemplatesDiffer(edited: Record<string, string>, stored: Record<string, string>): boolean {
  const a = recordTemplatesForSave(edited);
  const b = recordTemplatesForSave(stored);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return true;
    }
  }
  return false;
}

/** The tabs: the project's channels in their order, then channels only a stored template still names. */
export function recordTemplateChannels(
  channels: readonly ChannelView[],
  stored: Record<string, string>,
): RecordTemplateChannel[] {
  const ordered = [...channels]
    .filter((c) => !!c.key)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.key ?? '').localeCompare(b.key ?? ''));
  const out: RecordTemplateChannel[] = [];
  for (const channel of ordered) {
    const enabled = channel.enabled !== false;
    if (enabled || channel.key! in stored) {
      out.push({ key: channel.key!, name: channel.name || channel.key!, enabled });
    }
  }
  for (const key of Object.keys(stored).sort()) {
    if (!out.some((c) => c.key === key)) {
      out.push({ key, name: key, enabled: false });
    }
  }
  return out;
}

/**
 * The top-level names a record template can read, from the CDL being edited (so a field added in the same save
 * is offered at once): every `editor <type> <name>` directly in `content { … }` or in a `group "…" { … }` wrapper,
 * in source order. Editors inside another editor's body (a `list`'s `item { … }`) are not record fields. Labels
 * come from the saved schema's compiled editors where the name matches.
 */
export function recordTemplateFields(
  cdl: string,
  savedEditors: readonly EditorDefinition[] | null | undefined,
): RecordTemplateHelper[] {
  const labels = new Map<string, string>();
  const walk = (editors: readonly EditorDefinition[] | undefined) => {
    for (const editor of editors ?? []) {
      if (editor.type === 'GROUP') {
        walk(editor.items);
      } else if (editor.label) {
        labels.set(editor.name, editor.label);
      }
    }
  };
  walk(savedEditors ?? undefined);

  const out: RecordTemplateHelper[] = [];
  const seen = new Set<string>();
  for (const { type, name } of topLevelEditors(cdl)) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const label = labels.get(name);
    const snippet = `$CMS_VALUE(${name})$`;
    out.push({ name, description: label ? `${label} (${type})` : type, snippet, caret: snippet.length });
  }
  return out;
}

/** The meta names, as insert helpers: a value for most, an `$CMS_IF` block (caret inside) for the flags. */
export function recordTemplateMetaHelpers(): RecordTemplateHelper[] {
  return META_NAMES.map(({ name, description, flag }) => {
    if (flag) {
      const open = `$CMS_IF(${name})$`;
      return { name, description, snippet: `${open}$CMS_END_IF$`, caret: open.length };
    }
    const snippet = `$CMS_VALUE(${name})$`;
    return { name, description, snippet, caret: snippet.length };
  });
}

/** A rejected save's record template errors (`422` with `channel` / `channelDiagnostics`), or `null`. */
export function recordTemplateErrorsOf(error: unknown): { channel: string; byChannel: Record<string, Diagnostic[]> } | null {
  const body = (error as { error?: unknown } | null)?.error as
    | { channel?: unknown; diagnostics?: unknown; channelDiagnostics?: unknown }
    | null
    | undefined;
  if (!body || typeof body.channel !== 'string' || !body.channel) {
    return null;
  }
  const byChannel: Record<string, Diagnostic[]> = {};
  if (body.channelDiagnostics && typeof body.channelDiagnostics === 'object') {
    for (const [channel, list] of Object.entries(body.channelDiagnostics as Record<string, unknown>)) {
      if (Array.isArray(list)) {
        byChannel[channel] = list as Diagnostic[];
      }
    }
  }
  if (!byChannel[body.channel] && Array.isArray(body.diagnostics)) {
    byChannel[body.channel] = body.diagnostics as Diagnostic[];
  }
  return { channel: body.channel, byChannel };
}

/** The first error with a position, else the first diagnostic: where the caret goes after a rejected save. */
export function firstPositioned(diagnostics: readonly Diagnostic[]): Diagnostic | undefined {
  return (
    diagnostics.find((d) => d.severity === 'ERROR' && !!d.line) ?? diagnostics.find((d) => !!d.line) ?? diagnostics[0]
  );
}

interface EditorDeclaration {
  type: string;
  name: string;
}

/** Scans CDL for editor declarations that are record fields (see {@link recordTemplateFields}). */
function topLevelEditors(cdl: string): EditorDeclaration[] {
  // Strings are dropped first (a label may hold braces); what remains is braces and words.
  const tokens = cdl.replace(/"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/g, ' "" ').match(/[{}]|""|[A-Za-z_][\w-]*/g) ?? [];
  const out: EditorDeclaration[] = [];
  /** Per open brace: whether editors inside it are record fields. */
  const frames: boolean[] = [];
  const transparent = () => frames.every((f) => f);
  let pending: boolean | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{') {
      frames.push(pending ?? false);
      pending = null;
    } else if (token === '}') {
      frames.pop();
      pending = null;
    } else if (token === 'content' && frames.length === 0) {
      pending = true;
    } else if (token === 'group' && tokens[i + 1] === '""' && transparent()) {
      pending = true;
      i++;
    } else if (token === 'editor' && i + 2 < tokens.length && isWord(tokens[i + 1]) && isWord(tokens[i + 2])) {
      if (transparent() && frames.length > 0) {
        out.push({ type: tokens[i + 1].toLowerCase(), name: tokens[i + 2] });
      }
      pending = false;
      i += 2;
    }
  }
  return out;
}

function isWord(token: string): boolean {
  return token !== '{' && token !== '}' && token !== '""';
}
