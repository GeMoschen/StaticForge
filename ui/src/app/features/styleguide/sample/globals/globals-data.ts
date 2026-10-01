import type { SfCatalogItem, SfCatalogType } from '../../../../shared/components/card/sf-catalog.component';
import type { SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import type { SampleLang } from '../sample-data';

/**
 * Fake data of the sample's Globals area (M35.9 decision 25): two global sets of the coffee-roaster website with their
 * values and CDL schemas. Field labels and hints come from the schema, so they are content, not UI text — the area's
 * own labels live in `en.json` under `styleguide.sample.globals.*`. Nothing is saved.
 */

export type SampleSetId = 'site' | 'shop';
export const SAMPLE_SET_IDS: readonly SampleSetId[] = ['site', 'shop'];

/** A folder of the Globals tree with its sets. */
export interface SampleGlobalFolder {
  readonly id: string;
  readonly name: string;
  readonly sets: readonly SampleSetId[];
}

export interface SampleGlobalSet {
  readonly id: SampleSetId;
  /** The set's uid: what templates read (`CMS_GLOBAL.<uid>.<field>`). */
  readonly uid: string;
  readonly name: string;
  readonly fileName: string;
  readonly cdl: string;
}

export const GLOBAL_FOLDERS: readonly SampleGlobalFolder[] = [
  { id: 'g-site', name: 'Site', sets: ['site'] },
  { id: 'g-shop', name: 'Shop', sets: ['shop'] },
];

/** One field as the schema declares it (label, hint, editor name). */
export interface SampleGlobalField {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly list?: boolean;
}

export const SITE_FIELDS = {
  name: { name: 'name', label: 'Site name', hint: 'Shown in the browser tab and the header.' },
  email: { name: 'email', label: 'Contact e-mail', hint: 'Where the contact form sends its messages.' },
  openingHours: { name: 'openingHours', label: 'Opening hours', list: true },
  socialLinks: { name: 'socialLinks', label: 'Social links', list: true },
  footerText: { name: 'footerText', label: 'Footer text', hint: 'One or two sentences under every page.' },
} as const satisfies Record<string, SampleGlobalField>;

/** The sub-editors of an opening-hours row and of a social link card. */
export const HOURS_FIELDS = { day: 'Day', hours: 'Hours' } as const;
export const SOCIAL_FIELDS = { handle: 'Handle', url: 'Link' } as const;

export const SHOP_FIELDS = {
  currency: { name: 'currency', label: 'Currency' },
  freeShippingFrom: { name: 'freeShippingFrom', label: 'Free shipping from', hint: 'Orders from this amount ship for free.' },
} as const satisfies Record<string, SampleGlobalField>;

export const CURRENCY_OPTIONS: readonly SfSelectOption<string>[] = [
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'CHF', label: 'Swiss franc (CHF)' },
  { value: 'USD', label: 'US dollar (USD)' },
];

/** The social link card types (in the schema: a list whose items carry a `network` select). */
export type SampleSocialType = 'instagram' | 'mastodon' | 'newsletter';
export const SOCIAL_TYPES: readonly SfCatalogType[] = [
  { id: 'instagram', label: 'Instagram', icon: 'photo_camera', description: 'A profile on Instagram' },
  { id: 'mastodon', label: 'Mastodon', icon: 'forum', description: 'A profile on a Mastodon server' },
  { id: 'newsletter', label: 'Newsletter', icon: 'mail', description: 'The newsletter sign-up page' },
];

export interface SampleHoursRow {
  readonly id: string;
  readonly day: string;
  readonly hours: string;
}

export interface SampleSocialLink extends SfCatalogItem {
  readonly type: SampleSocialType;
  readonly handle: string;
  readonly url: string;
}

export interface SampleSiteValues {
  readonly name: string;
  readonly email: string;
  readonly openingHours: readonly SampleHoursRow[];
  readonly socialLinks: readonly SampleSocialLink[];
  /** Localized: one text per language. */
  readonly footerText: Readonly<Record<SampleLang, string>>;
}

export interface SampleShopValues {
  readonly currency: string | null;
  readonly freeShippingFrom: number | null;
}

/** What a set holds: its values and its schema (both saved together). */
export interface SampleSetDraft {
  readonly site: SampleSiteValues;
  readonly shop: SampleShopValues;
  readonly cdl: Readonly<Record<SampleSetId, string>>;
}

const SITE_CDL = `// Site settings — global set "site"
content {
  editor text name {
    label "Site name"
    help "Shown in the browser tab and the header."
    required
    maxLength 60
  }
  editor text email {
    label "Contact e-mail"
    help "Where the contact form sends its messages."
    required
  }
  editor list openingHours {
    label "Opening hours"
    max 7
    item {
      editor text day   { label "Day" required }
      editor text hours { label "Hours" }
    }
  }
  // A list, not a catalog: catalogs are not allowed in global sets (SF-CDL-0107).
  editor list socialLinks {
    label "Social links"
    item {
      editor select network {
        label "Network"
        options [
          { value "instagram",  label "Instagram" },
          { value "mastodon",   label "Mastodon" },
          { value "newsletter", label "Newsletter" }
        ]
      }
      editor text handle { label "Handle" }
      editor link url    { label "Link" }
    }
  }
  editor textarea footerText {
    label "Footer text"
    help "One or two sentences under every page."
    localizable
    maxLength 240
  }
}
`;

const SHOP_CDL = `// Shop settings — global set "shop"
content {
  editor select currency {
    label "Currency"
    options [
      { value "EUR", label "Euro (EUR)" },
      { value "CHF", label "Swiss franc (CHF)" },
      { value "USD", label "US dollar (USD)" }
    ]
    default "EUR"
  }
  editor number freeShippingFrom {
    label "Free shipping from"
    help "Orders from this amount ship for free."
    min 0
  }
}
`;

export const GLOBAL_SETS: Readonly<Record<SampleSetId, Omit<SampleGlobalSet, 'cdl'>>> = {
  site: { id: 'site', uid: 'site', name: 'Site settings', fileName: 'site.cdl' },
  shop: { id: 'shop', uid: 'shop', name: 'Shop settings', fileName: 'shop.cdl' },
};

export function initialSetDraft(): SampleSetDraft {
  return {
    site: {
      name: 'Kaffeerösterei Hafenblick',
      email: 'hello@hafenblick.example',
      openingHours: [
        { id: 'h1', day: 'Monday – Friday', hours: '8:00 – 18:00' },
        { id: 'h2', day: 'Saturday', hours: '9:00 – 16:00' },
        { id: 'h3', day: 'Sunday', hours: 'Closed' },
      ],
      socialLinks: [
        { id: 's1', type: 'instagram', handle: '@hafenblick.coffee', url: 'https://instagram.com/hafenblick.coffee' },
        { id: 's2', type: 'mastodon', handle: '@hafenblick@mastodon.social', url: 'https://mastodon.social/@hafenblick' },
        { id: 's3', type: 'newsletter', handle: 'Roast notes', url: 'https://hafenblick.example/newsletter' },
      ],
      footerText: {
        en: 'Roasted by hand in Hamburg since 2012. Fair prices for farmers, fresh beans for you.',
        de: 'Seit 2012 in Hamburg von Hand geröstet. Faire Preise für die Bauern, frische Bohnen für Sie.',
      },
    },
    shop: { currency: 'EUR', freeShippingFrom: 39 },
    cdl: { site: SITE_CDL, shop: SHOP_CDL },
  };
}
