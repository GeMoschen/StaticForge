package com.acme.staticforge.exportimport;

/**
 * Every distinct kind of import conflict this service can detect. Each constant maps to
 * exactly one fixed {@link ConflictSeverity} — no per-instance override — so client logic
 * stays simple and the safety decision is centralized here rather than scattered across call
 * sites.
 *
 * <p>A {@link ConflictSeverity#BLOCKING} conflict blocks the whole import ({@link #blocksImport()}),
 * except for the few types that only <em>reject their own asset</em> ({@link #rejectsAssetOnly()},
 * M25): that asset is never imported, and the rest of the archive imports as usual. The only such type
 * is {@link #RECORD_OUTSIDE_RECORD_SET} — epic M25 decision 8 rejects those records without refusing the
 * pages, templates, datasets and media of the same (pre-M25) archive.
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
     * The archive's content languages differ from the target project's (M24.5.1). Not blocking:
     * values for a language the target doesn't declare are kept (they become orphaned translations,
     * and re-adding the language restores them), and a language the target has but the archive
     * doesn't simply starts untranslated. The message names both sides so the operator can decide.
     */
    LOCALE_CONFIG_MISMATCH(ConflictSeverity.WARNING),

    /**
     * The archive's quality rule configuration names rules this server doesn't know (M30.1.2): their settings are
     * dropped, every other rule's configuration is imported. The message names the codes.
     */
    UNKNOWN_QUALITY_RULE(ConflictSeverity.WARNING),

    /**
     * An imported asset carries language-dependent values but the target project has no languages
     * (or the other way round) (M24.5.1). The payload is imported as it is; the next template save
     * or language change migrates its shape, so exactly one migration implementation exists.
     */
    LOCALIZATION_SHAPE_MISMATCH(ConflictSeverity.WARNING),

    /**
     * An {@code ExportedAsset.templateUuid} that resolves to neither another asset in the
     * archive nor an existing asset (by UUID) in the target project.
     */
    MISSING_TEMPLATE_REFERENCE(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD} whose dataset ({@code ExportedAsset.templateUuid}) is neither in the archive nor in
     * the target project (M19.1.3). A record can't exist without its schema.
     */
    RECORD_DATASET_MISSING(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD_SET} (M25) whose dataset ({@code payload.datasetRef}, mirrored in {@code
     * ExportedAsset.templateUuid}) is neither in the archive nor in the target project. A set defines the
     * type of its records; it can't exist without its schema.
     */
    RECORD_SET_DATASET_MISSING(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD} whose record set (its {@code parentFolderUuid}) is neither in the archive nor a live
     * set of the target project (M25). Only reachable with a hand-edited archive: the exporter always
     * includes a record's set.
     */
    RECORD_SET_MISSING(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD} whose {@code datasetRef} differs from its record set's, or a {@code RECORD_SET} that
     * would overwrite an existing target set of another dataset (M25). A record only lives in a set of its
     * own dataset, and a set's dataset never changes.
     */
    RECORD_SET_DATASET_MISMATCH(ConflictSeverity.BLOCKING),

    /**
     * A {@code RECORD} whose archive parent is the Content store root or a Content folder instead of a
     * record set — every record of a pre-M25 archive (protocol 6 and older). Epic M25 decision 8: such a
     * record is never migrated or grouped into a set. It is rejected — not imported — while the rest of the
     * archive imports ({@link #rejectsAssetOnly()}).
     */
    RECORD_OUTSIDE_RECORD_SET(ConflictSeverity.BLOCKING, true),

    /**
     * A {@code RECORD_SET} whose stored query does not validate against the schema of the dataset it will
     * belong to in the target — the archive's dataset, or the target's existing one when that is reused
     * (M25). The set is imported with its query untouched; it reads {@code queryValid: false} and selects
     * nothing until an editor fixes the query.
     */
    RECORD_SET_QUERY_INVALID(ConflictSeverity.WARNING),

    /**
     * A {@code PAGE_TEMPLATE} whose {@code parentTemplateRef} is neither in the archive nor in the target project
     * (M20). A template that extends can't compile or render without its parent.
     */
    PARENT_TEMPLATE_MISSING(ConflictSeverity.BLOCKING),

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
    TARGET_PATH_COLLISION(ConflictSeverity.WARNING),

    /**
     * An asset released in a locale the target project doesn't have (M27.5.1): a locale code the target doesn't
     * declare, or any locale code when the target has no languages. The asset imports; that pointer is dropped, so
     * the asset is {@code NEW} in that locale.
     */
    RELEASE_LOCALE_MISSING(ConflictSeverity.WARNING),

    /**
     * The archive predates release state (protocol {@code <= 7}, M27.5.1): everything imports as a draft, whatever
     * release mode was asked for.
     */
    ARCHIVE_WITHOUT_RELEASE_STATE(ConflictSeverity.INFO),

    /**
     * A schedule of the archive has the identity of one in the target project (M27.8.1): an open one is replaced in
     * place, keeping its id and history — the import wins, as for assets; one that executes or has finished is left
     * alone, and the archive's copy is not imported.
     */
    DUPLICATE_SCHEDULE(ConflictSeverity.WARNING),

    /** A one-off schedule whose time has passed by the import (M27.8.1): not imported, so nothing fires late. */
    SCHEDULE_OVERDUE(ConflictSeverity.WARNING),

    /**
     * The generation target a schedule builds to is neither in the archive nor in the target project, or was deleted
     * before the export (M27.8.1): the schedule is not imported.
     */
    SCHEDULE_TARGET_MISSING(ConflictSeverity.WARNING),

    /**
     * A schedule fails the checks a new schedule gets (M27.8.1) — an asset or locale it works on is missing, a pinned
     * version is incomplete, a channel is disabled, a scheduled deletion imported as draft: not imported. The detail
     * names the {@code SF-DOM} code where there is one.
     */
    SCHEDULE_INVALID(ConflictSeverity.WARNING),

    /**
     * The owner of a schedule has no account in the target, or may not own it there (M27.8.1): the importing user
     * becomes its owner.
     */
    SCHEDULE_OWNER_REPLACED(ConflictSeverity.WARNING),

    /**
     * The target project already redirects the source path of an archived redirect in the same channel and locale
     * (M30.4.1), or the archive redirects it twice: the target's redirect (or the archive's first one) is kept, the
     * archive's is not imported.
     */
    REDIRECT_SOURCE_EXISTS(ConflictSeverity.WARNING),

    /**
     * An archived redirect doesn't fit the target project (M30.4.1): its channel or language doesn't exist there, or
     * its paths are malformed. It is not imported.
     */
    REDIRECT_INVALID(ConflictSeverity.WARNING),

    /**
     * An archived URL registry row names an output whose URL the target project set manually (M32.6, import mode
     * {@code ARCHIVE_WINS}): the target's override is kept, the archive's row is not imported.
     */
    URL_OVERRIDE_KEPT(ConflictSeverity.WARNING),

    /** An archived URL registry row's URL belongs to another output in the target project (M32.6). Not imported. */
    URL_TAKEN(ConflictSeverity.WARNING),

    /**
     * An archived URL registry row doesn't fit the target project (M32.6): its channel or language doesn't exist there,
     * or its asset isn't imported. It is not imported.
     */
    URL_INVALID(ConflictSeverity.WARNING);

    private final ConflictSeverity severity;
    private final boolean rejectsAssetOnly;

    ConflictType(ConflictSeverity severity) {
        this(severity, false);
    }

    ConflictType(ConflictSeverity severity, boolean rejectsAssetOnly) {
        this.severity = severity;
        this.rejectsAssetOnly = rejectsAssetOnly;
    }

    public ConflictSeverity severity() {
        return severity;
    }

    /** {@code true} when this blocking type rejects only the asset it names; the rest of the archive imports. */
    public boolean rejectsAssetOnly() {
        return rejectsAssetOnly;
    }

    /** {@code true} when a conflict of this type refuses the whole import. */
    public boolean blocksImport() {
        return severity == ConflictSeverity.BLOCKING && !rejectsAssetOnly;
    }
}
