package com.acme.staticforge.urlregistry;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.StartPage;
import com.acme.staticforge.channel.ChannelOutputSettings;
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
 * <p>Stateless; takes an explicit {@code projectId} for every asset uuid lookup, matching
 * {@code LiveNavigationLookup}'s (now-corrected) convention.
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
    public Optional<String> resolveUrl(long projectId, UUID pageUuid, String channel, ChannelOutputSettings settings) {
        return resolveUrl(projectId, pageUuid, channel, settings, OutputPathExpander.LocaleContext.NONE);
    }

    /** As {@link #resolveUrl(long, UUID, String, ChannelOutputSettings)}, for one language (M24.3.2). */
    public Optional<String> resolveUrl(
            long projectId,
            UUID pageUuid,
            String channel,
            ChannelOutputSettings settings,
            OutputPathExpander.LocaleContext locale) {
        return pageContext(projectId, pageUuid)
                .map(context -> normalize(OutputPathExpander.resolveUrl(context, channel, settings, locale)));
    }

    private Optional<OutputPathExpander.PageContext> pageContext(long projectId, UUID pageUuid) {
        if (pageUuid == null) {
            return Optional.empty();
        }
        return assetRepository
                .findByProjectIdAndUuid(projectId, pageUuid)
                .flatMap(asset -> currentVersion(asset.getId()).map(version -> {
                    UUID startPage = effectiveStartPage(projectId, version.getFolderId());
                    return new OutputPathExpander.PageContext(
                            asset.getUid(),
                            version.getDisplayName(),
                            version.getFolderPath(),
                            version.getPayload(),
                            templatePayload(projectId, version.getPayload()),
                            pageUuid.equals(startPage),
                            startPage != null);
                }));
    }

    /**
     * The live effective start page (M31) of the folder {@code folderUuid}: the page its current {@code startPage}
     * names when that page is live and still lives in the folder; {@code null} when the folder has none, isn't a live
     * pages folder, or its pointer is stale (the folder then falls back to the channel's {@code indexUid} rule).
     */
    public UUID startPageOf(long projectId, UUID folderUuid) {
        if (folderUuid == null) {
            return null;
        }
        return assetRepository.findByProjectIdAndUuid(projectId, folderUuid)
                .map(folder -> effectiveStartPage(projectId, folder.getId()))
                .orElse(null);
    }

    private UUID effectiveStartPage(long projectId, Long folderId) {
        if (folderId == null) {
            return null;
        }
        UUID pointer = currentVersion(folderId)
                .filter(folder -> FolderScope.fromPayload(folder.getPayload()) == FolderScope.PAGES)
                .map(folder -> StartPage.fromPayload(folder.getPayload()))
                .orElse(null);
        if (pointer == null) {
            return null;
        }
        return assetRepository.findByProjectIdAndUuid(projectId, pointer)
                .filter(page -> page.getAssetType() == AssetType.PAGE)
                .flatMap(page -> currentVersion(page.getId()))
                .filter(page -> folderId.equals(page.getFolderId()))
                .map(page -> pointer)
                .orElse(null);
    }

    private JsonNode templatePayload(long projectId, JsonNode payload) {
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
                .findByProjectIdAndUuid(projectId, templateUuid)
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
