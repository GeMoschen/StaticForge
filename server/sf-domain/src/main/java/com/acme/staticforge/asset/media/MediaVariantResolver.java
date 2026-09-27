package com.acme.staticforge.asset.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The variants of a media file (M29.3.2, epic decision 10): the variants stored in the version payload merged with the
 * derived variants of {@code media_variant} — the single rule every variant reader uses (binary serving and preview,
 * the media API, export, and generation through the snapshot).
 *
 * <p>A file's variants are its payload's {@code variants} (in stored order), followed by one entry per definition of
 * the <em>current</em> policy ({@code sf.media.variants}) that the payload has no variant of the same name for and
 * {@code media_variant} holds a row for (same source blob, name, width, format and quality). The payload wins on a
 * name, so old versions read exactly as before. Entries have the payload shape: {@code name}, {@code blobSha256},
 * {@code width}, {@code format}.
 *
 * <p>Rows of a definition that was removed from the policy (or changed its width, format or quality) are not
 * returned but not deleted either; the blob sweep keeps their blobs while the rows exist. Cleaning up such rows is a
 * follow-up.
 *
 * <p>Nothing here changes a stored payload: {@link #withVariants} returns a copy when it adds variants. Revision
 * reads stay byte-identical because {@code media_variant} lives outside the version payload.
 */
@Component
public class MediaVariantResolver {

    private final MediaVariantRepository rows;
    private final MediaProperties properties;

    public MediaVariantResolver(MediaVariantRepository rows, MediaProperties properties) {
        this.rows = rows;
        this.properties = properties;
    }

    /** The current policy's usable definitions. */
    public List<MediaVariantSpec> policy() {
        return MediaVariantSpec.policy(properties);
    }

    /** The merged variants of {@code file} (a payload's top-level file fields: {@code blobSha256}, {@code variants}). */
    public ArrayNode variantsFor(JsonNode file) {
        String sha = sourceSha(file);
        return merge(file, sha == null ? List.of() : rows.findBySourceShas(List.of(sha)).getOrDefault(sha, List.of()));
    }

    /**
     * The merged variants of {@code locale}'s file of {@code payload}, resolved along {@code chain} (see
     * {@link MediaFiles#fileFor}); media that isn't localized has one file.
     */
    public ArrayNode variantsFor(JsonNode payload, String locale, List<String> chain) {
        return variantsFor(MediaFiles.fileFor(payload, locale, chain).file());
    }

    /** {@code payload} with every file's variants merged (one query); see {@link #withVariants(JsonNode, Map)}. */
    public JsonNode withVariants(JsonNode payload) {
        return withVariants(payload, rowsFor(sourceShas(payload)));
    }

    /**
     * {@code payload} with the merged variants in the top-level file and in each {@code localeFiles} entry, given the
     * rows of its source blobs ({@link #rowsFor}). Returns {@code payload} itself when nothing is added, else a deep
     * copy — never the stored instance changed.
     */
    public JsonNode withVariants(JsonNode payload, Map<String, List<MediaVariantRepository.Row>> rowsBySource) {
        if (payload == null || !payload.isObject() || rowsBySource.isEmpty()) {
            return payload;
        }
        ObjectNode copy = null;
        ArrayNode top = mergedIfChanged(payload, rowsBySource);
        if (top != null) {
            copy = ((ObjectNode) payload).deepCopy();
            copy.set("variants", top);
        }
        for (String locale : MediaFiles.localeFileKeys(payload)) {
            JsonNode file = payload.path(MediaFiles.LOCALE_FILES).get(locale);
            ArrayNode merged = file == null || !file.isObject() ? null : mergedIfChanged(file, rowsBySource);
            if (merged != null) {
                if (copy == null) {
                    copy = ((ObjectNode) payload).deepCopy();
                }
                ((ObjectNode) copy.path(MediaFiles.LOCALE_FILES).get(locale)).set("variants", merged);
            }
        }
        return copy == null ? payload : copy;
    }

    /** The {@code media_variant} rows of {@code sourceShas}, grouped by source hash (one query per 500 hashes). */
    public Map<String, List<MediaVariantRepository.Row>> rowsFor(Collection<String> sourceShas) {
        return rows.findBySourceShas(sourceShas);
    }

    /** The source blobs of every file of a media payload (top-level and {@code localeFiles}); empty for other payloads. */
    public static Set<String> sourceShas(JsonNode payload) {
        Set<String> out = new LinkedHashSet<>();
        if (payload == null || !payload.isObject()) {
            return out;
        }
        addSha(out, payload);
        for (String locale : MediaFiles.localeFileKeys(payload)) {
            addSha(out, payload.path(MediaFiles.LOCALE_FILES).get(locale));
        }
        return out;
    }

    /** The merged list when rows add something to {@code file}'s variants, else {@code null}. */
    private ArrayNode mergedIfChanged(JsonNode file, Map<String, List<MediaVariantRepository.Row>> rowsBySource) {
        String sha = sourceSha(file);
        List<MediaVariantRepository.Row> fileRows = sha == null ? null : rowsBySource.get(sha);
        if (fileRows == null || fileRows.isEmpty()) {
            return null;
        }
        ArrayNode merged = merge(file, fileRows);
        JsonNode stored = file.get("variants");
        return merged.size() == (stored != null && stored.isArray() ? stored.size() : 0) ? null : merged;
    }

    private ArrayNode merge(JsonNode file, List<MediaVariantRepository.Row> fileRows) {
        ArrayNode out = JsonNodeFactory.instance.arrayNode();
        Set<String> names = new HashSet<>();
        JsonNode stored = file == null ? null : file.get("variants");
        if (stored != null && stored.isArray()) {
            for (JsonNode variant : stored) {
                out.add(variant.deepCopy());
                names.add(variant.path("name").asText());
            }
        }
        if (fileRows.isEmpty()) {
            return out;
        }
        List<MediaVariantRepository.Row> candidates = new ArrayList<>(fileRows);
        for (MediaVariantSpec spec : policy()) {
            if (names.contains(spec.name())) {
                continue;
            }
            candidates.stream()
                    .filter(row -> row.spec().equals(spec))
                    .findFirst()
                    .ifPresent(row -> {
                        out.add(MediaVariantGenerator.entry(spec, row.blobSha()));
                        names.add(spec.name());
                    });
        }
        return out;
    }

    private static String sourceSha(JsonNode file) {
        JsonNode sha = file == null ? null : file.get("blobSha256");
        return sha != null && sha.isTextual() && !sha.asText().isBlank() ? sha.asText() : null;
    }

    private static void addSha(Set<String> out, JsonNode file) {
        String sha = sourceSha(file);
        if (sha != null) {
            out.add(sha);
        }
    }
}
