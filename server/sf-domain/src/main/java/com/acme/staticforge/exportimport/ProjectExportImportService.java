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
    int PROTOCOL_VERSION = 1;

    /** Serializes the project's current assets and media blobs into a ZIP archive. */
    byte[] exportProject(long projectId);

    /**
     * Recreates the exported project's assets inside {@code targetProjectId}. Each asset
     * preserves its source UUID unless that UUID already exists in the target project, in which
     * case a fresh UUIDv7 is minted instead (feature `cross-project-import-identity`, `M9.3.1`);
     * every asset gets {@code payload.origin} provenance, remapped references and a UID that is
     * re-derived to stay unique within the target project.
     */
    ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx);
}
