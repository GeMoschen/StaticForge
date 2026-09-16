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
     * project, as the *same* {@code AssetType}. Not a hard conflict: the import always
     * wins for a same-UUID/same-type collision — the existing asset's content is
     * overwritten with a new version rather than the archive's copy being re-keyed onto
     * a freshly-minted UUID (the old, pre-M15.x behavior), so cross-project identity is
     * preserved for the common case of re-importing into the project an element was
     * exported from. Surfaced as a warning purely so the UI can tell the operator which
     * assets will be overwritten before they commit.
     */
    DUPLICATE_UUID(ConflictSeverity.WARNING),

    /**
     * An {@code ExportedAsset.uuid} that already exists as an asset in the *target*
     * project, but as a *different* {@code AssetType} than the archive declares. Unlike
     * a same-type {@link #DUPLICATE_UUID}, this can never be resolved by overwriting
     * (asset type is fixed for the lifetime of an asset — overwriting would mean
     * silently changing what kind of thing a UUID identifies) — genuinely blocking.
     */
    DUPLICATE_UUID_TYPE_MISMATCH(ConflictSeverity.BLOCKING),

    /**
     * An {@code ExportedAsset.templateUuid} that resolves to neither another asset in the
     * archive nor an existing asset (by UUID) in the target project.
     */
    MISSING_TEMPLATE_REFERENCE(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD} whose dataset ({@code ExportedAsset.templateUuid}) is neither in the archive
     * nor in the target project (M19.1.3). A record cannot exist without its schema.
     */
    RECORD_DATASET_MISSING(ConflictSeverity.BLOCKING),

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
    SETTINGS_KEY_COLLISION(ConflictSeverity.WARNING),

    /**
     * An {@code ExportedGenerationTarget.config.path} that is invalid, or whose output folder
     * would coincide with / nest in an existing target's (or an earlier imported target's)
     * folder. The target is still imported, but without {@code path}, so it publishes to its
     * collision-free {@code target-{id}} default — a warning, since that is a safe default.
     */
    TARGET_PATH_COLLISION(ConflictSeverity.WARNING);

    private final ConflictSeverity severity;

    ConflictType(ConflictSeverity severity) {
        this.severity = severity;
    }

    public ConflictSeverity severity() {
        return severity;
    }
}
