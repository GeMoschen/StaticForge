package com.acme.staticforge.exportimport;

/**
 * Caller-chosen options for {@link ProjectExportImportService#importProject} and
 * {@link ProjectExportImportService#analyzeImport} (feature `selection-provenance`,
 * `M11.2.2`). An extensible options object rather than a raw boolean parameter, so future
 * import options don't accumulate as more boolean parameters on the service methods.
 *
 * @param skipExistingImplicit when {@code true}, a {@code DUPLICATE_UUID} collision on an
 *     asset that was only implicitly included in the archive (an ancestor folder pulled in
 *     to keep the {@code parentFolderUuid} chain intact, see {@link
 *     ExportedAsset#isExplicit()}) is resolved by reusing the existing target asset instead
 *     of minting a fresh UUID for a duplicate — and is omitted from {@link
 *     ProjectExportImportService#analyzeImport}'s reported conflicts. An asset the caller
 *     explicitly picked is never eligible for this, regardless of this flag.
 */
public record ImportOptions(boolean skipExistingImplicit) {

    /** Pre-M11 behavior: every collision mints a fresh UUID, no conflicts are suppressed. */
    public static final ImportOptions DEFAULT = new ImportOptions(false);
}
