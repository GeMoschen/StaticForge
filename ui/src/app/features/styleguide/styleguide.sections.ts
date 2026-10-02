/** One `h2` section of the style guide: its element id and the `styleguide.page.sections.*` key of its heading. */
export interface StyleguideSection {
  readonly id: string;
  readonly key: string;
}

export interface StyleguideSectionGroup {
  /** `styleguide.page.index.*` key of the group caption in the index. */
  readonly key: string;
  readonly sections: readonly StyleguideSection[];
}

const section = (name: string): StyleguideSection => ({ id: `sg-${name}`, key: `styleguide.page.sections.${name}` });

/** The sections in document order, grouped as the index shows them. */
export const STYLEGUIDE_GROUPS: readonly StyleguideSectionGroup[] = [
  {
    key: 'styleguide.page.index.tokens',
    sections: ['colors', 'type', 'spacing', 'radius', 'elevation', 'zIndex', 'motion', 'density'].map(section),
  },
  {
    key: 'styleguide.page.index.components',
    sections: ['buttons', 'forms', 'contentForm', 'display', 'layout', 'overlays', 'data', 'cards', 'code'].map(section),
  },
];

export const STYLEGUIDE_SECTIONS: readonly StyleguideSection[] = STYLEGUIDE_GROUPS.flatMap((group) => group.sections);

/** The section with this name (`colors` → `sg-colors`). */
export function sectionOf(name: string): StyleguideSection {
  const found = STYLEGUIDE_SECTIONS.find((s) => s.id === `sg-${name}`);
  if (!found) {
    throw new Error(`unknown style guide section ${name}`);
  }
  return found;
}
