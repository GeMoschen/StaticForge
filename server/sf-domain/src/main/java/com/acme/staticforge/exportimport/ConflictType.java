package com.acme.staticforge.exportimport;

/**
 * Every distinct kind of import conflict this service can detect. Each constant maps to
 * exactly one fixed {@link ConflictSeverity} — no per-instance override — so client logic
 * ("disable Proceed if any BLOCKING") stays simple and the safety decision is centralized
 * here rather than scattered across call sites.
 */
public enum ConflictType {

    /**
     * The archive's protocol version is newer than this service supports. Subsumes the
     * blunt {@code SfException} historically thrown by {@code readArchive}/{@code
     * importProject} — same rejection, now expressed as a conflict entry so the UI can
     * render it in the same report list as everything else.
     */
    PROTOCOL_VERSION_MISMATCH(ConflictSeverity.BLOCKING),

    /**
     * An {@code ExportedAsset.uuid} that already exists as an asset in the *target*
     * project. Per M9's per-project unique constraint this is a real collision the
     * importer cannot resolve by silently minting a new UUID — doing so would sever the
     * cross-project identity M9 exists to preserve. Common when re-importing into the
     * same project an element was exported from; importing the same UUID into a
     * *different* project that doesn't already have it is not a conflict at all.
     */
    DUPLICATE_UUID(ConflictSeverity.BLOCKING),

    /**
     * An {@code ExportedAsset.templateUuid} that resolves to neither another asset in the
     * archive nor an existing asset (by UUID) in the target project.
     */
    MISSING_TEMPLATE_REFERENCE(ConflictSeverity.BLOCKING),

    /**
     * An {@code ExportedAsset.parentFolderUuid} not resolvable within the archive. Should
     * be prevented by the exporter's ancestor-chain rule for archives produced by this
     * system, but a hand-edited or third-party archive could still hit it — defense in
     * depth.
     */
    MISSING_PARENT_FOLDER(ConflictSeverity.BLOCKING),

    /**
     * An {@code ExportedChannel}/{@code ExportedGenerationTarget} key that already exists
     * in the target project. Will be skipped on import, not overwritten — surfaced as a
     * warning, not blocking, since skip is a safe default.
     */
    SETTINGS_KEY_COLLISION(ConflictSeverity.WARNING);

    private final ConflictSeverity severity;

    ConflictType(ConflictSeverity severity) {
        this.severity = severity;
    }

    public ConflictSeverity severity() {
        return severity;
    }
}
