package com.acme.staticforge.urlregistry;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.channel.OutputPathExpander;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Computes a page's URL for a channel against the live repositories, without a
 * {@code Snapshot}/generation run (`M8.2.2`). {@code OutputPathExpander} (the placeholder
 * expansion algorithm extracted from {@code OutputPathResolver} in sf-generate) already takes a
 * module-agnostic {@code PageContext}, so this class only has to adapt that shape onto the live
 * {@code Asset}/{@code AssetVersion} rows — mirroring exactly how {@code LiveNavigationLookup}
 * adapts {@code NavigationLookup} onto the same repositories for the same live/preview vs.
 * snapshot/generation split. Guarantees a {@code PREVIEW} URL (this class) and a
 * {@code GENERATED} URL (generation's {@code OutputPathResolver}, wrapping the same
 * {@code OutputPathExpander}) for the same page+channel are computed identically whenever the
 * page's live state matches what a given revision's snapshot would show — sf-domain cannot
 * depend on sf-generate, so a live equivalent (not a Snapshot bypass) was the only option.
 *
 * <p>Stateless; asset uuids are globally unique so no project scoping is needed here, matching
 * {@code LiveNavigationLookup}'s convention.
 */
@Component
public class LiveOutputPathResolver {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;

    public LiveOutputPathResolver(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    /**
     * Resolves the URL (href) a page should have for a channel, using the same §18.3
     * placeholder-resolution order as generation. Empty when the page uuid doesn't resolve to a
     * live, non-deleted asset.
     */
    public Optional<String> resolveUrl(
            UUID pageUuid, String channel, String indexUid, boolean trailingSlash, String urlStrategy) {
        return pageContext(pageUuid)
                .map(context -> normalize(OutputPathExpander.resolveUrl(context, channel, indexUid, trailingSlash, urlStrategy)));
    }

    private Optional<OutputPathExpander.PageContext> pageContext(UUID pageUuid) {
        if (pageUuid == null) {
            return Optional.empty();
        }
        return assetRepository
                .findByUuid(pageUuid)
                .flatMap(asset -> currentVersion(asset.getId())
                        .map(version -> new OutputPathExpander.PageContext(
                                asset.getUid(),
                                version.getDisplayName(),
                                version.getFolderPath(),
                                version.getPayload(),
                                templatePayload(version.getPayload()))));
    }

    private JsonNode templatePayload(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        String ref = payload.path("templateRef").asText();
        if (ref.isBlank()) {
            return null;
        }
        UUID templateUuid;
        try {
            templateUuid = UUID.fromString(ref);
        } catch (IllegalArgumentException e) {
            return null;
        }
        return assetRepository
                .findByUuid(templateUuid)
                .flatMap(template -> currentVersion(template.getId()))
                .map(AssetVersion::getPayload)
                .orElse(null);
    }

    private Optional<AssetVersion> currentVersion(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).filter(v -> !v.isDeleted());
    }

    /** Strips backslashes/leading slashes so a stored URL is always relative, matching generation's output-path form. */
    private static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String path = raw.replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        return path;
    }
}
