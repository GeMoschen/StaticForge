/**
 * Fake data of the sample's Changes and Schedules areas (M35.9 decision 26): the unreleased changes of the coffee-roaster
 * site, one row per language, the release dialog's checks and the schedules list. Content, not UI text — the areas'
 * labels live in `en.json` under `styleguide.sample.changes.*`. Times are minutes before "now". Nothing is saved.
 */
import type { SfStatusTone } from '../../../../shared/components/display/sf-status.component';

export type ChangeLang = 'de' | 'en';
/** The project's languages, the default (German) first. */
export const CHANGE_LANGS: readonly ChangeLang[] = ['de', 'en'];
export const DEFAULT_LANG: ChangeLang = 'de';
export const CHANGE_LANG_NAMES: Readonly<Record<ChangeLang, string>> = { de: 'Deutsch', en: 'English' };

export type ChangeType = 'page' | 'record' | 'media' | 'global' | 'navigation';
export const CHANGE_TYPES: readonly ChangeType[] = ['page', 'record', 'media', 'global', 'navigation'];
export const CHANGE_TYPE_ICONS: Readonly<Record<ChangeType, string>> = {
  page: 'description',
  record: 'table_rows',
  media: 'image',
  global: 'tune',
  navigation: 'link',
};

/** What is unreleased about a language version (released versions are not in the list). */
export type ChangeStatus = 'new' | 'changed' | 'unpublished' | 'deletion';
export const CHANGE_STATUSES: readonly ChangeStatus[] = ['new', 'changed', 'unpublished', 'deletion'];
export const CHANGE_STATUS_TONES: Readonly<Record<ChangeStatus, SfStatusTone>> = {
  new: 'info',
  changed: 'warning',
  unpublished: 'neutral',
  deletion: 'danger',
};
export const CHANGE_STATUS_ICONS: Readonly<Record<ChangeStatus, string>> = {
  new: 'fiber_new',
  changed: 'edit_note',
  unpublished: 'cloud_off',
  deletion: 'delete_forever',
};

export interface ChangePerson {
  readonly id: string;
  readonly name: string;
}

export const CHANGE_PEOPLE: readonly ChangePerson[] = [
  { id: 'anna', name: 'Anna Berger' },
  { id: 'jonas', name: 'Jonas Weber' },
  { id: 'mira', name: 'Mira Okafor' },
  { id: 'lukas', name: 'Lukas Brandt' },
  { id: 'sofia', name: 'Sofia Marquez' },
];
const [anna, jonas, mira, lukas, sofia] = CHANGE_PEOPLE;

