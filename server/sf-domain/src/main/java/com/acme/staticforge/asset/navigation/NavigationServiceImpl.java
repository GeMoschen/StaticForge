package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.folder.StartNode;
import com.acme.staticforge.asset.folder.StartNodeKind;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** {@link NavigationService} implementation. Pure and stateless — see the interface javadoc. */
@Service
public class NavigationServiceImpl implements NavigationService {

    /** {@code nav.position} ascending, then {@code displayName}, then {@code uid} — full tiebreak determinism. */
    private static final Comparator<NavigationAsset> PAGE_ORDER = Comparator
            .comparingInt(NavigationServiceImpl::navPosition)
            .thenComparing(a -> nullToEmpty(a.displayName()))
            .thenComparing(a -> nullToEmpty(a.uid()));

    /** Folders have no {@code nav.position}; order by {@code displayName} then {@code uid}. */
    private static final Comparator<NavigationAsset> FOLDER_ORDER = Comparator
            .comparing((NavigationAsset a) -> nullToEmpty(a.displayName()))
            .thenComparing(a -> nullToEmpty(a.uid()));

    @Override
    public UUID resolve(long projectId, UUID pageReferenceUuid, NavigationLookup lookup) {
        return resolve(projectId, pageReferenceUuid, lookup, new ArrayList<>());
    }

    @Override
    public UUID resolve(long projectId, UUID pageReferenceUuid, NavigationLookup lookup, List<Diagnostic> diagnostics) {
        if (pageReferenceUuid == null) {
            return null;
        }
        NavigationAsset ref = lookup.byUuid(projectId, pageReferenceUuid).orElse(null);
        if (ref == null || ref.type() != AssetType.PAGE_REFERENCE) {
            return null;
        }
        JsonNode target = ref.payload() == null ? null : ref.payload().get("target");
        String kind = JsonUtil.text(target, "kind").orElse(null);
        UUID targetAssetUuid = parseUuid(JsonUtil.text(target, "assetUuid").orElse(null));
        if (kind == null || targetAssetUuid == null) {
            return null;
        }

        if ("PAGE".equals(kind)) {
            NavigationAsset page = lookup.byUuid(projectId, targetAssetUuid).orElse(null);
            return (page != null && page.type() == AssetType.PAGE) ? targetAssetUuid : null;
        }
        if ("FOLDER".equals(kind)) {
            return firstNavigablePage(projectId, targetAssetUuid, lookup).orElse(null);
        }
        return null;
    }

    @Override
    public Optional<UUID> firstNavigablePage(long projectId, UUID pageStoreFolderUuid, NavigationLookup lookup) {
        return firstNavigablePage(projectId, pageStoreFolderUuid, lookup, new LinkedHashSet<>(), 0);
    }

    private Optional<UUID> firstNavigablePage(
            long projectId, UUID folderUuid, NavigationLookup lookup, Set<UUID> visited, int depth) {
        if (folderUuid == null || depth > PathService.MAX_DEPTH || !visited.add(folderUuid)) {
            return Optional.empty();
        }
        List<NavigationAsset> children = lookup.childrenOf(projectId, folderUuid);

        List<NavigationAsset> pages = children.stream()
                .filter(a -> a.type() == AssetType.PAGE)
                .sorted(PAGE_ORDER)
                .toList();
        if (!pages.isEmpty()) {
            UUID index = indexPage(pages, lookup.indexUid());
            return Optional.of(index != null ? index : pages.get(0).uuid());
        }

        List<NavigationAsset> subfolders = children.stream()
                .filter(a -> a.type() == AssetType.FOLDER)
                .sorted(FOLDER_ORDER)
                .toList();
        for (NavigationAsset sub : subfolders) {
            Optional<UUID> found = firstNavigablePage(projectId, sub.uuid(), lookup, visited, depth + 1);
            if (found.isPresent()) {
                return found;
            }
        }
        return Optional.empty();
    }

