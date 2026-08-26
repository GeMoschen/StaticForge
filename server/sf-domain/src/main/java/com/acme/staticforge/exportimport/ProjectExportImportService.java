package com.acme.staticforge.exportimport;

import com.acme.staticforge.revision.RevisionContext;

/**
 * Project portability and migration path (spec §26.5): exports a project's current state to
 * a deterministic ZIP (assets JSON + content-addressed media blobs + a manifest) and imports
 * such an archive into a target project, preserving each asset's source UUID by default and
 * recording import provenance in {@code payload.origin} (§6.1).
 */
public interface ProjectExportImportService {

    /** The archive protocol version written and accepted by this implementation. */
    int PROTOCOL_VERSION = 2;

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
     * surface on import.
     */
    byte[] exportSelection(long projectId, ExportSelection selection);

    /**
     * Recreates the exported project's assets inside {@code targetProjectId}. Each asset
     * preserves its source UUID unless that UUID already exists in the target project, in which
     * case a fresh UUIDv7 is minted instead (feature `cross-project-import-identity`, `M9.3.1`);
     * every asset gets {@code payload.origin} provenance, remapped references and a UID that is
     * re-derived to stay unique within the target project.
     */
    ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx);

    /**
     * Read-only analysis pass: parses the archive and checks it against {@code
     * targetProjectId}, returning every {@link ImportConflict} found (protocol mismatch,
     * duplicate UUIDs, missing template/parent-folder references, settings-key
     * collisions). Performs zero writes — safe to call speculatively before deciding
     * whether to commit via {@link #importProject}, which independently re-runs the same
     * conflict detection and refuses to proceed past a {@link ConflictSeverity#BLOCKING}
     * conflict regardless of whether the caller analyzed first.
     */
    ConflictReport analyzeImport(long targetProjectId, byte[] zipBytes);
}
