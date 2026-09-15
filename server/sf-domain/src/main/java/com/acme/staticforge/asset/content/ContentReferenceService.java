package com.acme.staticforge.asset.content;

import com.acme.staticforge.asset.ReferenceKind;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Derives content references (spec §5.4, §14.3). {@link #extract} is a pure scanner: it walks a
 * content value for {@code MEDIA_REF}, {@code ASSET_REF} and internal or media {@code link} values
 * plus CATALOG card {@code templateRef}s. Persisting the resulting edges is
 * {@code ReferenceMaterializer}'s job, on the version write path.
 */
@Service
public class ContentReferenceService {

    /**
     * Pure scan of {@code content} (no lookups, no writes): every reference found, in document
     * order, with its source path rooted at {@code rootPath}. Values whose {@code uuid} is not a
     * well-formed UUID are skipped; duplicates are kept (callers deduplicate edges).
     */
    public List<ExtractedReference> extract(JsonNode content, String rootPath) {
        List<ExtractedReference> out = new ArrayList<>();
        scan(content, rootPath, out);
        return out;
    }

    private static void scan(JsonNode node, String path, List<ExtractedReference> out) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return;
        }
        if (node.isObject()) {
            ReferenceKind kind = referenceKind(node);
            String uuid = text(node, "uuid");
            if (kind != null && uuid != null) {
                add(out, kind, uuid, path);
                return;
            }
            // A CATALOG card (`{instanceId, templateRef, content}`) references its section
            // template by `templateRef`, not `uuid` — record that edge, then keep recursing so
            // refs nested in the card's own `content` are still picked up.
            String templateRef = text(node, "templateRef");
            if (templateRef != null && text(node, "instanceId") != null) {
                add(out, ReferenceKind.CONTENT_REF, templateRef, path + ".templateRef");
            }
            node.fields().forEachRemaining(entry -> scan(entry.getValue(), path + "." + entry.getKey(), out));
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                scan(node.get(i), path + "[" + i + "]", out);
            }
        }
    }

    private static void add(List<ExtractedReference> out, ReferenceKind kind, String uuid, String path) {
        UUID target = parseUuid(uuid);
        if (target != null) {
            out.add(new ExtractedReference(kind, target, path));
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
}
