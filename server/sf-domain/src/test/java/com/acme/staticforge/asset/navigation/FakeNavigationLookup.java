package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * In-memory {@link NavigationLookup} for pure algorithm-level unit tests — no Spring context,
 * no database, mirroring the fixture style {@code BodyServiceTest} etc. already use in this
 * module. Assets are keyed by uuid; {@code childrenOf} is derived from an explicit
 * parent-uuid map built alongside each asset, exactly like the live repositories track
 * {@code folderId}.
 */
final class FakeNavigationLookup implements NavigationLookup {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Map<UUID, NavigationAsset> assets = new LinkedHashMap<>();
    private final Map<UUID, List<UUID>> childrenByParent = new LinkedHashMap<>();

    UUID addFolder(UUID parent, String displayName) {
        UUID uuid = UUID.randomUUID();
        put(parent, uuid, AssetType.FOLDER, displayName, MAPPER.createObjectNode());
        return uuid;
    }

    UUID addPage(UUID parent, String displayName, int navPosition) {
        UUID uuid = UUID.randomUUID();
        ObjectNode payload = MAPPER.createObjectNode();
        payload.putObject("nav").put("position", navPosition);
        put(parent, uuid, AssetType.PAGE, displayName, payload);
        return uuid;
    }

    UUID addPageReferenceToPage(UUID parent, String displayName, UUID targetPageUuid, String label) {
        return addPageReference(parent, displayName, "PAGE", targetPageUuid, label);
    }

    UUID addPageReferenceToFolder(UUID parent, String displayName, UUID targetFolderUuid, String label) {
        return addPageReference(parent, displayName, "FOLDER", targetFolderUuid, label);
    }

    private UUID addPageReference(UUID parent, String displayName, String targetKind, UUID targetUuid, String label) {
        UUID uuid = UUID.randomUUID();
        ObjectNode payload = MAPPER.createObjectNode();
        ObjectNode target = payload.putObject("target");
        target.put("kind", targetKind);
        target.put("assetUuid", targetUuid.toString());
        if (label == null) {
            payload.putNull("label");
        } else {
            payload.put("label", label);
        }
        put(parent, uuid, AssetType.PAGE_REFERENCE, displayName, payload);
        return uuid;
    }

    void setStartNode(UUID folderUuid, String kind, UUID assetUuid) {
        NavigationAsset existing = assets.get(folderUuid);
        ObjectNode payload = existing.payload().deepCopy();
        if (kind == null) {
            payload.putNull("startNode");
        } else {
            ObjectNode startNode = payload.putObject("startNode");
            startNode.put("kind", kind);
            startNode.put("assetUuid", assetUuid.toString());
        }
        assets.put(folderUuid, new NavigationAsset(folderUuid, AssetType.FOLDER, existing.uid(), existing.displayName(), payload));
    }

    /** A page with an explicit UID (every other page's UID is its uuid). */
    UUID addPageWithUid(UUID parent, String uid, String displayName, int navPosition) {
        UUID uuid = addPage(parent, displayName, navPosition);
        NavigationAsset page = assets.get(uuid);
        assets.put(uuid, new NavigationAsset(uuid, AssetType.PAGE, uid, page.displayName(), page.payload()));
        return uuid;
    }

    /** Makes {@code folderUuid} a pages folder whose {@code startPage} is {@code pageUuid} (M31). */
    void setStartPage(UUID folderUuid, UUID pageUuid) {
        NavigationAsset existing = assets.get(folderUuid);
        ObjectNode payload = existing.payload().deepCopy();
        payload.put("scope", "PAGES");
        payload.put("startPage", pageUuid.toString());
        assets.put(folderUuid, new NavigationAsset(folderUuid, AssetType.FOLDER, existing.uid(), existing.displayName(), payload));
    }

    void setScope(UUID folderUuid, String scope) {
        NavigationAsset existing = assets.get(folderUuid);
        ObjectNode payload = existing.payload().deepCopy();
        payload.put("scope", scope);
        assets.put(folderUuid, new NavigationAsset(folderUuid, AssetType.FOLDER, existing.uid(), existing.displayName(), payload));
    }

    void remove(UUID uuid) {
        assets.remove(uuid);
    }

    private void put(UUID parent, UUID uuid, AssetType type, String displayName, JsonNode payload) {
        assets.put(uuid, new NavigationAsset(uuid, type, uuid.toString(), displayName, payload));
        if (parent != null) {
            childrenByParent.computeIfAbsent(parent, k -> new ArrayList<>()).add(uuid);
        }
    }

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        return Optional.ofNullable(assets.get(uuid));
    }

    @Override
    public List<NavigationAsset> childrenOf(long projectId, UUID folderUuid) {
        return childrenByParent.getOrDefault(folderUuid, List.of()).stream().map(assets::get).toList();
    }
}
