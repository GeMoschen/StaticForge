package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Navigation resolution algorithm (spec §17, `M8.1.3`): turns a {@code PageReference} (or an
 * intermediate navigation folder's {@code startNode}) into a concrete {@code Page}, and builds
 * the tree-walk consumed by rendering (`M8.1.4`) and by the nav-store UI's live preview
 * (`M8.1.6`). Stateless and thread-safe — every method takes the data-access side as a
 * {@link NavigationLookup} parameter, so the exact same algorithm runs against a
 * revision-pinned {@code Snapshot} (generation) or the live repositories (preview) without
 * forking.
 *
 * <p>Every method that walks a {@code startNode} chain has two overloads: a two-argument
 * convenience form for simple callers (e.g. the REST layer, `M8.1.5`) that don't care about
 * findings, and a three-argument form that appends any cycle/depth-truncation warning to a
 * caller-supplied {@code diagnostics} list — the form {@link #tree} and generation/preview use
 * so those warnings surface in the run's findings, mirroring the {@code List<Diagnostic>}
 * threading pattern {@code GenerationRenderer}/{@code PageRenderService} already use.
 */
public interface NavigationService {

    /**
     * Resolves a {@code PAGE_REFERENCE} to its target {@code Page} uuid: direct for a
     * {@code PAGE} target; the target folder's first navigable page (see
     * {@link #firstNavigablePage}) for a {@code FOLDER} target. Returns {@code null} — never
     * throws — when the reference itself, or its target, cannot be resolved (missing/deleted
     * asset, or a dangling folder with no page anywhere in its subtree); this can only happen
     * for data written before validation start blocking it, or a target soft-deleted after the
     * reference was created (see this task's Notes on {@code asset_reference} materialization).
     */
    UUID resolve(long projectId, UUID pageReferenceUuid, NavigationLookup lookup);

    /** Same as {@link #resolve(long, UUID, NavigationLookup)}; also resolves through it via {@code diagnostics}. */
    UUID resolve(long projectId, UUID pageReferenceUuid, NavigationLookup lookup, List<Diagnostic> diagnostics);

    /**
     * The first navigable page in a page-store folder's subtree: the folder's own direct child
     * pages first (in the store's deterministic order — {@code nav.position} ascending, then
     * {@code displayName}, then {@code uid} as a final tiebreak); if the folder itself has no
     * direct pages, its direct subfolders are searched in the same deterministic order,
     * depth-first, returning the first page found. Empty when the entire subtree has no pages
     * (a "dangling" folder).
     */
    Optional<UUID> firstNavigablePage(long projectId, UUID pageStoreFolderUuid, NavigationLookup lookup);

    /**
     * Resolves a {@code NAVIGATION} folder's {@code startNode} chain to a {@code Page} uuid: a
     * {@code PAGE_REFERENCE} {@code startNode} delegates to {@link #resolve}; a {@code FOLDER}
     * {@code startNode} recurses into this same method. Empty (never an exception) when
     * {@code startNode} is {@code null} — the folder is a pure grouping node with no entry page.
     */
    Optional<UUID> resolveFolderEntry(long projectId, UUID navFolderUuid, NavigationLookup lookup);

    /** Same as {@link #resolveFolderEntry(long, UUID, NavigationLookup)}; reports cycle/depth truncation into {@code diagnostics}. */
    Optional<UUID> resolveFolderEntry(long projectId, UUID navFolderUuid, NavigationLookup lookup, List<Diagnostic> diagnostics);

    /**
     * Builds the nested navigation tree rooted at {@code navFolderUuid}: nested folders and
     * {@code PageReference} leaves, each carrying its own pre-resolved {@code resolvedPageUuid}.
     * {@code depth} caps how many levels below the root are expanded ({@code -1} = unlimited,
     * still hard-capped at {@code PathService.MAX_DEPTH}); {@code 0} returns just the root node
     * with no children. Any {@code startNode}-chain cycle/depth truncation encountered while
     * resolving entries is appended to {@code diagnostics}. Returns {@code null} if
     * {@code navFolderUuid} is not a live {@code FOLDER}.
     */
    NavTreeNode tree(long projectId, UUID navFolderUuid, int depth, NavigationLookup lookup, List<Diagnostic> diagnostics);
}