/** One field of the diff: the released value (left) and the draft (right); `null` = not there. */
export interface ChangeDiffField {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** One row of the Changes list: an asset in one language. */
export interface SampleChange {
  /** `<asset>:<lang>` — what `diff=` and the selection name. */
  readonly id: string;
  readonly asset: string;
  readonly name: string;
  /** The developer-mode identifier. */
  readonly uid: string;
  readonly type: ChangeType;
  readonly lang: ChangeLang;
  readonly status: ChangeStatus;
  readonly by: ChangePerson;
  readonly minutes: number;
  /** The folder path, root first ("Pages › News"). */
  readonly folder: string;
  readonly fields: readonly ChangeDiffField[];
}

interface AssetDef {
  readonly asset: string;
  readonly name: string;
  readonly type: ChangeType;
  readonly folder: string;
  readonly langs: Partial<
    Record<ChangeLang, { status: ChangeStatus; by: ChangePerson; minutes: number; fields?: readonly ChangeDiffField[] }>
  >;
}

const HOUR = 60;
const DAY = 24 * HOUR;

const ASSETS: readonly AssetDef[] = [
  {
    asset: 'spring_harvest',
    name: 'Spring harvest arrives',
    type: 'page',
    folder: 'Pages › News',
    langs: {
      de: {
        status: 'changed',
        by: anna,
        minutes: 25,
        fields: [
          { label: 'Title', before: 'Die Frühlingsernte ist da', after: 'Die Frühlingsernte ist angekommen' },
          {
            label: 'Teaser',
            before: 'Frische Bohnen aus Äthiopien und Kolumbien.',
            after: 'Frische Bohnen aus Äthiopien, Kolumbien und erstmals aus Ruanda.',
          },
          { label: 'Author', before: 'Mira Okafor', after: 'Mira Okafor' },
          { label: 'Image alt text', before: null, after: 'Kaffeekirschen am Strauch, kurz vor der Ernte' },
        ],
      },
      en: {
        status: 'changed',
        by: anna,
        minutes: 31,
        fields: [
          { label: 'Title', before: 'The spring harvest is here', after: 'Spring harvest arrives' },
          {
            label: 'Teaser',
            before: 'Fresh beans from Ethiopia and Colombia.',
            after: 'Fresh beans from Ethiopia, Colombia and — for the first time — Rwanda.',
          },
          { label: 'Product teaser', before: 'Yirgacheffe 250 g', after: null },
        ],
      },
    },
  },
  {
    asset: 'single_origins',
    name: 'Single origins',
    type: 'page',
    folder: 'Pages › Shop',
    langs: {
      de: {
        status: 'changed',
        by: anna,
        minutes: 7 * HOUR,
        fields: [{ label: 'Intro', before: 'Sortenreine Kaffees von kleinen Farmen.', after: 'Sortenreine Kaffees direkt von kleinen Farmen.' }],
      },
    },
  },
  {
    asset: 'barista_championship',
    name: 'Barista championship recap',
    type: 'page',
    folder: 'Pages › News',
    langs: {
      de: { status: 'new', by: sofia, minutes: 50 },
      en: { status: 'new', by: sofia, minutes: 55 },
    },
  },
  {
    asset: 'home',
    name: 'Home',
    type: 'page',
    folder: 'Pages',
    langs: {
      en: {
        status: 'changed',
        by: mira,
        minutes: 3 * HOUR,
        fields: [{ label: 'Hero headline', before: 'Roasted in Hamburg', after: 'Roasted in Hamburg since 2009' }],
      },
    },
  },
  {
    asset: 'yirgacheffe',
    name: 'Yirgacheffe 250 g',
    type: 'record',
    folder: 'Content › Products › Coffees',
    langs: {
      de: {
        status: 'changed',
        by: lukas,
        minutes: 4 * HOUR,
        fields: [
          { label: 'Price', before: '12,90 €', after: '13,50 €' },
          { label: 'In stock', before: 'Yes', after: 'Yes' },
        ],
      },
      en: {
        status: 'changed',
        by: lukas,
        minutes: 4 * HOUR,
        fields: [{ label: 'Price', before: '€12.90', after: '€13.50' }],
      },
    },
  },
  {
    asset: 'harvest_jpg',
    name: 'harvest-2026.jpg',
    type: 'media',
    folder: 'Media › News',
    langs: { de: { status: 'new', by: anna, minutes: 40 } },
  },
  {
    asset: 'munich',
    name: 'Munich',
    type: 'page',
    folder: 'Pages › Locations',
    langs: {
      de: { status: 'new', by: sofia, minutes: 2 * HOUR },
      en: { status: 'new', by: sofia, minutes: 2 * HOUR },
    },
  },
  {
    asset: 'site_settings',
    name: 'Site settings',
    type: 'global',
    folder: 'Globals',
    langs: {
      de: {
        status: 'changed',
        by: jonas,
        minutes: 26 * HOUR,
        fields: [{ label: 'Opening hours', before: 'Mo–Fr 8–18 Uhr', after: 'Mo–Fr 8–19 Uhr, Sa 9–16 Uhr' }],
      },
    },
  },
  {
    asset: 'team',
    name: 'Team',
    type: 'page',
    folder: 'Pages › About us',
    langs: {
      de: {
        status: 'changed',
        by: sofia,
        minutes: 2 * DAY,
        fields: [{ label: 'Intro', before: 'Zwölf Menschen, eine Leidenschaft.', after: 'Vierzehn Menschen, eine Leidenschaft.' }],
      },
    },
  },
  {
    asset: 'nav_shop',
    name: 'Shop → /shop/',
    type: 'navigation',
    folder: 'Navigation › Main menu',
    langs: { en: { status: 'unpublished', by: lukas, minutes: 3 * DAY } },
  },
  {
    asset: 'latte_art',
    name: 'Latte art workshop',
    type: 'page',
    folder: 'Pages › News › Archive',
    langs: {
      de: { status: 'deletion', by: jonas, minutes: 5 * DAY },
      en: { status: 'deletion', by: jonas, minutes: 5 * DAY },
    },
  },
];

/** Every unreleased language version, the default language first within an asset. */
export const CHANGES: readonly SampleChange[] = ASSETS.flatMap((def) =>
  CHANGE_LANGS.filter((lang) => def.langs[lang]).map((lang) => {
    const version = def.langs[lang]!;
    return {
      id: `${def.asset}:${lang}`,
      asset: def.asset,
      name: def.name,
      uid: def.asset,
      type: def.type,
      lang,
      status: version.status,
      by: version.by,
      minutes: version.minutes,
      folder: def.folder,
      fields: version.fields ?? [],
    };
  }),
);

/** The row the scripted `diff` state opens, and the two the scripted `sel=2` selects. */
export const FIXED_DIFF = 'spring_harvest:de';
export const FIXED_SELECTION: readonly string[] = ['spring_harvest:de', 'spring_harvest:en'];

export const CHANGE_FOLDERS: readonly string[] = [...new Set(CHANGES.map((c) => c.folder))].sort();

// ── Release dialog ───────────────────────────────────────────────────────────

/** A finding of the release check; `lang` ties it to a language version (unticking that language drops it). */
export interface ReleaseCheck {
  readonly id: string;
  readonly item: string;
  readonly lang: ChangeLang | null;
  readonly field: string;
  readonly message: string;
}

export const RELEASE_WARNINGS: readonly ReleaseCheck[] = [
  {
    id: 'w1',
    item: 'Spring harvest arrives',
    lang: 'de',
    field: 'seo.description',
    message: 'Meta description is short: 38 characters, at least 50 recommended.',
  },
  {
    id: 'w2',
    item: 'Spring harvest arrives',
    lang: null,
    field: 'body[2].link',
    message: 'Links to “Barista championship recap”, which is not released yet — the link renders empty until it is.',
  },
];

export const RELEASE_ERRORS: readonly ReleaseCheck[] = [
  {
    id: 'e1',
    item: 'Spring harvest arrives',
    lang: 'en',
    field: 'teaserImage',
    message: 'The required field “Teaser image” is empty.',
  },
];

/** Unreleased assets the selection needs (released along unless unticked). */
export const RELEASE_DEPENDENCIES: readonly { readonly name: string; readonly via: string; readonly icon: string }[] = [
  { name: 'harvest-2026.jpg', via: 'Spring harvest arrives', icon: 'image' },
  { name: 'Rwanda Huye 250 g', via: 'Spring harvest arrives', icon: 'table_rows' },
];

// ── Schedules ────────────────────────────────────────────────────────────────

export type ScheduleKind = 'release' | 'unpublish' | 'generation';
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['release', 'unpublish', 'generation'];
export const SCHEDULE_KIND_ICONS: Readonly<Record<ScheduleKind, string>> = {
  release: 'publish',
  unpublish: 'cloud_off',
  generation: 'build',
};

export type ScheduleStatus = 'pending' | 'running' | 'succeeded' | 'paused' | 'cancelled';
export const SCHEDULE_STATUS_TONES: Readonly<Record<ScheduleStatus, SfStatusTone>> = {
  pending: 'info',
  running: 'accent',
  succeeded: 'success',
  paused: 'warning',
  cancelled: 'neutral',
};
export const SCHEDULE_STATUS_ICONS: Readonly<Record<ScheduleStatus, string>> = {
  pending: 'schedule',
  running: 'sync',
  succeeded: 'check_circle',
  paused: 'pause_circle',
  cancelled: 'block',
};

export interface SampleSchedule {
  readonly id: string;
  readonly kind: ScheduleKind;
  /** What it releases, unpublishes or builds. */
  readonly what: string;
  /** Minutes from now (negative: in the past). */
  readonly inMinutes: number;
  readonly zone: string;
  /** The repeat preset id, `null` = once. */
  readonly repeat: CronPresetId | null;
  readonly owner: ChangePerson;
  readonly status: ScheduleStatus;
  readonly thenGenerate?: boolean;
  /** Executions for the history drawer, newest first. */
  readonly history: readonly { readonly minutesAgo: number; readonly outcome: 'succeeded' | 'failed' | 'skipped'; readonly note: string }[];
}

export const SCHEDULES: readonly SampleSchedule[] = [
  {
    id: 's-holiday',
    kind: 'release',
    what: 'Holiday opening hours (DE, EN)',
    inMinutes: 18 * HOUR,
    zone: 'Europe/Berlin',
    repeat: null,
    owner: lukas,
    status: 'pending',
    thenGenerate: true,
    history: [],
  },
  {
    id: 's-nightly',
    kind: 'generation',
    what: 'Incremental build · Production',
    inMinutes: 9 * HOUR,
    zone: 'Europe/Berlin',
    repeat: 'daily',
    owner: jonas,
    status: 'pending',
    history: [
      { minutesAgo: 15 * HOUR, outcome: 'succeeded', note: 'Generation run #41 started.' },
      { minutesAgo: 39 * HOUR, outcome: 'succeeded', note: 'Generation run #38 started.' },
      { minutesAgo: 63 * HOUR, outcome: 'skipped', note: 'Waiting for run #35 to finish.' },
    ],
  },
  {
    id: 's-winter',
    kind: 'unpublish',
    what: 'Winter blend is back (DE, EN)',
    inMinutes: 3 * DAY,
    zone: 'Europe/Berlin',
    repeat: null,
    owner: mira,
    status: 'pending',
    history: [],
  },
  {
    id: 's-weekly-full',
    kind: 'generation',
    what: 'Full build · Production',
    inMinutes: 4 * DAY + 2 * HOUR,
    zone: 'Europe/Berlin',
    repeat: 'weekly',
    owner: jonas,
    status: 'paused',
    history: [{ minutesAgo: 3 * DAY, outcome: 'failed', note: 'Target “Production” could not be written: disk full.' }],
  },
  {
    id: 's-shop-sale',
    kind: 'release',
    what: '3 items',
    inMinutes: -2 * DAY,
    zone: 'America/New_York',
    repeat: null,
    owner: anna,
    status: 'succeeded',
    history: [{ minutesAgo: 2 * DAY, outcome: 'succeeded', note: 'Released in r412.' }],
  },
];

/** The repeat presets of the schedule dialog (`null` = once). `custom` shows the cron expression. */
export type CronPresetId = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';
export const CRON_PRESETS: readonly CronPresetId[] = ['hourly', 'daily', 'weekdays', 'weekly', 'custom'];

export const TIME_ZONES: readonly string[] = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Zurich',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

/** Items a release or unpublish schedule can name (the "what" picker). */
export const SCHEDULABLE_ITEMS: readonly string[] = [
  'Spring harvest arrives',
  'Barista championship recap',
  'Holiday opening hours',
  'Single origins',
  'Munich',
  'Yirgacheffe 250 g',
  'Winter blend is back',
];

export const BUILD_TARGETS: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'prod', name: 'Production' },
  { id: 'staging', name: 'Staging' },
];

/**
 * The next `count` run times of a schedule starting at `start` with `repeat` (once: just `start`). Custom cron isn't
 * parsed in the prototype: it previews like daily.
 */
export function nextRuns(start: Date, repeat: CronPresetId | null, count = 3): Date[] {
  if (repeat === null) {
    return [start];
  }
  const runs: Date[] = [];
  const at = new Date(start);
  while (runs.length < count) {
    const day = at.getDay();
    if (repeat !== 'weekdays' || (day !== 0 && day !== 6)) {
      runs.push(new Date(at));
    }
    if (repeat === 'hourly') {
      at.setHours(at.getHours() + 1);
    } else if (repeat === 'weekly') {
      at.setDate(at.getDate() + 7);
    } else {
      at.setDate(at.getDate() + 1);
    }
  }
  return runs;
}
