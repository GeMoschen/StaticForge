package com.acme.staticforge.generate.render;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

    private volatile Map<String, UUID> collisionOwners = Map.of();

    private OutputPathResolver(Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel) {
        this.snapshot = snapshot;
        this.settingsByChannel = Map.copyOf(settingsByChannel);
    }

    /**
     * Builds a resolver for one generation run, pinned to the given snapshot.
     *
     * @param settingsByChannel output settings per channel key; a channel without an entry uses
     *     {@link ChannelOutputSettings#defaults}
     */
    public static OutputPathResolver forSnapshot(Snapshot snapshot, Map<String, ChannelOutputSettings> settingsByChannel) {
        return new OutputPathResolver(snapshot, settingsByChannel);
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
        SnapshotAsset page = snapshot.assetByUuid(pageUuid);
        if (page == null) {
            throw new SfException(ProblemFactory.notFound("Page not found in snapshot."));
        }
        OutputPathExpander.PageContext context = toPageContext(page);
        String path = OutputPathExpander.resolvePath(context, channel, settingsFor(channel));
        return OutputFile.normalize(path);
    }

    private OutputPathExpander.PageContext toPageContext(SnapshotAsset page) {
        SnapshotAsset template = templateOf(page);
        return new OutputPathExpander.PageContext(
                page.uid(), page.displayName(), page.folderPath(), page.payload(), template == null ? null : template.payload());
    }

    /**
     * Resolves the URL (href) a {@code $CMS_REF(page:...)} should emit for a page, relative to the
     * site root. With {@code urlStrategy=PRETTY} and {@code trailingSlash} this is the directory
     * form ({@code products/hammer/}, the site root as {@code ./}); otherwise it matches the
     * concrete output path.
     */
    public String resolvePageUrl(UUID pageUuid, String channel) {
        return OutputPathExpander.urlForPath(resolvePagePath(pageUuid, channel), settingsFor(channel));
    }

    /** First-resolved owner (path → page UUID) of each output path; populated by {@link #findCollisions}. */
    public Map<String, UUID> collisionOwners() {
        return collisionOwners;
    }

    /**
     * Detects output-path collisions among resolved entries: two distinct pages mapping to the
     * same path. Records first-path ownership and returns one {@link Collision} per colliding
     * path (each naming the first two distinct asset UIDs).
     */
    public List<Collision> findCollisions(List<PlanEntry> entries) {
        Map<String, UUID> owners = new HashMap<>();
        List<Collision> collisions = new ArrayList<>();
        for (PlanEntry entry : entries == null ? List.<PlanEntry>of() : entries) {
            UUID previous = owners.putIfAbsent(entry.outputPath(), entry.pageUuid());
            if (previous != null && !previous.equals(entry.pageUuid())) {
                collisions.add(new Collision(entry.outputPath(), uidOf(previous), uidOf(entry.pageUuid())));
            }
        }
        this.collisionOwners = Map.copyOf(owners);
        return List.copyOf(collisions);
    }

    /** A single output-path collision between two distinct pages. */
    public record Collision(String path, String uidA, String uidB) {}

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
