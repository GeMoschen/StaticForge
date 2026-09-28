package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.StartPage;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Resolves each page's output path for a channel by the §18.3 order — page
 * {@code pathOverride}, then — for its folder's start page (M31) — the folder's index path, then the page
 * template's {@code outputPath} expression, then the project default {@code {folder}{uid}.{ext}} — and
 * expands the placeholder set. Whether a page is its folder's start page is decided in the page's language
 * view: a pointer to a page that isn't there, or no longer lives in the folder, doesn't count. A resolver
 * is stateful per generation run (it caches first-path ownership for collision reporting),
 * so build one via {@link #forSnapshot} for each run rather than as a shared singleton.
 *
 * <p>The actual expression-resolution/placeholder-expansion algorithm lives in
 * {@link OutputPathExpander} (sf-domain) so it can also be used outside a full generation run
 * (see {@code com.acme.staticforge.urlregistry.LiveOutputPathResolver}, `M8.2.2`) — this class
 * adapts that shared algorithm to a {@link Snapshot} and applies generation's own output-path
 * syntax normalization ({@link OutputFile#normalize}).
 */
public final class OutputPathResolver {

    private final Snapshot snapshot;
    private final Map<String, ChannelOutputSettings> settingsByChannel;
    private final LocaleConfig locales;

    private volatile Map<String, UUID> collisionOwners = Map.of();

    private OutputPathResolver(
            Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel, LocaleConfig locales) {
        this.snapshot = snapshot;
        this.settingsByChannel = Map.copyOf(settingsByChannel);
        this.locales = locales == null ? LocaleConfig.EMPTY : locales;
    }

    /**
     * Builds a resolver for one generation run, pinned to the given snapshot.
     *
     * @param settingsByChannel output settings per channel key; a channel without an entry uses
     *     {@link ChannelOutputSettings#defaults}
     */
    public static OutputPathResolver forSnapshot(Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel) {
        return new OutputPathResolver(snapshot, settingsByChannel, LocaleConfig.EMPTY);
    }

    /**
     * Builds a resolver for a localized project (M24.3.2): every path resolution takes a language
     * and {@code {locale}} expands to its segment.
     */
    public static OutputPathResolver forSnapshot(
            Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel, LocaleConfig locales) {
        return new OutputPathResolver(snapshot, settingsByChannel, locales);
    }

    /** The project's content locales; {@link LocaleConfig#EMPTY} for a single-language project. */
    public LocaleConfig locales() {
        return locales;
    }

    /**
     * How {@code {locale}} expands for {@code locale}: the tag itself, or nothing for the default
     * language when the project puts it at the site root.
     */
    public OutputPathExpander.LocaleContext localeContext(String locale) {
        if (!locales.isLocalized() || locale == null) {
            return OutputPathExpander.LocaleContext.NONE;
        }
        String declared = locales.canonicalDeclared(locale);
        if (declared == null) {
            return OutputPathExpander.LocaleContext.NONE;
        }
        boolean atRoot = locales.defaultWithoutPrefix() && declared.equals(locales.defaultLocale());
        return new OutputPathExpander.LocaleContext(declared, atRoot ? "" : declared);
    }

    /** The output settings this resolver applies to {@code channel}. */
    public ChannelOutputSettings settingsFor(String channel) {
        ChannelOutputSettings settings = settingsByChannel.get(channel);
        return settings != null ? settings : ChannelOutputSettings.defaults(channel);
    }

    /**
     * The {@code indexUid} of each of {@code channels} (M31): a page with one of them holds its folder's index path while
     * the folder has no start page.
     */
    public Set<String> indexUids(Collection<String> channels) {
        Set<String> uids = new TreeSet<>();
        channels.forEach(channel -> uids.add(settingsFor(channel).indexUid()));
        return uids;
    }

    /**
     * Resolves the relative (no leading slash) output path for a page in a channel.
     *
     * @throws SfException (not-found) when the page is absent from the snapshot
     */
    public String resolvePagePath(UUID pageUuid, String channel) {
        return resolvePagePath(pageUuid, channel, null);
    }

    /**
     * As {@link #resolvePagePath(UUID, String)}, for one language (M24.3.2): the page's version in that language's
     * view — its released folder, uid and path override in the released view (M27.2.1).
     */
    public String resolvePagePath(UUID pageUuid, String channel, String locale) {
        SnapshotAsset page = snapshot.asset(pageUuid, locale);
        if (page == null) {
            throw new SfException(ProblemFactory.notFound("Page not found in snapshot."));
        }
        OutputPathExpander.PageContext context = toPageContext(page, locale);
        String path = OutputPathExpander.resolvePath(context, channel, settingsFor(channel), localeContext(locale));
        return OutputFile.normalize(path);
    }

    /**
     * The path expression that governs a page in a channel — what {@code SF-GEN-0111} checks for
     * a {@code {locale}} segment when the project has locales.
     */
    public String effectiveExpression(UUID pageUuid, String channel) {
        return effectiveExpression(pageUuid, channel, null);
    }

    /** As {@link #effectiveExpression(UUID, String)}, for the page's version in {@code locale} (M27.2.1). */
    public String effectiveExpression(UUID pageUuid, String channel, String locale) {
        SnapshotAsset page = snapshot.asset(pageUuid, locale);
        if (page == null) {
            return OutputPathExpander.DEFAULT_EXPRESSION;
        }
        return OutputPathExpander.effectiveExpression(toPageContext(page, locale), channel, locales.isLocalized());
    }

    /** The page as {@code locale}'s view sees it, with its folder's start page (M31) in that view. */
    private OutputPathExpander.PageContext toPageContext(SnapshotAsset page, String locale) {
        SnapshotAsset template = templateOf(page);
        UUID startPage = page.folderId() == null ? null : effectiveStartPage(snapshot.in(locale), page.folderId());
        return new OutputPathExpander.PageContext(
                page.uid(), page.displayName(), page.folderPath(), page.payload(), template == null ? null : template.payload(),
                page.uuid().equals(startPage), startPage != null);
    }

    /**
     * The effective start page (M31) of the folder {@code folderUuid} in {@code locale}'s view: the page its
     * {@code startPage} names when that page is present in the view and still lives in the folder; {@code null} when
     * the folder has none, isn't a pages folder, isn't present in the view, or its pointer is stale (the folder then
     * falls back to the channel's {@code indexUid} rule).
     */
    public UUID startPageOf(UUID folderUuid, String locale) {
        Snapshot view = snapshot.in(locale);
        SnapshotAsset folder = folderUuid == null ? null : view.assetByUuid(folderUuid);
        return folder == null ? null : effectiveStartPage(view, folder.assetId());
    }

    /**
     * The start page {@code folderUuid}'s payload names in {@code locale}'s view, effective or not; {@code null} when the
     * folder is absent there or names none. A pointer here without an effective {@link #startPageOf} is stale.
     */
    public UUID declaredStartPageOf(UUID folderUuid, String locale) {
        SnapshotAsset folder = folderUuid == null ? null : snapshot.in(locale).assetByUuid(folderUuid);
        return isPagesFolder(folder) ? StartPage.fromPayload(folder.payload()) : null;
    }

    private static UUID effectiveStartPage(Snapshot view, long folderId) {
        SnapshotAsset folder = view.assetById(folderId);
        if (!isPagesFolder(folder)) {
            return null;
        }
        UUID pointer = StartPage.fromPayload(folder.payload());
        SnapshotAsset page = pointer == null ? null : view.assetByUuid(pointer);
        boolean effective = page != null && !page.deleted() && page.type() == AssetType.PAGE
                && Objects.equals(page.folderId(), folder.assetId());
        return effective ? pointer : null;
    }

    private static boolean isPagesFolder(SnapshotAsset folder) {
        return folder != null && !folder.deleted() && folder.type() == AssetType.FOLDER
                && FolderScope.fromPayload(folder.payload()) == FolderScope.PAGES;
    }

    /**
     * Resolves the output path of page {@code pageNumber} ≥ 2 of a paginated page (M21.2.1): the page template's
     * {@code paginationPath} pattern, or {@code name-N.ext} next to page 1 ({@link OutputPathExpander#resolvePaginationPath}).
     *
     * @param firstPagePath page 1's path, as {@link #resolvePagePath} returned it
     */
    public String resolvePaginationPath(UUID pageUuid, String channel, String firstPagePath, int pageNumber) {
        return resolvePaginationPath(pageUuid, channel, firstPagePath, pageNumber, null);
    }

    /** As {@link #resolvePaginationPath(UUID, String, String, int)}, for one language (M24.3.3). */
    public String resolvePaginationPath(
            UUID pageUuid, String channel, String firstPagePath, int pageNumber, String locale) {
        SnapshotAsset page = snapshot.asset(pageUuid, locale);
        if (page == null) {
            throw new SfException(ProblemFactory.notFound("Page not found in snapshot."));
        }
        return OutputFile.normalize(OutputPathExpander.resolvePaginationPath(
                toPageContext(page, locale), channel, settingsFor(channel), firstPagePath, pageNumber, localeContext(locale)));
    }

    /** The URL (href, relative to the site root) of a pagination page's output path in {@code channel}. */
    public String paginationUrl(String path, String channel) {
        return OutputPathExpander.urlForPaginationPath(path, settingsFor(channel));
    }

    /**
     * Resolves the URL (href) a {@code $CMS_REF(page:...)} should emit for a page, relative to the
     * site root. With {@code urlStrategy=PRETTY} and {@code trailingSlash} this is the directory
     * form ({@code products/hammer/}, the site root as {@code ./}); otherwise it matches the
     * concrete output path.
     */
    public String resolvePageUrl(UUID pageUuid, String channel) {
        return resolvePageUrl(pageUuid, channel, null);
    }

    /** As {@link #resolvePageUrl(UUID, String)}, for one language (M24.3.2). */
    public String resolvePageUrl(UUID pageUuid, String channel, String locale) {
        return OutputPathExpander.urlForPath(resolvePagePath(pageUuid, channel, locale), settingsFor(channel));
    }

    /** First-resolved owner (path → page UUID) of each output path; populated by {@link #findCollisions}. */
    public Map<String, UUID> collisionOwners() {
        return collisionOwners;
    }

    /**
     * Detects output-path collisions among resolved entries: two distinct outputs mapping to the same path. An
     * output is owned by its page and page number (M21.2.1), so two page numbers of one paginated page on one path
     * collide too; the same page in two channels on one path does not. Records first-path ownership and returns one
     * {@link Collision} per colliding path, naming the first two owners by uid ({@code blog (page 2)} past page 1).
     */
    public List<Collision> findCollisions(List<PlanEntry> entries) {
        Map<String, Owner> owners = new HashMap<>();
        List<Collision> collisions = new ArrayList<>();
        for (PlanEntry entry : entries == null ? List.<PlanEntry>of() : entries) {
            Owner owner = new Owner(entry.pageUuid(), entry.pageNumber());
            Owner previous = owners.putIfAbsent(entry.outputPath(), owner);
            if (previous != null && !previous.equals(owner)) {
                collisions.add(new Collision(entry.outputPath(), describe(previous), describe(owner)));
            }
        }
        Map<String, UUID> pages = new HashMap<>();
        owners.forEach((path, owner) -> pages.put(path, owner.pageUuid()));
        this.collisionOwners = Map.copyOf(pages);
        return List.copyOf(collisions);
    }

    /**
     * Detects page outputs that land on a media output's path (M27.3.2): a page may own {@code en/assets/media/…} as
     * much as a localized media file's English copy does. One {@link Collision} per path, naming the page and the
     * media by uid.
     */
    public List<Collision> findMediaCollisions(List<PlanEntry> pages, Map<String, UUID> mediaByPath) {
        List<Collision> collisions = new ArrayList<>();
        Set<String> reported = new HashSet<>();
        for (PlanEntry entry : pages == null ? List.<PlanEntry>of() : pages) {
            UUID media = mediaByPath.get(entry.outputPath());
            if (media != null && reported.add(entry.outputPath())) {
                collisions.add(new Collision(
                        entry.outputPath(), describe(new Owner(entry.pageUuid(), entry.pageNumber())), uidOf(media)));
            }
        }
        return List.copyOf(collisions);
    }

    /** A single output-path collision between two distinct outputs. */
    public record Collision(String path, String uidA, String uidB) {}

    private record Owner(UUID pageUuid, int pageNumber) {}

    private String describe(Owner owner) {
        String uid = uidOf(owner.pageUuid());
        return owner.pageNumber() == 1 ? uid : uid + " (page " + owner.pageNumber() + ")";
    }

    // ------------------------------------------------------------------
    // Snapshot adaptation
    // ------------------------------------------------------------------

    private SnapshotAsset templateOf(SnapshotAsset page) {
        JsonNode payload = page.payload();
        if (payload == null) {
            return null;
        }
        String ref = payload.path("templateRef").asText();
        if (ref.isBlank()) {
            return null;
        }
        try {
            SnapshotAsset template = snapshot.assetByUuid(UUID.fromString(ref));
            return template == null || template.deleted() ? null : template;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String uidOf(UUID pageUuid) {
        SnapshotAsset page = snapshot.assetByUuid(pageUuid);
        return page == null || page.uid() == null ? "" : page.uid();
    }
}
