package com.acme.staticforge.revision;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.compaction.CompactedHistory;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Diff of the touched assets in a revision against {@code revision - 1}, computed with a
 * field-path JSON walker (spec §7.6). The set of touched assets is taken from the
 * revision's denormalized {@code summary}.
 *
 * <p>Compacted history (M29.4.3, epic decision 13): an asset whose version at {@code R} absorbed {@code R}, or whose
 * version at {@code R - 1} absorbed {@code R - 1}, can't be diffed exactly; it is returned with {@code compacted: true},
 * the summary's action and no field changes, and the diff carries {@link RevisionDiff#COMPACTED_MESSAGE}. Assets whose
 * versions around {@code R} are exact are diffed normally. A project never compacted, or a revision newer than
 * {@code compacted_through}, never pays for the check.
 */
@Service
public class DiffServiceImpl implements DiffService {

    private final RevisionRepository revisionRepository;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final CompactedHistory compactedHistory;

    public DiffServiceImpl(
            RevisionRepository revisionRepository,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            CompactedHistory compactedHistory) {
        this.revisionRepository = revisionRepository;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.compactedHistory = compactedHistory;
    }

    @Override
    @Transactional(readOnly = true)
    public RevisionDiff diff(long projectId, long revisionId) {
        Revision revision = revisionRepository
                .findByProjectIdAndRevisionId(projectId, revisionId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Revision not found.")));

        boolean mayBeCompacted = compactedHistory.mayBeCompacted(projectId, revisionId);
        List<AssetDiff> diffs = new ArrayList<>();
        JsonNode summary = revision.getSummary();
        if (summary != null && summary.has("assets")) {
            for (JsonNode entry : summary.get("assets")) {
                Optional<AssetDiff> assetDiff = diffEntry(projectId, entry, revisionId, mayBeCompacted);
                assetDiff.ifPresent(diffs::add);
            }
        }
        boolean compacted = revision.isCompacted() || diffs.stream().anyMatch(AssetDiff::compacted);
        return new RevisionDiff(projectId, revisionId, diffs, compacted, compacted ? RevisionDiff.COMPACTED_MESSAGE : null);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetDiff diffAsset(long projectId, UUID assetUuid, long from, Long to) {
        Asset asset = assetRepository
                .findByProjectIdAndUuid(projectId, assetUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        long target = to != null
                ? to
                : revisionRepository.findHeadRevisionId(projectId).orElseThrow(() -> revisionNotFound());
        for (long revision : new long[] {from, target}) {
            if (revisionRepository.findByProjectIdAndRevisionId(projectId, revision).isEmpty()) {
                throw revisionNotFound();
            }
        }
        Optional<AssetVersion> before = assetVersionRepository.findValidAtRevision(asset.getId(), from);
        Optional<AssetVersion> after = assetVersionRepository.findValidAtRevision(asset.getId(), target);
        if (compactedHistory.mayBeCompacted(projectId, Math.max(from, target))
                && (before.map(v -> v.isCompactedAt(from)).orElse(false)
                        || after.map(v -> v.isCompactedAt(target)).orElse(false))) {
            return new AssetDiff(asset.getUuid(), asset.getUid(), asset.getAssetType().name(), "UPDATE", List.of(), true);
        }
        return diffVerse(asset, before, after).orElseThrow();
    }

    private static SfException revisionNotFound() {
        return new SfException(ProblemFactory.notFound("Revision not found."));
    }

    private Optional<AssetDiff> diffEntry(long projectId, JsonNode entry, long revisionId, boolean mayBeCompacted) {
        String uuidText = entry.has("uuid") ? entry.get("uuid").asText() : null;
        if (uuidText == null || uuidText.isBlank()) {
            return Optional.empty();
        }
        UUID uuid;
        try {
            uuid = UUID.fromString(uuidText);
        } catch (IllegalArgumentException e) {
            return Optional.empty(); // non-asset summary entries (e.g. membership changes)
        }
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid).orElse(null);
        if (asset == null) {
            return Optional.empty();
        }

        Optional<AssetVersion> before = assetVersionRepository.findValidAtRevision(asset.getId(), revisionId - 1);
        Optional<AssetVersion> after = assetVersionRepository.findValidAtRevision(asset.getId(), revisionId);

        if (mayBeCompacted
                && (after.map(v -> v.isCompactedAt(revisionId)).orElse(false)
                        || before.map(v -> v.isCompactedAt(revisionId - 1)).orElse(false))) {
            String action = entry.path("action").isTextual() ? entry.get("action").asText() : "UPDATE";
            return Optional.of(new AssetDiff(
                    asset.getUuid(), asset.getUid(), asset.getAssetType().name(), action, List.of(), true));
        }
        return diffVerse(asset, before, after);
    }

    private Optional<AssetDiff> diffVerse(Asset asset, Optional<AssetVersion> before, Optional<AssetVersion> after) {
        boolean existedBefore = before.isPresent() && !before.get().isDeleted();
        boolean existsAfter = after.isPresent() && !after.get().isDeleted();

        String action;
        JsonNode beforePayload = null;
        JsonNode afterPayload = null;

        if (!existedBefore && existsAfter) {
            action = "CREATE";
            afterPayload = after.get().getPayload();
        } else if (existedBefore && !existsAfter) {
            action = "DELETE";
            beforePayload = before.get().getPayload();
        } else {
            action = "UPDATE";
            beforePayload = before.map(AssetVersion::getPayload).orElse(null);
            afterPayload = after.map(AssetVersion::getPayload).orElse(null);
        }

        List<FieldChange> changes = JsonDiffer.diff(beforePayload, afterPayload);
        AssetType type = asset.getAssetType();
        return Optional.of(new AssetDiff(asset.getUuid(), asset.getUid(), type.name(), action, changes));
    }
}
