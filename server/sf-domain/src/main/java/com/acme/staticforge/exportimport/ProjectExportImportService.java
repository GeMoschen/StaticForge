package com.acme.staticforge.exportimport;

import com.acme.staticforge.revision.RevisionContext;

/**
 * Project portability and migration path (spec §26.5): exports a project's current state to
 * a deterministic ZIP (assets JSON + content-addressed media blobs + a manifest) and imports
 * such an archive into a target project, assigning fresh UUIDv7s and recording import
 * provenance in {@code payload.origin} (§6.1).
 */
public interface ProjectExportImportService {

    /** The archive protocol version written and accepted by this implementation. */
    int PROTOCOL_VERSION = 1;

    /** Serializes the project's current assets and media blobs into a ZIP archive. */
    byte[] exportProject(long projectId);

    /**
     * Recreates the exported project's assets inside {@code targetProjectId}. Every asset
     * receives a fresh UUIDv7, {@code payload.origin} provenance, remapped references and a
     * UID that is re-derived to stay unique within the target project.
     */
    ImportResult importProject(long targetProjectId, byte[] zipBytes, RevisionContext ctx);
}
