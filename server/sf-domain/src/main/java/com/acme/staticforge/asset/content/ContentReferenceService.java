package com.acme.staticforge.asset.content;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Materializes content references into the {@code asset_reference} table (spec §5.4, §14.3).
 * Scans a content payload for {@code MEDIA_REF}, {@code ASSET_REF} and internal or media
 * {@code link} values, resolves each UUID to an asset and writes a deduplicated
 * {@link AssetReference} row per outgoing edge. Dangling UUIDs are skipped here — the
 * broken-link report handles them later.
 */
@Service
public class ContentReferenceService {

    private final AssetReferenceRepository references;
    private final AssetRepository assets;

    public ContentReferenceService(AssetReferenceRepository references, AssetRepository assets) {
        this.references = references;
        this.assets = assets;
    }

    /**
     * Recursively scans {@code content} for references and persists one {@link AssetReference}
     * row per unique {@code (toAssetId, kind, sourcePath)} edge. Returns the written references;
     * targets whose UUID does not resolve are skipped.
     */
    @Transactional
    public List<AssetReference> materialize(Long fromAssetId, Long validFromRevision, JsonNode content) {
        List<PendingReference> pending = new ArrayList<>();
        scan(content, "content", pending);

        List<AssetReference> written = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (PendingReference candidate : pending) {
            UUID uuid = parseUuid(candidate.uuid());
            if (uuid == null) {
                continue;
            }
            Asset target = assets.findByUuid(uuid).orElse(null);
            if (target == null) {
                continue;
            }
            String key = target.getId() + "|" + candidate.kind().name() + "|" + candidate.path();
            if (!seen.add(key)) {
                continue;
            }
            written.add(references.save(new AssetReference(
                    fromAssetId, validFromRevision, target.getId(), candidate.kind(), candidate.path())));
        }
        return written;
    }

    private static void scan(JsonNode node, String path, List<PendingReference> out) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return;
        }
        if (node.isObject()) {
            ReferenceKind kind = referenceKind(node);
            String uuid = text(node, "uuid");
            if (kind != null && uuid != null) {
                out.add(new PendingReference(kind, uuid, path));
                return;
            }
            // A CATALOG card (`{instanceId, templateRef, content}`) references its section
            // template by `templateRef`, not `uuid` — record that edge, then keep recursing so
            // refs nested in the card's own `content` are still picked up.
            String templateRef = text(node, "templateRef");
            if (templateRef != null && text(node, "instanceId") != null) {
                out.add(new PendingReference(ReferenceKind.CONTENT_REF, templateRef, path + ".templateRef"));
            }
            node.fields().forEachRemaining(entry -> scan(entry.getValue(), path + "." + entry.getKey(), out));
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                scan(node.get(i), path + "[" + i + "]", out);
            }
        }
    }

    private static ReferenceKind referenceKind(JsonNode node) {
        String type = text(node, "type");
        if ("MEDIA_REF".equals(type)) {
            return ReferenceKind.MEDIA_REF;
        }
        if ("ASSET_REF".equals(type)) {
            return ReferenceKind.CONTENT_REF;
        }
        String kind = text(node, "kind");
        if ("INTERNAL".equals(kind)) {
            return ReferenceKind.CONTENT_REF;
        }
        if ("MEDIA".equals(kind)) {
            return ReferenceKind.MEDIA_REF;
        }
        return null;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private static UUID parseUuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private record PendingReference(ReferenceKind kind, String uuid, String path) {}
}
