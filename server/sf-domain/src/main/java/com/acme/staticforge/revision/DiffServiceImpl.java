package com.acme.staticforge.revision;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
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
 */
@Service
public class DiffServiceImpl implements DiffService {

    private final RevisionRepository revisionRepository;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public DiffServiceImpl(
            RevisionRepository revisionRepository,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository) {
        this.revisionRepository = revisionRepository;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public RevisionDiff diff(long projectId, long revisionId) {
        Revision revision = revisionRepository
                .findByProjectIdAndRevisionId(projectId, revisionId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Revision not found.")));

        List<AssetDiff> diffs = new ArrayList<>();
        JsonNode summary = revision.getSummary();
        if (summary != null && summary.has("assets")) {
            for (JsonNode entry : summary.get("assets")) {
                Optional<AssetDiff> assetDiff = diffEntry(projectId, entry, revisionId);
                assetDiff.ifPresent(diffs::add);
            }
        }
        return new RevisionDiff(projectId, revisionId, diffs);
    }

    private Optional<AssetDiff> diffEntry(long projectId, JsonNode entry, long revisionId) {
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
