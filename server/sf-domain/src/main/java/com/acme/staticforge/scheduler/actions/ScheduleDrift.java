package com.acme.staticforge.scheduler.actions;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.release.Chunks;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.scheduler.ActionDescription;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.PinPolicy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The items of scheduled releases as they stand now (M27.4.2, epic decision 22): each item's current release status
 * and, for a pinned release, whether its draft changed since it was scheduled ("draft changed since scheduled" — the
 * pinned version is still what goes live; re-pin to take the newer draft). One bulk lookup per project for any number
 * of actions.
 */
@Component
public class ScheduleDrift {

    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final ReleaseStatusService statuses;

    public ScheduleDrift(AssetRepository assets, AssetVersionRepository versions, ReleaseStatusService statuses) {
        this.assets = assets;
        this.versions = versions;
        this.statuses = statuses;
    }

    /** The description of one action. */
    @Transactional(readOnly = true)
    public ActionDescription forAction(ActionSpec spec) {
        return forActions(List.of(spec)).getOrDefault(spec.actionId(), ActionDescription.NONE);
    }

    /** The description of each action, keyed by action id. */
    @Transactional(readOnly = true)
    public Map<Long, ActionDescription> forActions(List<ActionSpec> specs) {
        Map<Long, ActionDescription> out = new LinkedHashMap<>();
        Map<Long, List<ActionSpec>> byProject = new LinkedHashMap<>();
        specs.forEach(s -> byProject.computeIfAbsent(s.projectId(), p -> new ArrayList<>()).add(s));
        byProject.forEach((projectId, ofProject) -> describe(projectId, ofProject, out));
        return out;
    }

    private void describe(long projectId, List<ActionSpec> specs, Map<Long, ActionDescription> out) {
        Set<UUID> uuids = new LinkedHashSet<>();
        specs.forEach(s -> ReleaseStateActionHandler.StoredItem.parse(s.params()).forEach(i -> uuids.add(i.assetUuid())));
        List<Asset> found = Chunks.flatMap(uuids, chunk -> assets.findByProjectIdAndUuidIn(projectId, chunk));
        Map<UUID, Asset> assetByUuid = new HashMap<>();
        found.forEach(a -> assetByUuid.put(a.getUuid(), a));
        Map<Long, AssetVersion> openByAsset = new HashMap<>();
        List<AssetVersion> open = Chunks.flatMap(
                found.stream().map(Asset::getId).toList(), versions::findOpenWithAssetByAssetIdIn);
        open.forEach(v -> openByAsset.put(v.getAssetId(), v));
        Map<Long, Map<String, LocaleRelease>> status = statuses.ofVersions(projectId, open);

        for (ActionSpec spec : specs) {
            boolean pinned = spec.pinPolicy() == PinPolicy.PINNED;
            int drift = 0;
            List<ActionDescription.Item> items = new ArrayList<>();
            for (ReleaseStateActionHandler.StoredItem item : ReleaseStateActionHandler.StoredItem.parse(spec.params())) {
                Asset asset = assetByUuid.get(item.assetUuid());
                AssetVersion draft = asset == null ? null : openByAsset.get(asset.getId());
                Boolean changed = null;
                if (pinned) {
                    changed = draft == null
                            || (item.deletion() ? !draft.isDeleted() : !draft.getId().equals(item.pinnedVersionId()));
                    drift += changed ? 1 : 0;
                }
                LocaleRelease release = asset == null ? null : status.getOrDefault(asset.getId(), Map.of()).get(item.locale());
                items.add(new ActionDescription.Item(
                        item.assetUuid(),
                        asset == null ? null : asset.getAssetType().name(),
                        asset == null ? null : asset.getUid(),
                        draft == null ? null : draft.getDisplayName(),
                        item.locale(),
                        item.pinnedVersionId(),
                        changed,
                        release == null ? null : release.status().name()));
            }
            out.put(spec.actionId(), new ActionDescription(items, pinned ? drift : null));
        }
    }
}
