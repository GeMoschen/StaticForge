import { SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SampleText } from '../changes/sample-area.util';
import {
  HISTORY_KINDS,
  HISTORY_KIND_ICONS,
  HISTORY_PEOPLE,
  HistoryDateFilter,
  HistoryKind,
  NO_DATE_FILTER,
} from './history-data';

/** What the History filter bar (drawer and full page) filters by, besides the search. */
export interface HistoryFilterState {
  readonly by: string | null;
  readonly kind: HistoryKind | null;
  readonly date: HistoryDateFilter;
}

export interface HistoryFilterMenu {
  readonly id: 'by' | 'kind' | 'range';
  /** The menu's accessible name. */
  readonly name: string;
  /** The trigger text: the name, or "Name: pick". */
  readonly text: string;
  readonly items: SfMenuItem[];
}

export interface HistoryFilterSetters {
  by(value: string | null): void;
  kind(value: HistoryKind | null): void;
  date(value: HistoryDateFilter): void;
  /** *Custom range…*: the host opens its range dialog. */
  custom(): void;
}

/** "1 Sep – 30 Sep", "from 1 Sep", "until 30 Sep". */
export function formatDateRange({ from, to }: HistoryDateFilter, t: SampleText): string {
  const show = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (from && to) {
    return `${show(from)} – ${show(to)}`;
  }
  return from ? t('ranges.from', { date: show(from) }) : t('ranges.until', { date: show(to ?? '') });
}

/**
 * The three filter menus of the History bar — author, type (each type with its icon) and date (today, last 7 days, last
 * 30 days or a **custom range**). The chosen entry is named in the trigger and marked "Selected" in the list.
 */
export function historyFilterMenus(t: SampleText, state: HistoryFilterState, set: HistoryFilterSetters): HistoryFilterMenu[] {
  const any = (picked: boolean, action: () => void): SfMenuItem => ({
    id: '',
    label: t('filters.any'),
    icon: picked ? undefined : 'check',
    action,
  });
  const selected = t('filters.selected');

  const byName = t('filters.by');
  const author = HISTORY_PEOPLE.find((p) => p.id === state.by);

  const kindName = t('filters.kind');

  const rangeName = t('filters.range');
  const presets = ['today', 'week', 'month'] as const;
  const date = state.date;
  const rangeText = date.range === 'any' ? null : date.range === 'custom' ? formatDateRange(date, t) : t(`ranges.${date.range}`);

  return [
    {
      id: 'by',
      name: byName,
      text: author ? t('filters.picked', { filter: byName, value: author.name }) : byName,
      items: [
        any(author !== undefined, () => set.by(null)),
        ...HISTORY_PEOPLE.map((p, i) => ({
          id: p.id,
          label: p.name,
          icon: p.id === state.by ? 'check' : undefined,
          separatorBefore: i === 0,
          action: () => set.by(p.id),
        })),
      ],
    },
    {
      id: 'kind',
      name: kindName,
      text: state.kind ? t('filters.picked', { filter: kindName, value: t(`kinds.${state.kind}`) }) : kindName,
      items: [
        any(state.kind !== null, () => set.kind(null)),
        ...HISTORY_KINDS.map((k, i) => ({
          id: k,
          label: t(`kinds.${k}`),
          icon: HISTORY_KIND_ICONS[k],
          description: k === state.kind ? selected : undefined,
          separatorBefore: i === 0,
          action: () => set.kind(k),
        })),
      ],
    },
    {
      id: 'range',
      name: rangeName,
      text: rangeText ? t('filters.picked', { filter: rangeName, value: rangeText }) : rangeName,
      items: [
        any(date.range !== 'any', () => set.date(NO_DATE_FILTER)),
        ...presets.map((r, i) => ({
          id: r,
          label: t(`ranges.${r}`),
          icon: date.range === r ? 'check' : undefined,
          separatorBefore: i === 0,
          action: () => set.date({ range: r, from: null, to: null }),
        })),
        {
          id: 'custom',
          label: t('ranges.custom'),
          icon: 'date_range',
          description: date.range === 'custom' ? formatDateRange(date, t) : undefined,
          separatorBefore: true,
          action: () => set.custom(),
        },
      ],
    },
  ];
}
