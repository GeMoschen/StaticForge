/** The toolbar commands of the rich-text editor (M35.17). */
export type RichTextCommand = 'bold' | 'italic' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'link' | 'clear';

export interface RichTextCommandDef {
  readonly id: RichTextCommand;
  readonly icon: string;
  /** The name in a field's `features` list (CDL) that switches the command on. */
  readonly feature: string;
  /** The shortcut shown in the tooltip. */
  readonly shortcut?: string;
  /** `queryCommandState` name for the pressed state. */
  readonly state?: string;
  /** The tag the caret must be inside of for the pressed state. */
  readonly block?: string;
}

/** Every command, in toolbar order. */
export const RICH_TEXT_COMMANDS: readonly RichTextCommandDef[] = [
  { id: 'bold', icon: 'format_bold', feature: 'bold', shortcut: 'Ctrl+B', state: 'bold' },
  { id: 'italic', icon: 'format_italic', feature: 'italic', shortcut: 'Ctrl+I', state: 'italic' },
  { id: 'h2', icon: 'format_h2', feature: 'h2', block: 'h2' },
  { id: 'h3', icon: 'format_h3', feature: 'h3', block: 'h3' },
  { id: 'ul', icon: 'format_list_bulleted', feature: 'list', state: 'insertUnorderedList' },
  { id: 'ol', icon: 'format_list_numbered', feature: 'numbered', state: 'insertOrderedList' },
  { id: 'quote', icon: 'format_quote', feature: 'quote', block: 'blockquote' },
  { id: 'link', icon: 'link', feature: 'link', shortcut: 'Ctrl+K', block: 'a' },
  { id: 'clear', icon: 'format_clear', feature: 'clear' },
];

/**
 * The commands a field offers. Without a `features` list: all nine. With one: exactly the commands it names — `bold`,
 * `italic`, `h2`, `h3`, `list` (bulleted), `numbered`, `quote`, `link`, `clear` — so a template written before
 * numbered lists and clear-formatting existed keeps its toolbar as it was. Pure.
 */
export function enabledCommands(features: readonly string[] | undefined): readonly RichTextCommandDef[] {
  return !features || features.length === 0 ? RICH_TEXT_COMMANDS : RICH_TEXT_COMMANDS.filter((def) => features.includes(def.feature));
}

/** A link target the link dialog accepts: a web address, a mail or phone link, a site-relative path or an anchor. */
export function isValidLinkTarget(value: string): boolean {
  const target = value.trim();
  return /^(https?:\/\/[^\s/$.?#][^\s]*|mailto:[^\s@]+@[^\s@]+|tel:[+\d][\d\s-]*|\/[^\s]*|#[^\s]+)$/i.test(target);
}

/** The visible text of an HTML fragment (for the character count). */
export function textLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').length;
}

/**
 * The site path of a page from where it lives (`/pages_root/news/` + uid `spring_harvest` → `/news/spring_harvest`): the
 * link dialog's starting point when a page is chosen; the author can still edit it. Pure.
 */
export function pagePath(folderPath: string | undefined, uid: string | undefined): string {
  const segments = (folderPath ?? '').split('/').filter(Boolean).slice(1);
  return `/${[...segments, ...(uid ? [uid] : [])].join('/')}`;
}

/** Escapes text for use inside HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
