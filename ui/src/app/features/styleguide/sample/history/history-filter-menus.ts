import { HistoryFilterMenu, HistoryFilterSetters, HistoryFilterState, historyFilterMenus as menus } from '../../../history/history-filter-menus';
import { SampleText } from '../changes/sample-area.util';
import { HISTORY_PEOPLE } from './history-data';

export type { HistoryFilterMenu, HistoryFilterSetters, HistoryFilterState };
export { formatDateRange } from '../../../history/history-filter-menus';

/** The History filter menus of the app, with the sample's people as authors. */
export function historyFilterMenus(t: SampleText, state: HistoryFilterState, set: HistoryFilterSetters): HistoryFilterMenu[] {
  return menus(t, HISTORY_PEOPLE, state, set);
}
