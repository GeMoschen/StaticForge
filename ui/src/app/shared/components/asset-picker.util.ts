/** The asset types the picker's type switch can offer. */
export type PickerType = 'PAGE' | 'MEDIA' | 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE' | 'RECORD';

export const PICKER_TYPE_OPTIONS: { value: PickerType; label: string }[] = [
  { value: 'PAGE', label: 'Pages' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'PAGE_TEMPLATE', label: 'Page templates' },
  { value: 'SECTION_TEMPLATE', label: 'Section templates' },
  { value: 'RECORD', label: 'Records' },
];

/**
 * The type switch's options. A `dataset` restriction (a reference editor's `dataset "uid"`) means
 * records only; otherwise `allowedTypes` (its `assetTypes`) filters the list, and an unknown or empty
 * restriction offers everything.
 */
export function pickerTypeOptions(
  allowedTypes: readonly string[] | null | undefined,
  dataset: string | null | undefined,
): { value: PickerType; label: string }[] {
  if (dataset) {
    return PICKER_TYPE_OPTIONS.filter((t) => t.value === 'RECORD');
  }
  if (!allowedTypes || allowedTypes.length === 0) {
    return PICKER_TYPE_OPTIONS;
  }
  const filtered = PICKER_TYPE_OPTIONS.filter((t) => allowedTypes.includes(t.value));
  return filtered.length > 0 ? filtered : PICKER_TYPE_OPTIONS;
}

/** The datasets a record picker offers: only the restricted one when `dataset` names one. */
export function pickerDatasets<T extends { uid?: string }>(datasets: readonly T[], dataset: string | null | undefined): T[] {
  return dataset ? datasets.filter((d) => d.uid === dataset) : [...datasets];
}
