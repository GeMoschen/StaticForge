package com.acme.staticforge.structure;

import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.revision.RevisionContext;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * Structure domain operations (spec §17.1). A structure is an {@code AssetType.STRUCTURE}
 * asset whose version payload holds {@code { kind, sourceText, source (compiled AST),
 * channelTemplates }}. Every mutation parses + validates {@code sourceText} on save and routes
 * through the asset write path so revisioning stays intact.
 */
public interface StructureService {

    /** Creates a structure, parsing/validating {@code sourceText} and compiling each channel before persisting. */
    StructureView create(
            long projectId,
            UUID parentFolderUuid,
            String displayName,
            StructureKind kind,
            String sourceText,
            Map<String, String> channelSources,
            RevisionContext ctx);

    /** Applies a full state change, recompiling and re-validating source + channels. */
    StructureView update(
            UUID uuid,
            String displayName,
            String sourceText,
            Map<String, String> channelSources,
            long expectedRevision,
            RevisionContext ctx);

    /** The structure's current (open) version, or throws 404. */
    StructureView get(UUID uuid);

    /** Compiles and stores (or replaces) the OCTL source for a single channel. */
    StructureView saveChannel(UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx);

    /** Current-version summaries of structures within a project. */
    Page<AssetSummary> list(long projectId, Pageable pageable);
}
