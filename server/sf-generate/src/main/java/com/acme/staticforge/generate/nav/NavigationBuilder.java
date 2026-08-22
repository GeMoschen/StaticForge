package com.acme.staticforge.generate.nav;

import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.structure.ExpandMode;
import com.acme.staticforge.structure.NavNode;
import com.acme.staticforge.structure.OrderClause;
import com.acme.staticforge.structure.RootKind;
import com.acme.staticforge.structure.StructureRoot;
import com.acme.staticforge.structure.StructureSource;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Computes a navigation tree for a {@link StructureSource} against a revision-pinned
 * {@link Snapshot} (spec §17.2). Stateless and thread-safe: a single instance may run
 * concurrently on virtual threads.
 *
 * <p><strong>Collection</strong> — the candidate set is every non-deleted page in the subtree of
 * a resolved root: a {@link StructureRoot} with kind {@code FOLDER} collects pages whose folder
 * path equals or descends from the given path; kind {@code PAGE} collects the referenced page
 * (which must exist, else the navigation is empty) together with the pages under its folder.
 *
 * <p><strong>Filter/order</strong> — every {@code include} expression must evaluate true
 * (conjunctively) and no {@code exclude} expression may evaluate true for a page to remain; both
 * run against the page scope {@code { displayName, nav: {…}, meta: {…} }} via
 * {@link ExpressionEvaluator}. The remaining pages are sorted by {@code orderBy} (default
 * {@code nav.position asc, displayName asc}).
 *
 * <p><strong>Nesting semantics</strong> (deterministic; §17.2 is deliberately loose): pages are
 * parented by folder path — a page is a child of the page whose folder path is its own path's
 * direct parent. A page whose parent folder is not itself a candidate folder is a top-level node
 * (level 0). {@link ExpandMode#ALL} fully expands this hierarchy; {@link ExpandMode#ACTIVE_PATH_ONLY}
 * keeps the hierarchy but collapses every branch except the one leading to the active page (each
 * strict ancestor of the active page shows a single child on the active path); {@link ExpandMode#NONE}
 * flattens to a single ordered list. {@code depth} is the number of levels to emit (level 0
 * counts); nodes at the last level have no children.
 *
 * <p><strong>Marking</strong> — {@code active} is the page being rendered ({@code activePageUuid});
 * {@code trail} marks a strict folder ancestor of the active page; {@code label} falls back from
 * {@code nav.label} to {@code displayName}; {@code href} is the page's resolved URL in the channel.
 *
 * <p><strong>Cycle protection</strong> — the recursive descent tracks the UUIDs on the current
 * path; revisiting a UUID truncates that branch and records {@code SF-GEN-0410}. Folder-path
 * parenting is structurally acyclic for well-formed paths, so this guard is defensive (it also
 * covers malformed/self-referential folder data) but is exercised directly by tests.
 */
@Service
public class NavigationBuilder {

    private final ExpressionEvaluator expressionEvaluator = new ExpressionEvaluator();

    /** Result of a build: a synthetic root whose {@link NavNode#children()} are the top-level nodes, plus diagnostics. */
    public record NavBuildResult(NavNode root, List<Diagnostic> diagnostics) {

        public NavBuildResult {
            diagnostics = diagnostics == null ? List.of() : List.copyOf(diagnostics);
        }
    }

    /**
     * Builds the navigation tree.
     *
     * @param paths the run's output-path resolver (may be {@code null} to leave {@code href} empty)
     */
    public NavBuildResult build(
            Snapshot snapshot,
            StructureSource source,
            UUID activePageUuid,
            OutputPathResolver paths,
            String channel) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        List<PageEntry> candidates = new ArrayList<>(collect(snapshot, source));
        candidates.removeIf(entry -> !matches(entry, source));
        sort(candidates, source);

        String activeFolder = activeFolder(activePageUuid, candidates);
        Set<String> candidateFolders = new HashSet<>();
        for (PageEntry entry : candidates) {
            candidateFolders.add(entry.folderPath());
        }

        List<NavNode> topLevel = new ArrayList<>();
        for (PageEntry entry : candidates) {
            if (isTopLevel(entry, candidateFolders)) {
                Set<UUID> visiting = new HashSet<>();
                visiting.add(entry.asset().uuid());
                topLevel.add(toNode(
                        entry, candidates, 0, activePageUuid, activeFolder, paths, channel, source, visiting, diagnostics));
            }
        }

        NavNode root = new NavNode("", "", false, false, -1, topLevel, null, "", "");
        return new NavBuildResult(root, diagnostics);
    }

    // ------------------------------------------------------------------
    // Collection + filter + sort
    // ------------------------------------------------------------------

    private List<PageEntry> collect(Snapshot snapshot, StructureSource source) {
        List<PageEntry> out = new ArrayList<>();
        StructureRoot root = source.root();
        if (root == null) {
            return out;
        }
        if (root.kind() == RootKind.PAGE) {
            SnapshotAsset anchor = findByUid(snapshot, root.ref());
            if (anchor == null) {
                return out;
            }
            String subtree = PageEntry.normalizeFolder(anchor.folderPath());
            for (SnapshotAsset page : snapshot.pages()) {
                if (page.uuid().equals(anchor.uuid())
                        || PageEntry.normalizeFolder(page.folderPath()).startsWith(subtree)) {
                    out.add(new PageEntry(page));
                }
            }
            return out;
        }
        String prefix = PageEntry.normalizeFolder(root.ref());
        for (SnapshotAsset page : snapshot.pages()) {
            if (PageEntry.normalizeFolder(page.folderPath()).startsWith(prefix)) {
                out.add(new PageEntry(page));
            }
        }
        return out;
    }

    private SnapshotAsset findByUid(Snapshot snapshot, String uid) {
        if (uid == null || uid.isBlank()) {
            return null;
        }
        for (SnapshotAsset page : snapshot.pages()) {
            if (uid.equals(page.uid())) {
                return page;
            }
        }
        return null;
    }

    private boolean matches(PageEntry entry, StructureSource source) {
        for (String include : source.include()) {
            if (!expressionEvaluator.evaluate(include, entry.scope())) {
                return false;
            }
        }
        for (String exclude : source.exclude()) {
            if (expressionEvaluator.evaluate(exclude, entry.scope())) {
                return false;
            }
        }
        return true;
    }

    private void sort(List<PageEntry> candidates, StructureSource source) {
        Comparator<PageEntry> comparator = null;
        for (OrderClause clause : source.orderBy()) {
            Comparator<PageEntry> fieldComparator = compareBy(clause.field());
            if (!clause.ascending()) {
                fieldComparator = fieldComparator.reversed();
            }
            comparator = comparator == null ? fieldComparator : comparator.thenComparing(fieldComparator);
        }
        if (comparator != null) {
            candidates.sort(comparator);
        }
    }

    private Comparator<PageEntry> compareBy(String field) {
        return (a, b) -> compareNodes(fieldValue(field, a), fieldValue(field, b));
    }

    private JsonNode fieldValue(String field, PageEntry entry) {
        if ("displayName".equals(field)) {
            return entry.scope().get("displayName");
        }
        JsonNode node = entry.scope().at("/" + field.replace('.', '/'));
        return node == null || node.isMissingNode() ? NullNode.getInstance() : node;
    }

    private static int compareNodes(JsonNode a, JsonNode b) {
        boolean aNull = a == null || a.isNull() || a.isMissingNode();
        boolean bNull = b == null || b.isNull() || b.isMissingNode();
        if (aNull && bNull) {
            return 0;
        }
        if (aNull) {
            return 1;
        }
        if (bNull) {
            return -1;
        }
        if (a.isNumber() && b.isNumber()) {
            return Double.compare(a.asDouble(), b.asDouble());
        }
        return a.asText().compareTo(b.asText());
    }

    // ------------------------------------------------------------------
    // Nesting
    // ------------------------------------------------------------------

    NavNode toNode(
            PageEntry entry,
            List<PageEntry> candidates,
            int level,
            UUID activePageUuid,
            String activeFolder,
            OutputPathResolver paths,
            String channel,
            StructureSource source,
            Set<UUID> visiting,
            List<Diagnostic> diagnostics) {
        SnapshotAsset page = entry.asset();
        boolean active = page.uuid().equals(activePageUuid);
        boolean trail = !active && isAncestorFolder(entry.folderPath(), activeFolder);
        String label = label(page);
        String href = paths == null ? "" : paths.resolvePageUrl(page.uuid(), channel);
        List<NavNode> children = childrenOf(
                entry, candidates, level, activePageUuid, activeFolder, paths, channel, source, visiting, diagnostics);
        return new NavNode(label, href, active, trail, level, children, page.uuid(), page.uid(), page.displayName());
    }

    List<NavNode> childrenOf(
            PageEntry parent,
            List<PageEntry> candidates,
            int level,
            UUID activePageUuid,
            String activeFolder,
            OutputPathResolver paths,
            String channel,
            StructureSource source,
            Set<UUID> visiting,
            List<Diagnostic> diagnostics) {
        if (source.expand() == ExpandMode.NONE) {
            return List.of();
        }
        if (level + 1 >= source.depth()) {
            return List.of();
        }

        List<PageEntry> children = new ArrayList<>();
        if (source.expand() == ExpandMode.ALL) {
            for (PageEntry candidate : candidates) {
                if (isDirectChild(parent, candidate)) {
                    children.add(candidate);
                }
            }
        } else { // ACTIVE_PATH_ONLY: only the branch leading to the active page is expanded.
            if (!isAncestorFolder(parent.folderPath(), activeFolder)) {
                return List.of();
            }
            for (PageEntry candidate : candidates) {
                if (isDirectChild(parent, candidate) && onActivePath(candidate, activePageUuid, activeFolder)) {
                    children.add(candidate);
                }
            }
        }

        List<NavNode> nodes = new ArrayList<>();
        for (PageEntry child : children) {
            if (!visiting.add(child.asset().uuid())) {
                diagnostics.add(Diagnostic.warning(
                        GenerationDiagnosticCodes.GEN_NAV_CYCLE,
                        "Navigation cycle detected at '" + uidOf(child) + "'; branch truncated.",
                        0,
                        0));
                continue;
            }
            nodes.add(toNode(
                    child, candidates, level + 1, activePageUuid, activeFolder, paths, channel, source, visiting, diagnostics));
            visiting.remove(child.asset().uuid());
        }
        return nodes;
    }

    private static boolean isDirectChild(PageEntry parent, PageEntry candidate) {
        String parentPath = PageEntry.parentFolder(candidate.folderPath());
        return parentPath.equals(parent.folderPath());
    }

    private static boolean onActivePath(PageEntry candidate, UUID activePageUuid, String activeFolder) {
        return candidate.asset().uuid().equals(activePageUuid)
                || isAncestorFolder(candidate.folderPath(), activeFolder);
    }

    // ------------------------------------------------------------------
    // Page scope + helpers
    // ------------------------------------------------------------------

    private String label(SnapshotAsset page) {
        JsonNode nav = page.payload() == null ? null : page.payload().get("nav");
        if (nav != null && nav.get("label") != null && nav.get("label").isTextual() && !nav.get("label").asText().isBlank()) {
            return nav.get("label").asText();
        }
        return page.displayName() == null ? "" : page.displayName();
    }

    private static String uidOf(PageEntry entry) {
        return entry.asset().uid() == null ? "" : entry.asset().uid();
    }

    private String activeFolder(UUID activePageUuid, List<PageEntry> candidates) {
        if (activePageUuid == null) {
            return "";
        }
        for (PageEntry entry : candidates) {
            if (entry.asset().uuid().equals(activePageUuid)) {
                return entry.folderPath();
            }
        }
        return "";
    }

    private static boolean isAncestorFolder(String ancestorPath, String descendantPath) {
        if (ancestorPath == null || descendantPath == null || descendantPath.isBlank()) {
            return false;
        }
        return descendantPath.startsWith(ancestorPath) && !descendantPath.equals(ancestorPath);
    }

    private boolean isTopLevel(PageEntry entry, Set<String> candidateFolders) {
        return !candidateFolders.contains(PageEntry.parentFolder(entry.folderPath()));
    }

    /** Point-in-time page view plus its precomputed page scope and normalized folder path. */
    record PageEntry(SnapshotAsset asset, JsonNode scope, String folderPath) {

        public PageEntry(SnapshotAsset asset) {
            this(asset, scopeOf(asset), normalizeFolder(asset.folderPath()));
        }

        private static JsonNode scopeOf(SnapshotAsset page) {
            ObjectNode node = JsonNodeFactory.instance.objectNode();
            node.put("displayName", page.displayName() == null ? "" : page.displayName());
            JsonNode nav = page.payload() == null ? null : page.payload().get("nav");
            node.set("nav", nav == null ? JsonNodeFactory.instance.objectNode() : nav);
            JsonNode meta = page.payload() == null ? null : page.payload().get("meta");
            node.set("meta", meta == null ? JsonNodeFactory.instance.objectNode() : meta);
            return node;
        }

        /** {@code ""} → {@code "/"}; ensures a leading/trailing slash. */
        static String normalizeFolder(String path) {
            if (path == null || path.isBlank()) {
                return "/";
            }
            String p = path.replace('\\', '/');
            if (!p.startsWith("/")) {
                p = "/" + p;
            }
            if (!p.endsWith("/")) {
                p = p + "/";
            }
            return p;
        }

        /** The direct parent folder path; {@code "/products/" → "/"}; {@code "/" → ""}. */
        static String parentFolder(String path) {
            String p = normalizeFolder(path);
            if ("/".equals(p)) {
                return "";
            }
            String withoutSlash = p.substring(0, p.length() - 1);
            int idx = withoutSlash.lastIndexOf('/');
            if (idx <= 0) {
                return "/";
            }
            return withoutSlash.substring(0, idx + 1);
        }
    }
}
