package com.acme.staticforge.exportimport;

import com.acme.staticforge.revision.RevisionContext;

/**
 * Project portability and migration path (spec §26.5): exports a project's current state to
 * a deterministic ZIP (assets JSON + content-addressed media blobs + a manifest) and imports
 * such an archive into a target project, preserving each asset's source UUID by default and
 * recording import provenance in {@code payload.origin} (§6.1).
 */
public interface ProjectExportImportService {

    /**
     * The archive protocol version written and accepted by this implementation.
     *
     * <p>Bumped to {@code 4} by M17: archives can now carry {@code GLOBAL_SET} assets, and an
     * older server reading one would blow up inside {@code AssetType.valueOf} half-way through an
     * import. A version mismatch is reported as a clean conflict instead, so the cost — an old
     * server also refusing a new archive that happens to contain no property sets — buys a
     * predictable failure in place of a partial one.
     *
     * <p>Bumped to {@code 5} by M19 for the same reason: archives can carry {@code DATASET} and
     * {@code RECORD} assets. The file layout itself is unchanged.
     *
     * <p>Bumped to {@code 7} by M25: archives can carry {@code RECORD_SET} assets, and a record's
     * {@code parentFolderUuid} now names its record set — the containment rule changed how an archive must be
     * read. An older server would place such a record under a set it can't read; this one reads a protocol
     * {@code <= 6} archive's records (which sit in Content folders) as {@code RECORD_OUTSIDE_RECORD_SET} and
     * imports everything else. The file layout itself is unchanged.
     *
     * <p>Bumped to {@code 8} by M27: each asset file carries its open release pointers ({@link ExportedRelease}, with
     * the released version's content where it differs from the draft), deletion-pending assets are exported as
     * tombstones with their released versions, and a localized media asset's per-locale files travel as blobs. An
     * archive of protocol {@code <= 7} has no release state and imports as drafts ({@link ReleaseMode#DRAFT}).
     */
    int PROTOCOL_VERSION = 8;

    /** The first protocol whose archives carry release state (M27.5.1). */
    int RELEASE_STATE_PROTOCOL = 8;

    /**
     * Serializes every one of the project's current assets and media blobs into a ZIP
     * archive. A thin convenience over {@link #exportSelection}: delegates with a
     * selection that means "everything" (every current asset UUID, both settings flags
     * {@code true}), so its output is unaffected by selective-export support.
     */
    byte[] exportProject(long projectId);

    /**
     * Serializes the {@code selection} of the project's current assets (and any media
     * blobs they reference) into a ZIP archive. Picking a folder UUID in {@link
     * ExportSelection#assetUuids()} pulls in that folder's live descendants transitively;
     * every ancestor folder of an included asset is always included too, up to the
     * project root, so imported {@code parentFolderUuid} chains never break. A selected
     * asset's own template reference is never auto-included (feature
     * `selective-export`, `M10.1.1`) — that's left for `M10.2`'s conflict detection to
     * surface on import. Exceptions are the implicit picks an asset can't exist without: a page
     * template's parent chain (`M20`), a record's dataset (`M19`), and — since `M25` — a record's
     * record set and a set's dataset. Picking a record set is a container pick like a folder: its
     * live records are exported with it.
     */
    byte[] exportSelection(long projectId, ExportSelection selection);

    /**
     * Recreates the exported project's assets inside {@code targetProjectId}. Every asset keeps
     * its source UUID (feature `cross-project-import-identity`, `M9.3.1`) — an asset whose UUID
     * doesn't yet exist in the target is created; one whose UUID already exists there as the
     * *same* {@code AssetType} is overwritten with a new version of the archive's content (the
     * import always wins); one that already exists as a *different* type is a
     * {@code DUPLICATE_UUID_TYPE_MISMATCH} conflict that blocks the whole import. Every created
     * or overwritten asset gets {@code payload.origin} provenance and remapped references.
     * {@code options.skipExistingImplicit()} (feature `selection-provenance`, `M11.2.2`) changes
     * only how a same-type collision on a non-explicit (ancestor-only) asset is resolved — see
     * {@link ImportOptions}.
     */
    ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx, ImportOptions options);

    /**
     * Read-only analysis pass: parses the archive and checks it against {@code
     * targetProjectId}, returning every {@link ImportConflict} found (protocol mismatch,
     * duplicate UUIDs, missing template/parent-folder references, settings-key
     * collisions). Performs zero writes — safe to call speculatively before deciding
     * whether to commit via {@link #importProject}, which independently re-runs the same
     * conflict detection and refuses to proceed past a {@link ConflictSeverity#BLOCKING}
     * conflict regardless of whether the caller analyzed first.
     */
    ConflictReport analyzeImport(long targetProjectId, byte[] zipBytes, ImportOptions options);
}
