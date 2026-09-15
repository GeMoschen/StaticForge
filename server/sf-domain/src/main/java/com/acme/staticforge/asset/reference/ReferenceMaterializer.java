package com.acme.staticforge.asset.reference;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.content.ContentReferenceService;
import com.acme.staticforge.asset.content.ExtractedReference;
import com.acme.staticforge.revision.RevisionAware;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Keeps {@code asset_reference} in step with version writes (spec §5.4, ADR-0003): every code
 * path that inserts an {@link AssetVersion} calls this in the same transaction and with the same
 * revision, so the open rows of an asset are always exactly the edges derived from its current
 * version, and closed rows carry the revision the edge stopped being valid at.
 *
 * <p>Edges derived per asset type:
 * <ul>
 *   <li>{@code PAGE}: {@code templateRef} and each body section's {@code templateRef} as
 *       {@link ReferenceKind#TEMPLATE}; content and section-content values via
 *       {@link ContentReferenceService#extract} ({@code MEDIA_REF}/{@code CONTENT_REF}).</li>
 *   <li>{@code PAGE_REFERENCE}: its {@code target.assetUuid} as {@link ReferenceKind#NAV}.</li>
 *   <li>{@code MEDIA}, {@code FOLDER}: none.</li>
 * </ul>
 *
 * <p>The write is a per-edge diff rather than close-all-then-insert-all: an edge present in both
 * the open rows and the new edge set keeps its open row untouched, so a move or a payload edit
 * that doesn't change references writes nothing. A row that would be closed in the revision it
 * was opened in is deleted instead, and an edge closed earlier in the same revision is re-opened
 * rather than duplicated — a compound revision ({@code M15}) touching one asset twice never
 * leaves zero-length intervals behind. Target UUIDs that don't resolve to an asset of the project
 * are skipped (the broken-link report is a separate concern).
 */
@Service
@RevisionAware
public class ReferenceMaterializer {

    private final AssetReferenceRepository references;
    private final AssetRepository assets;
    private final ContentReferenceService contentReferences;

    public ReferenceMaterializer(
            AssetReferenceRepository references, AssetRepository assets, ContentReferenceService contentReferences) {
        this.references = references;
        this.assets = assets;
        this.contentReferences = contentReferences;
    }

    /**
     * Syncs the outgoing edges of {@code asset} with {@code version}, a version just written at
     * {@code version.getValidFromRevision()}: a deleted version has no outgoing edges.
     */
    public void materialize(Asset asset, AssetVersion version) {
        if (version.isDeleted()) {
            closeOutgoing(asset.getId(), version.getValidFromRevision());
        } else {
            replaceOutgoing(
                    asset.getProjectId(), asset.getId(), version.getValidFromRevision(), asset.getAssetType(),
                    version.getPayload());
        }
    }

    /** Replaces the open outgoing edges of {@code fromAssetId} with those derived from {@code payload}. */
    public void replaceOutgoing(long projectId, long fromAssetId, long revisionId, AssetType type, JsonNode payload) {
        apply(fromAssetId, revisionId, extract(projectId, type, payload));
    }

    /** Closes every open outgoing edge of {@code fromAssetId} at {@code revisionId} (soft delete). */
    public void closeOutgoing(long fromAssetId, long revisionId) {
        apply(fromAssetId, revisionId, Set.of());
    }

    /**
     * The deduplicated edge set derived from a payload of the given asset type, with target UUIDs
     * resolved to asset ids in one lookup; unresolvable targets are dropped. No writes.
     */
    public Set<ReferenceEdge> extract(long projectId, AssetType type, JsonNode payload) {
        List<ExtractedReference> found = payload == null || payload.isNull() ? List.of() : switch (type) {
            case PAGE -> pageReferences(payload);
            case PAGE_REFERENCE -> navigationReferences(payload);
            case PAGE_TEMPLATE, SECTION_TEMPLATE, MEDIA, FOLDER -> List.of();
        };
        if (found.isEmpty()) {
            return Set.of();
        }

        Set<UUID> targets = new LinkedHashSet<>();
        found.forEach(ref -> targets.add(ref.target()));
        Map<UUID, Long> idsByUuid = new HashMap<>();
        for (Asset target : assets.findByProjectIdAndUuidIn(projectId, targets)) {
            idsByUuid.put(target.getUuid(), target.getId());
        }

        Set<ReferenceEdge> edges = new LinkedHashSet<>();
        for (ExtractedReference ref : found) {
            Long toAssetId = idsByUuid.get(ref.target());
            if (toAssetId != null) {
                edges.add(new ReferenceEdge(toAssetId, ref.kind(), ref.sourcePath()));
            }
        }
        return edges;
    }

    private List<ExtractedReference> pageReferences(JsonNode payload) {
        List<ExtractedReference> found = new ArrayList<>();
        addTemplate(found, payload.get("templateRef"), "templateRef");
        found.addAll(contentReferences.extract(payload.get("content"), "content"));

        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.fields().forEachRemaining(body -> {
                JsonNode sections = body.getValue();
                if (sections == null || !sections.isArray()) {
                    return;
                }
                for (int i = 0; i < sections.size(); i++) {
                    JsonNode section = sections.get(i);
                    String path = "bodies." + body.getKey() + "[" + i + "]";
                    addTemplate(found, section.get("templateRef"), path + ".templateRef");
                    found.addAll(contentReferences.extract(section.get("content"), path + ".content"));
                }
            });
        }
        return found;
    }

    private static List<ExtractedReference> navigationReferences(JsonNode payload) {
        UUID target = parseUuid(payload.path("target").get("assetUuid"));
        return target == null ? List.of() : List.of(new ExtractedReference(ReferenceKind.NAV, target, "target"));
    }

    private static void addTemplate(List<ExtractedReference> found, JsonNode templateRef, String path) {
        UUID target = parseUuid(templateRef);
        if (target != null) {
            found.add(new ExtractedReference(ReferenceKind.TEMPLATE, target, path));
        }
    }

    private void apply(long fromAssetId, long revisionId, Set<ReferenceEdge> edges) {
        Set<ReferenceEdge> missing = new LinkedHashSet<>(edges);
        for (AssetReference open : references.findByFromAssetIdAndValidToRevisionIsNull(fromAssetId)) {
            if (missing.remove(ReferenceEdge.of(open))) {
                continue;
            }
            if (Objects.equals(open.getValidFromRevision(), revisionId)) {
                references.delete(open);
            } else {
                open.setValidToRevision(revisionId);
                references.save(open);
            }
        }
        if (missing.isEmpty()) {
            return;
        }
        for (AssetReference closed : references.findByFromAssetIdAndValidToRevision(fromAssetId, revisionId)) {
            if (missing.remove(ReferenceEdge.of(closed))) {
                closed.setValidToRevision(null);
                references.save(closed);
            }
        }
        for (ReferenceEdge edge : missing) {
            references.save(new AssetReference(fromAssetId, revisionId, edge.toAssetId(), edge.kind(), edge.sourcePath()));
        }
    }

    private static UUID parseUuid(JsonNode value) {
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value.asText());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