    @Override
    public Optional<UUID> indexPage(long projectId, UUID pageStoreFolderUuid, NavigationLookup lookup) {
        NavigationAsset folder = pageStoreFolderUuid == null
                ? null
                : lookup.byUuid(projectId, pageStoreFolderUuid).filter(a -> a.type() == AssetType.FOLDER).orElse(null);
        if (folder == null) {
            return Optional.empty();
        }
        List<NavigationAsset> pages = lookup.childrenOf(projectId, pageStoreFolderUuid).stream()
                .filter(a -> a.type() == AssetType.PAGE)
                .toList();
        return Optional.ofNullable(indexPage(pages, lookup.indexUid()));
    }

    /**
     * The folder's index page among its pages in the view: the page whose UID is {@code indexUid}, like in the build;
     * {@code null} when there is none or no {@code indexUid} is known.
     */
    private static UUID indexPage(List<NavigationAsset> pages, String indexUid) {
        if (indexUid == null || indexUid.isBlank()) {
            return null;
        }
        return pages.stream()
                .filter(page -> indexUid.equals(page.uid()))
                .map(NavigationAsset::uuid)
                .findFirst()
                .orElse(null);
    }

    @Override
    public Optional<UUID> resolveFolderEntry(long projectId, UUID navFolderUuid, NavigationLookup lookup) {
        return resolveFolderEntry(projectId, navFolderUuid, lookup, new ArrayList<>());
    }

    @Override
    public Optional<UUID> resolveFolderEntry(
            long projectId, UUID navFolderUuid, NavigationLookup lookup, List<Diagnostic> diagnostics) {
        return resolveFolderEntry(projectId, navFolderUuid, lookup, diagnostics, new LinkedHashSet<>(), 0);
    }

    private Optional<UUID> resolveFolderEntry(
            long projectId,
            UUID navFolderUuid,
            NavigationLookup lookup,
            List<Diagnostic> diagnostics,
            Set<UUID> visited,
            int depth) {
        if (navFolderUuid == null) {
            return Optional.empty();
        }
        if (depth > PathService.MAX_DEPTH) {
            diagnostics.add(Diagnostic.warning(
                    NavigationDiagnosticCodes.NAV_START_NODE_CYCLE,
                    "Navigation startNode chain exceeds the max depth (" + PathService.MAX_DEPTH + ") at '"
                            + navFolderUuid + "'; truncated.",
                    0,
                    0));
            return Optional.empty();
        }
        if (!visited.add(navFolderUuid)) {
            diagnostics.add(Diagnostic.warning(
                    NavigationDiagnosticCodes.NAV_START_NODE_CYCLE,
                    "Navigation startNode cycle detected at '" + navFolderUuid + "'; chain truncated.",
                    0,
                    0));
            return Optional.empty();
        }

        NavigationAsset folder = lookup.byUuid(projectId, navFolderUuid).orElse(null);
        if (folder == null || folder.type() != AssetType.FOLDER) {
            return Optional.empty();
        }
        StartNode startNode = StartNode.fromPayload(folder.payload());
        if (startNode == null) {
            return Optional.empty();
        }
        if (startNode.kind() == StartNodeKind.PAGE_REFERENCE) {
            return Optional.ofNullable(resolve(projectId, startNode.assetUuid(), lookup, diagnostics));
        }
        return resolveFolderEntry(projectId, startNode.assetUuid(), lookup, diagnostics, visited, depth + 1);
    }

    @Override
    public NavTreeNode tree(
            long projectId,
            UUID navFolderUuid,
            int depth,
            NavigationLookup lookup,
            List<Diagnostic> diagnostics,
            List<String> localeChain) {
        return buildNode(projectId, navFolderUuid, depth, lookup, diagnostics, 0, localeChain);
    }

