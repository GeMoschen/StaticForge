package com.acme.staticforge.generate.quality;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.project.LocaleConfig;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * What a check knows besides the document (M30): the target's {@code baseUrl}, the project's locales, the channels'
 * output settings, how to name an asset, every output a link can resolve to — the build's outputs (new, carried,
 * media, site files) in a build, the draft's planned paths in a draft check (M30.3.1) — and the renderer's reference
 * events of the outputs it checks. Page rules read other outputs only through here, so the same rule works in both.
 *
 * <p>Thread-safe: shared by every page check of a build.
 */
public final class CheckEnvironment {

    private final String baseUrl;
    private final LocaleConfig locales;
    private final Map<String, IndexedOutput> outputs;
    private final Function<String, ChannelOutputSettings> channels;
    private final Function<UUID, AssetLabel> assets;
    private final Map<String, List<ReferenceEvent>> references;
    private final Map<String, LinkResolver> resolvers = new ConcurrentHashMap<>();

    /**
     * @param baseUrl the target's {@code baseUrl}; blank when it has none
     * @param locales the project's locales; {@code null} reads as a project without locales
     * @param outputs every output a link can resolve to, by path
     * @param channels a channel's output settings (unknown channels get their defaults)
     * @param assets names an asset by uuid; {@code null} when it doesn't know it
     */
    public CheckEnvironment(
            String baseUrl,
            LocaleConfig locales,
            Map<String, IndexedOutput> outputs,
            Function<String, ChannelOutputSettings> channels,
            Function<UUID, AssetLabel> assets) {
        this(baseUrl, locales, outputs, channels, assets, Map.of());
    }

    /**
     * An environment that also knows the renderer's reference events of the outputs it checks page by page.
     *
     * @param references by output path, the references the renderer could not resolve while rendering it
     */
    public CheckEnvironment(
            String baseUrl,
            LocaleConfig locales,
            Map<String, IndexedOutput> outputs,
            Function<String, ChannelOutputSettings> channels,
            Function<UUID, AssetLabel> assets,
            Map<String, List<ReferenceEvent>> references) {
        this.baseUrl = baseUrl == null ? "" : baseUrl;
        this.locales = LocaleConfig.orEmpty(locales);
        this.outputs = Map.copyOf(outputs);
        this.channels = channels == null ? ChannelOutputSettings::defaults : channels;
        this.assets = assets == null ? uuid -> null : assets;
        this.references = references == null ? Map.of() : Map.copyOf(references);
    }

    /** The target's {@code baseUrl}; {@code ""} when it has none. */
    public String baseUrl() {
        return baseUrl;
    }

    public LocaleConfig locales() {
        return locales;
    }

    /** Whether the project has locales (M24). */
    public boolean localized() {
        return locales.isLocalized();
    }

    /** Every output a link can resolve to, by path. */
    public Map<String, IndexedOutput> outputs() {
        return outputs;
    }

    /** The output at {@code path}. */
    public Optional<IndexedOutput> output(String path) {
        return Optional.ofNullable(path == null ? null : outputs.get(path));
    }

    /** The output settings of {@code channel}. */
    public ChannelOutputSettings channelSettings(String channel) {
        ChannelOutputSettings settings = channel == null ? null : channels.apply(channel);
        return settings != null ? settings : ChannelOutputSettings.defaults(channel);
    }

    /** Whether {@code channel} writes HTML (its file extension is {@code html} or {@code htm}) — the only channels checked. */
    public boolean isHtmlChannel(String channel) {
        if (channel == null) {
            return false;
        }
        String extension = channelSettings(channel).extension().toLowerCase(Locale.ROOT);
        return extension.equals("html") || extension.equals("htm");
    }

    /** The resolver for links written in an output of {@code channel}: its directory URLs serve the channel's index file. */
    public LinkResolver resolverFor(String channel) {
        return resolvers.computeIfAbsent(
                channel == null ? "" : channel,
                key -> new LinkResolver(baseUrl, channelSettings(channel).indexFileName()));
    }

    /**
     * The references the renderer could not resolve while rendering the output at {@code path} (they rendered
     * {@code ""}): a page rule reads them to leave an empty {@code href} to the rule that names the target.
     */
    public List<ReferenceEvent> referenceEvents(String path) {
        return path == null ? List.of() : references.getOrDefault(path, List.of());
    }

    /** How to name asset {@code uuid} in a message. */
    public Optional<AssetLabel> asset(UUID uuid) {
        return Optional.ofNullable(uuid == null ? null : assets.apply(uuid));
    }
}
