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
 * @param releaseMode what happens to the archive's release state (M27.5.1); {@code null} reads as {@link
 *     ReleaseMode#KEEP}. An archive without release state (protocol {@code <= 7}) always imports as {@link
 *     ReleaseMode#DRAFT}.
 */
public record ImportOptions(boolean skipExistingImplicit, ReleaseMode releaseMode) {

    /** Pre-M11 behavior: every collision mints a fresh UUID, no conflicts are suppressed; release state kept. */
    public static final ImportOptions DEFAULT = new ImportOptions(false, ReleaseMode.KEEP);

    public ImportOptions {
        releaseMode = releaseMode == null ? ReleaseMode.KEEP : releaseMode;
    }

    /** The given skip option, release state kept. */
    public ImportOptions(boolean skipExistingImplicit) {
        this(skipExistingImplicit, ReleaseMode.KEEP);
    }
}
