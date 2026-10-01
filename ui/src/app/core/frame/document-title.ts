export const APP_TITLE = 'StaticForge';

export interface TitleParts {
  /** The open item's name. */
  item?: string | null;
  /** The area (and sub-page): the route titles, innermost first. */
  sections?: readonly string[];
  project?: string | null;
}

/** "Item · Section · Project — StaticForge": the parts that exist, most specific first. Pure. */
export function composeTitle({ item, sections = [], project }: TitleParts): string {
  const parts = [item, ...sections, project].filter((part): part is string => !!part && part.trim() !== '');
  return parts.length === 0 ? APP_TITLE : `${parts.join(' · ')} — ${APP_TITLE}`;
}
