package com.acme.staticforge.exportimport;

import com.acme.staticforge.urlregistry.UrlRegistryService;
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
 * @param importSchedules whether the archive's schedules are imported (M27.8.1)
 * @param urlRegistryMode how the archive's URL registry rows meet the target's (M32.6); {@code null} reads as
 *     {@code ARCHIVE_WINS}
 */
public record ImportOptions(
        boolean skipExistingImplicit,
        ReleaseMode releaseMode,
        boolean importSchedules,
        UrlRegistryService.ImportMode urlRegistryMode) {

    /** Pre-M11 behavior: every collision mints a fresh UUID, no conflicts are suppressed; release state kept. */
    public static final ImportOptions DEFAULT = new ImportOptions(false, ReleaseMode.KEEP, true);

    public ImportOptions {
        releaseMode = releaseMode == null ? ReleaseMode.KEEP : releaseMode;
        urlRegistryMode = urlRegistryMode == null ? UrlRegistryService.ImportMode.ARCHIVE_WINS : urlRegistryMode;
    }

    /** The given options, the archive's URLs winning over the target's computed ones ({@code ARCHIVE_WINS}). */
    public ImportOptions(boolean skipExistingImplicit, ReleaseMode releaseMode, boolean importSchedules) {
        this(skipExistingImplicit, releaseMode, importSchedules, null);
    }

    /** The given skip option and release mode, schedules imported. */
    public ImportOptions(boolean skipExistingImplicit, ReleaseMode releaseMode) {
        this(skipExistingImplicit, releaseMode, true);
    }

    /** The given skip option, release state kept, schedules imported. */
    public ImportOptions(boolean skipExistingImplicit) {
        this(skipExistingImplicit, ReleaseMode.KEEP);
    }
}
