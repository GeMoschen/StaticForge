package com.acme.staticforge.revision;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Completes the {@code summary.assets[]} entries of revisions for display, at read time and in a constant number of
 * statements however many revisions are listed:
 *
 * <ul>
 *   <li>{@code name}: the item's display name as of the revision. New revisions carry it already (written with the
 *       summary); for older ones it is read from the item's version at that revision, falling back to its uid.
 *   <li>{@code locales}: the language codes whose content changed in that revision, derived from the item's versions
 *       before and after it (or taken from the entry's own {@code locale}, as release entries have it). Empty when the
 *       whole item was affected (delete, move, rename), when the entry is not a content change, or when the history
 *       was compacted so the change can no longer be told apart.
 * </ul>
 *
 * The stored summaries are never modified; the result holds copies.
 */
@Service
public class RevisionSummaryEnricher {

    /** Actions that write a new content version; only these have languages to derive from the payloads. */
    private static final Set<String> CONTENT_ACTIONS = Set.of("CREATE", "UPDATE", "RESTORE");

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public RevisionSummaryEnricher(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    /** The enriched copy of each revision's summary, by revision id. */
    @Transactional(readOnly = true)
    public Map<Long, JsonNode> enrich(long projectId, Collection<Revision> revisions) {
        Set<UUID> uuids = new HashSet<>();
        for (Revision revision : revisions) {
            for (JsonNode entry : assetsOf(revision)) {
                UUID uuid = uuidOf(entry);
                if (uuid != null) {
                    uuids.add(uuid);
                }
            }
        }
        Map<UUID, Asset> assets = new HashMap<>();
        Map<Long, List<AssetVersion>> versions = new HashMap<>();
        if (!uuids.isEmpty()) {
            assetRepository.findByProjectIdAndUuidIn(projectId, uuids).forEach(a -> assets.put(a.getUuid(), a));
            long first = revisions.stream().mapToLong(Revision::getRevisionId).min().orElse(0) - 1;
            long last = revisions.stream().mapToLong(Revision::getRevisionId).max().orElse(0);
            if (!assets.isEmpty()) {
                assetVersionRepository
                        .findValidBetween(assets.values().stream().map(Asset::getId).toList(), first, last)
                        .forEach(v -> versions.computeIfAbsent(v.getAssetId(), k -> new ArrayList<>()).add(v));
            }
        }

        Map<Long, JsonNode> out = new HashMap<>();
        for (Revision revision : revisions) {
            JsonNode stored = revision.getSummary();
            JsonNode copy = stored == null ? null : stored.deepCopy();
            if (copy != null && copy.path("assets").isArray()) {
                for (JsonNode entry : (ArrayNode) copy.get("assets")) {
                    if (entry.isObject()) {
                        complete((ObjectNode) entry, revision.getRevisionId(), assets, versions);
                    }
                }
            }
            out.put(revision.getRevisionId(), copy);
        }
        return out;
    }

    private static void complete(
            ObjectNode entry, long revisionId, Map<UUID, Asset> assets, Map<Long, List<AssetVersion>> versions) {
        UUID uuid = uuidOf(entry);
        Asset asset = uuid == null ? null : assets.get(uuid);
        AssetVersion after = asset == null ? null : validAt(versions.get(asset.getId()), revisionId);

        if (!entry.path("name").isTextual() || entry.get("name").asText().isBlank()) {
            String name = after != null ? after.getDisplayName() : null;
            if (name == null || name.isBlank()) {
                name = entry.path("uid").isTextual() ? entry.get("uid").asText() : asset != null ? asset.getUid() : null;
            }
            if (name != null) {
                entry.put("name", name);
            }
        }

        ArrayNode locales = entry.putArray("locales");
        String action = entry.path("action").asText("");
        String locale = entry.path("locale").asText("");
        if (!locale.isEmpty()) {
            locales.add(locale);
        } else if (CONTENT_ACTIONS.contains(action) && after != null && !after.isDeleted()) {
            AssetVersion before = validAt(versions.get(asset.getId()), revisionId - 1);
            JsonNode beforePayload = before == null || before.isDeleted() ? null : before.getPayload();
            ChangedLocales.between(beforePayload, after.getPayload()).forEach(locales::add);
        }
    }

    private static AssetVersion validAt(List<AssetVersion> versions, long revision) {
        if (versions == null) {
            return null;
        }
        for (AssetVersion v : versions) {
            if (v.getValidFromRevision() <= revision
                    && (v.getValidToRevision() == null || v.getValidToRevision() > revision)) {
                return v;
            }
        }
        return null;
    }

    private static JsonNode assetsOf(Revision revision) {
        JsonNode summary = revision.getSummary();
        JsonNode assets = summary == null ? null : summary.get("assets");
        return assets != null && assets.isArray() ? assets : MissingNode.getInstance();
    }

    private static UUID uuidOf(JsonNode entry) {
        try {
            String text = entry.path("uuid").asText(null);
            return text == null ? null : UUID.fromString(text);
        } catch (IllegalArgumentException e) {
            return null; // not an asset entry (e.g. a membership change)
        }
    }
}