    private NavTreeNode buildNode(
            long projectId,
            UUID uuid,
            int maxDepth,
            NavigationLookup lookup,
            List<Diagnostic> diagnostics,
            int level,
            List<String> localeChain) {
        NavigationAsset asset = lookup.byUuid(projectId, uuid).orElse(null);
        if (asset == null) {
            return null;
        }

        UUID resolvedPageUuid = switch (asset.type()) {
            case FOLDER -> resolveFolderEntry(projectId, uuid, lookup, diagnostics).orElse(null);
            case PAGE_REFERENCE -> resolve(projectId, uuid, lookup, diagnostics);
            default -> null;
        };

        List<NavTreeNode> children = List.of();
        boolean depthAllows = (maxDepth < 0 || level < maxDepth) && level < PathService.MAX_DEPTH;
        if (asset.type() == AssetType.FOLDER && depthAllows) {
            children = menuOrder(
                            asset,
                            lookup.childrenOf(projectId, uuid).stream()
                                    .filter(a -> a.type() == AssetType.FOLDER || a.type() == AssetType.PAGE_REFERENCE)
                                    .sorted(FOLDER_ORDER)
                                    .toList())
                    .stream()
                    .map(a -> buildNode(projectId, a.uuid(), maxDepth, lookup, diagnostics, level + 1, localeChain))
                    .filter(Objects::nonNull)
                    .toList();
        }

        return new NavTreeNode(
                asset.uuid(), asset.type(), asset.uid(), asset.displayName(), label(projectId, asset, lookup, localeChain),
                resolvedPageUuid, FolderScope.isProtected(asset.payload()), children);
    }

    /**
     * A navigation folder's children in menu order (M35.22): those its stored {@code childOrder} names first, in that
     * order, then the rest in the {@code children}' own order (alphabetical). A stored name that is no longer a child
     * is ignored, so a move, delete or create needs no second write.
     */
    private static List<NavigationAsset> menuOrder(NavigationAsset folder, List<NavigationAsset> children) {
        List<UUID> stored = FolderScope.childOrderFromPayload(folder.payload());
        if (stored.isEmpty() || children.size() < 2) {
            return children;
        }
        java.util.Map<UUID, NavigationAsset> byUuid = new java.util.LinkedHashMap<>();
        children.forEach(child -> byUuid.put(child.uuid(), child));
        List<NavigationAsset> ordered = new ArrayList<>(children.size());
        for (UUID uuid : stored) {
            NavigationAsset child = byUuid.remove(uuid);
            if (child != null) {
                ordered.add(child);
            }
        }
        ordered.addAll(byUuid.values());
        return ordered;
    }

    private String label(
            long projectId, NavigationAsset asset, NavigationLookup lookup, List<String> localeChain) {
        if (asset.type() != AssetType.PAGE_REFERENCE) {
            return asset.displayName();
        }
        JsonNode payload = asset.payload();
        // A PageReference label is language-dependent in a localized project (M24.2.2): resolve the
        // wrapper for the render locale before falling back to the target page's display name.
        JsonNode stored = payload == null ? null : payload.get("label");
        JsonNode resolved = com.acme.staticforge.common.L10nValues.resolve(stored, localeChain);
        String label = resolved != null && resolved.isTextual() ? resolved.asText() : null;
        if (label != null && !label.isBlank()) {
            return label;
        }
        JsonNode target = payload == null ? null : payload.get("target");
        UUID targetUuid = parseUuid(JsonUtil.text(target, "assetUuid").orElse(null));
        if (targetUuid != null) {
            NavigationAsset resolvedTarget = lookup.byUuid(projectId, targetUuid).orElse(null);
            if (resolvedTarget != null && resolvedTarget.displayName() != null) {
                return resolvedTarget.displayName();
            }
        }
        return asset.displayName();
    }

    private static int navPosition(NavigationAsset asset) {
        JsonNode payload = asset.payload();
        JsonNode nav = payload == null ? null : payload.get("nav");
        JsonNode position = nav == null ? null : nav.get("position");
        return position != null && position.isNumber() ? position.asInt(0) : 0;
    }

    private static UUID parseUuid(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(text);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
