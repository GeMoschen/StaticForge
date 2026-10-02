/** What the sample fields remember of a chosen target, and the pages, files and records they start with. */
export { PICKER_MEDIA, PICKER_PAGES, PICKER_RECORDS } from './picker-data';
export type { PickerItem, PickerKind } from './picker-data';

export const SAMPLE_INTRO_HTML =
  '<p>Our spring harvest has landed in Hamburg — bright, floral and roasted in small batches this week.</p>' +
  '<h3>Fresh from the highlands</h3>' +
  '<p>The cherries are <strong>hand-picked</strong> and dried on raised beds. Read the <a href="/news/hamburg-roastery">roastery story</a>.</p>' +
  '<ul><li>Floral and bright</li><li>Roasted in small batches</li></ul>';

export const SAMPLE_HIGHLIGHTS: readonly string[] = ['Hand-picked cherries', 'Dried on raised beds', 'Roasted in small batches'];

/** A group's values: the SEO block of a page. */
export interface SeoGroupValue {
  readonly title: string;
  readonly canonical: string;
}

export const SAMPLE_SEO: SeoGroupValue = { title: 'Spring harvest arrives — Lumen Coffee', canonical: '/news/spring-harvest' };
