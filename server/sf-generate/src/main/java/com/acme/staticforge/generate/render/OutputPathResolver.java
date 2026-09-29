package com.acme.staticforge.generate.render;

import com.acme.staticforge.urlregistry.UrlRegistryView;
import com.acme.staticforge.urlregistry.UrlTarget;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Resolves each page's output path for a channel by the §18.3 order — page
 * {@code pathOverride}, then the page template's {@code outputPath} expression, then the
 * project default {@code {folder}{uid}.{ext}} — and expands the placeholder set. A resolver
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

    /** The build's view of the URL registry (M32.3); {@code null} computes every path, as before M32. */
    private final UrlRegistryView registry;

    private volatile Map<String, UUID> collisionOwners = Map.of();

    private OutputPathResolver(
            Snapshot snapshot,
            Map<String, ChannelOutputSettings> settingsByChannel,
            LocaleConfig locales,
            UrlRegistryView registry) {
        this.snapshot = snapshot;
        this.settingsByChannel = Map.copyOf(settingsByChannel);
        this.locales = locales == null ? LocaleConfig.EMPTY : locales;
        this.registry = registry;
    }

    /**
     * This resolver reading the URL registry (M32.3): a page (each page number) is written at its registered URL, and
     * a page without one at its computed path, which the registry view claims for it. Links, the plan, the manifest and
     * the post-processors all read paths from here, so they agree with the files.
     */
    public OutputPathResolver withRegistry(UrlRegistryView registry) {
        return new OutputPathResolver(snapshot, settingsByChannel, locales, registry);
    }

    /** The URL registry this resolver reads; {@code null} when it computes every path. */
    public UrlRegistryView registry() {
        return registry;
    }

    /**
     * The key a registry row stores for {@code locale}: the canonical tag in a localized project (the default language
     * for {@code null}), {@code ""} in a project without locales — as {@code UrlRegistryService.localeKey}.
     */
    public String localeKey(String locale) {
        if (!locales.isLocalized()) {
            return "";
        }
        String declared = locale == null ? null : locales.canonicalDeclared(locale);
        return declared != null ? declared : locales.defaultLocale();
    }

    /**
     * Builds a resolver for one generation run, pinned to the given snapshot.
     *
     * @param settingsByChannel output settings per channel key; a channel without an entry uses
     *     {@link ChannelOutputSettings#defaults}
     */
    public static OutputPathResolver forSnapshot(Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel) {
        return new OutputPathResolver(snapshot, settingsByChannel, LocaleConfig.EMPTY, null);
    }

    /**
     * Builds a resolver for a localized project (M24.3.2): every path resolution takes a language
     * and {@code {locale}} expands to its segment.
     */
    public static OutputPathResolver forSnapshot(
            Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel, LocaleConfig locales) {
        return new OutputPathResolver(snapshot, settingsByChannel, locales, null);
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
        ChannelOutputSettings settings = settingsFor(channel);
        if (registry == null) {
            return computedPagePath(page, channel, settings, locale);
        }
        String url = registry.url(UrlTarget.page(pageUuid), channel, localeKey(locale),
                () -> OutputPathExpander.urlForOutput(computedPagePath(page, channel, settings, locale), settings));
        return OutputFile.normalize(OutputPathExpander.pathForUrl(url, settings));
    }

    /** The §18.3 path of a page, as if it had no registered URL. */
    private String computedPagePath(SnapshotAsset page, String channel, ChannelOutputSettings settings, String locale) {
        OutputPathExpander.PageContext context = toPageContext(page);
        return OutputFile.normalize(OutputPathExpander.resolvePath(context, channel, settings, localeContext(locale)));
    }

    /**
     * The URL (relative to the site root) a {@code $CMS_REF(folder:…)} to a folder without an index page links
     * (M32.3): its registered URL, else its directory ({@link OutputPathExpander#folderUrl}), which is claimed.
     *
     * @param folderPath the folder's own stored path, e.g. {@code /pages_root/products/}
     */
    public String resolveFolderUrl(UUID folderUuid, String folderPath, String channel, String locale) {
        java.util.function.Supplier<String> computed = () -> OutputPathExpander.folderUrl(folderPath, localeContext(locale));
        if (registry == null) {
            return computed.get();
        }
        return registry.url(UrlTarget.folder(folderUuid), channel, localeKey(locale), computed);
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
        return OutputPathExpander.effectiveExpression(toPageContext(page), channel, locales.isLocalized());
    }

    private OutputPathExpander.PageContext toPageContext(SnapshotAsset page) {
        SnapshotAsset template = templateOf(page);
        return new OutputPathExpander.PageContext(
                page.uid(), page.displayName(), page.folderPath(), page.payload(), template == null ? null : template.payload());
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
        ChannelOutputSettings settings = settingsFor(channel);
        java.util.function.Supplier<String> computed = () -> OutputFile.normalize(OutputPathExpander.resolvePaginationPath(
                toPageContext(page), channel, settings, firstPagePath, pageNumber, localeContext(locale)));
        if (registry == null) {
            return computed.get();
        }
        // Page N's first assignment is computed next to page 1's registered path (firstPagePath), so a paginated
        // page's files stay together even while page 1 is frozen at an old path (M32, user decision 14).
        String url = registry.url(UrlTarget.page(pageUuid, pageNumber), channel, localeKey(locale),
                () -> OutputPathExpander.urlForOutput(computed.get(), settings));
        return OutputFile.normalize(OutputPathExpander.pathForUrl(url, settings));
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
        return OutputPathExpander.urlForOutput(resolvePagePath(pageUuid, channel, locale), settingsFor(channel));
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

    /**
     * The URL registry collisions of this build (M32.3): outputs whose first-time URL another target already holds —
     * a registered row, or an output of this build that claimed it first. Reported like path collisions
     * ({@code SF-GEN-0110}).
     */
    public List<Collision> registryCollisions() {
        if (registry == null) {
            return List.of();
        }
        List<Collision> collisions = new ArrayList<>();
        for (UrlRegistryView.Collision collision : registry.collisions()) {
            String holder = describe(collision.holder().target());
            if (collision.holderOverridden()) {
                holder = holder + " (manual URL override)";
            }
            collisions.add(new Collision(collision.url(), holder, describe(collision.claimant().target())));
        }
        return List.copyOf(collisions);
    }

    private String describe(UrlTarget target) {
        String uid = uidOf(target.uuid());
        String name = uid.isEmpty() ? target.uuid().toString() : uid;
        return switch (target.type()) {
            case PAGE -> target.pageNumber() == 1 ? name : name + " (page " + target.pageNumber() + ")";
            case MEDIA -> "media " + name + (target.variant().isEmpty() ? "" : " (" + target.variant() + ")");
            case FOLDER -> "folder " + name;
        };
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
