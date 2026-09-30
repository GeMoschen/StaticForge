package com.acme.staticforge.asset.rules;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.AssetValueProjection;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ContentViews;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseStatusService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The live {@link RuleContextProvider}s (M33.4): what the rule engine reads beyond the content when an editor edits or
 * saves — the <b>drafts</b> of property sets and referenced assets (epic decision 4, user decision 20), the asset's
 * release status per language, and its meta. One provider per evaluation; it caches what it reads.
 */
@Component
public class RuleContexts {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private final AssetRepository assetRepository;
    private final AssetVersionRepository versionRepository;
    private final ReleaseStatusService releaseStatus;
    private final ProjectLocales projectLocales;
    private final ContentViews contentViews;

    public RuleContexts(
            AssetRepository assetRepository,
            AssetVersionRepository versionRepository,
            ReleaseStatusService releaseStatus,
            ProjectLocales projectLocales,
            ContentViews contentViews) {
        this.assetRepository = assetRepository;
        this.versionRepository = versionRepository;
        this.releaseStatus = releaseStatus;
        this.projectLocales = projectLocales;
        this.contentViews = contentViews;
    }

    /**
     * The draft context of an asset being edited or saved.
     *
     * @param assetUuid the asset ({@code null} while it is being created: status {@code NEW}, no uid)
     * @param type {@code PAGE}, {@code RECORD} or {@code GLOBAL_SET}
     * @param payload the payload being evaluated (for a page's template)
     * @param displayName its display name, {@code null} to read it from the stored version
     */
    public RuleContextProvider draft(long projectId, UUID assetUuid, AssetType type, JsonNode payload, String displayName) {
        return new Draft(projectId, assetUuid, type, payload, displayName);
    }

    private final class Draft implements RuleContextProvider {

        private final long projectId;
        private final UUID assetUuid;
        private final AssetType type;
        private final JsonNode payload;
        private final String displayName;
        private LocalizationContext localization;
        private final Map<String, JsonNode> globals = new HashMap<>();
        private final Map<String, JsonNode> refs = new HashMap<>();
        private Map<String, LocaleRelease> release;
        private JsonNode meta;

        Draft(long projectId, UUID assetUuid, AssetType type, JsonNode payload, String displayName) {
            this.projectId = projectId;
            this.assetUuid = assetUuid;
            this.type = type;
            this.payload = payload;
            this.displayName = displayName;
        }

        @Override
        public JsonNode meta() {
            if (meta == null) {
                ObjectNode out = JSON.objectNode();
                Optional<Asset> asset = assetUuid == null ? Optional.empty() : assetRepository.findByProjectIdAndUuid(projectId, assetUuid);
                Optional<AssetVersion> version = asset.flatMap(a -> versionRepository.findByAssetIdAndValidToRevisionIsNull(a.getId()));
                out.put("uid", asset.map(Asset::getUid).orElse(null));
                out.put("uuid", assetUuid == null ? null : assetUuid.toString());
                out.put("name", displayName != null ? displayName : version.map(AssetVersion::getDisplayName).orElse(null));
                out.put("path", version.map(AssetVersion::getFolderPath).orElse(null));
                if (type == AssetType.PAGE) {
                    out.put("template", uidOf(payload == null ? null : payload.path("templateRef").asText(null)));
                } else if (type == AssetType.RECORD) {
                    out.put("dataset", uidOf(payload == null ? null : payload.path("datasetRef").asText(null)));
                }
                meta = out;
            }
            return meta;
        }

        @Override
        public JsonNode release(String locale) {
            if (release == null) {
                release = assetUuid == null ? Map.of() : releaseStatus.ofAsset(projectId, assetUuid);
            }
            LocaleRelease state = release.get(locale == null ? "" : locale);
            if (state == null) {
                state = release.get("");
            }
            return JSON.objectNode().put("status", state == null ? "NEW" : state.status().name());
        }

        @Override
        public JsonNode global(String setUid, String locale) {
            return globals.computeIfAbsent(setUid + "|" + locale, key -> assetRepository
                    .findByProjectIdAndAssetTypeAndUid(projectId, AssetType.GLOBAL_SET, setUid)
                    .flatMap(asset -> versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                    .filter(version -> !version.isDeleted())
                    .map(version -> resolve(version.getPayload().path("content"), locale))
                    .orElse(null));
        }

        @Override
        public JsonNode ref(JsonNode value, String locale) {
            String uuid = value.path("uuid").asText("");
            if (uuid.isEmpty()) {
                return null;
            }
            return refs.computeIfAbsent(uuid + "|" + locale, key -> {
                UUID target;
                try {
                    target = UUID.fromString(uuid);
                } catch (IllegalArgumentException e) {
                    return null;
                }
                return assetRepository.findByProjectIdAndUuid(projectId, target)
                        .flatMap(asset -> versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                                .filter(version -> !version.isDeleted())
                                .map(version -> view(asset, version, releaseStatus.ofAsset(projectId, target), locale)))
                        .orElse(null);
            });
        }

        private JsonNode resolve(JsonNode node, String locale) {
            if (localization == null) {
                localization = LocalizationContext.of(projectLocales.forProject(projectId));
            }
            return localization.localized() ? L10nValues.resolveDeep(node, localization.chain(locale)) : node;
        }

        private String uidOf(String uuid) {
            if (uuid == null || uuid.isBlank()) {
                return null;
            }
            try {
                return assetRepository.findByProjectIdAndUuid(projectId, UUID.fromString(uuid)).map(Asset::getUid).orElse(null);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }

        private JsonNode view(Asset asset, AssetVersion version, Map<String, LocaleRelease> states, String locale) {
            LocaleRelease state = states.get(locale == null ? "" : locale);
            if (state == null) {
                state = states.get("");
            }
            return RuleContexts.view(asset.getAssetType(), asset.getUid(), version.getDisplayName(), version.getFolderPath(),
                    resolve(version.getPayload(), locale), state == null ? null : state.status().name());
        }
    }

    // ------------------------------------------------------------------
    // Released state (M33.6)
    // ------------------------------------------------------------------

    /**
     * The state a release's rules read, shared by every asset of one release call: property sets and referenced
     * assets at their <b>released</b> versions in the language checked — or, when this release releases them too, at
     * the version it releases (user decision 20). Reads lazily and caches; nothing is read until a rule asks.
     *
     * @param releasing the versions this release opens, by asset uuid
     */
    public ReleasedState releasedState(long projectId, Map<UUID, AssetVersion> releasing) {
        return new ReleasedState(projectId, releasing);
    }

    /** See {@link #releasedState}. Not thread-safe; one per release call. */
    public final class ReleasedState {

        private final long projectId;
        private final Map<UUID, AssetVersion> releasing;
        private final Map<String, ContentView> views = new HashMap<>();
        private final Map<String, JsonNode> globals = new HashMap<>();
        private final Map<String, JsonNode> refs = new HashMap<>();
        private final Map<UUID, Optional<String>> uids = new HashMap<>();
        private LocalizationContext localization;

        private ReleasedState(long projectId, Map<UUID, AssetVersion> releasing) {
            this.projectId = projectId;
            this.releasing = releasing == null ? Map.of() : releasing;
        }

        /**
         * The context of one asset being released: its {@code meta} from what the release already holds, its release
         * {@code statuses} (by locale key) as they are before this release.
         */
        public RuleContextProvider of(Asset asset, AssetVersion version, Map<String, LocaleRelease> statuses) {
            return new RuleContextProvider() {
                private JsonNode meta;

                @Override
                public JsonNode meta() {
                    if (meta == null) {
                        ObjectNode out = JSON.objectNode();
                        out.put("uid", asset.getUid());
                        out.put("uuid", asset.getUuid().toString());
                        out.put("name", version.getDisplayName());
                        out.put("path", version.getFolderPath());
                        JsonNode payload = version.getPayload();
                        if (asset.getAssetType() == AssetType.PAGE) {
                            out.put("template", uidOf(payload.path("templateRef").asText(null)));
                        } else if (asset.getAssetType() == AssetType.RECORD) {
                            out.put("dataset", uidOf(payload.path("datasetRef").asText(null)));
                        }
                        meta = out;
                    }
                    return meta;
                }

                @Override
                public JsonNode release(String locale) {
                    Map<String, LocaleRelease> known = statuses == null ? Map.of() : statuses;
                    LocaleRelease state = known.get(locale == null ? "" : locale);
                    if (state == null) {
                        state = known.get("");
                    }
                    return JSON.objectNode().put("status", state == null ? "NEW" : state.status().name());
                }

                @Override
                public JsonNode global(String setUid, String locale) {
                    return ReleasedState.this.global(setUid, locale);
                }

                @Override
                public JsonNode ref(JsonNode value, String locale) {
                    return ReleasedState.this.ref(value, locale);
                }
            };
        }

        private JsonNode global(String setUid, String locale) {
            return globals.computeIfAbsent(setUid + "|" + locale, key -> assetRepository
                    .findByProjectIdAndAssetTypeAndUid(projectId, AssetType.GLOBAL_SET, setUid)
                    .flatMap(asset -> released(asset, locale))
                    .map(version -> resolve(version.getPayload().path("content"), locale))
                    .orElse(null));
        }

        private JsonNode ref(JsonNode value, String locale) {
            String uuid = value.path("uuid").asText("");
            if (uuid.isEmpty()) {
                return null;
            }
            return refs.computeIfAbsent(uuid + "|" + locale, key -> {
                UUID target;
                try {
                    target = UUID.fromString(uuid);
                } catch (IllegalArgumentException e) {
                    return null;
                }
                return assetRepository.findByProjectIdAndUuid(projectId, target)
                        .flatMap(asset -> released(asset, locale).map(version -> RuleContexts.view(
                                asset.getAssetType(), asset.getUid(), version.getDisplayName(), version.getFolderPath(),
                                resolve(version.getPayload(), locale),
                                releasing.containsKey(target) ? "PUBLISHED" : status(target, locale))))
                        .orElse(null);
            });
        }

        /** The version of {@code asset} released in {@code locale}, or the one this release releases. */
        private Optional<AssetVersion> released(Asset asset, String locale) {
            AssetVersion inRelease = releasing.get(asset.getUuid());
            if (inRelease != null) {
                return inRelease.isDeleted() ? Optional.empty() : Optional.of(inRelease);
            }
            ContentView view = views.computeIfAbsent(locale == null ? "" : locale,
                    key -> contentViews.open(projectId, null, ContentView.Kind.PUBLISHED, locale));
            return view.resolve(asset).map(ContentView.Resolved::version);
        }

        private String status(UUID uuid, String locale) {
            Map<String, LocaleRelease> states = releaseStatus.ofAsset(projectId, uuid);
            LocaleRelease state = states.get(locale == null ? "" : locale);
            if (state == null) {
                state = states.get("");
            }
            return state == null ? null : state.status().name();
        }

        private JsonNode resolve(JsonNode node, String locale) {
            if (localization == null) {
                localization = LocalizationContext.of(projectLocales.forProject(projectId));
            }
            return localization.localized() ? L10nValues.resolveDeep(node, localization.chain(locale)) : node;
        }

        private String uidOf(String uuid) {
            if (uuid == null || uuid.isBlank()) {
                return null;
            }
            UUID parsed;
            try {
                parsed = UUID.fromString(uuid);
            } catch (IllegalArgumentException e) {
                return null;
            }
            return uids.computeIfAbsent(parsed, key -> assetRepository.findByProjectIdAndUuid(projectId, key).map(Asset::getUid))
                    .orElse(null);
        }
    }

    /**
     * The read-only view {@code ref(value)} returns (epic decision 4): {@code uid}, {@code name}, {@code path},
     * {@code type}, {@code content} — the asset's root value object, as a template reads it through
     * {@code $CMS_VALUE(page:…)} ({@link AssetValueProjection}) — {@code meta} — a media file's descriptive fields
     * ({@code alt} = its alt text, {@code caption}, …) or a page's {@code meta} — {@code mimeType} for media and
     * {@code release} ({@code {status}}) where known. Shared by the draft and the released contexts.
     */
    public static JsonNode view(AssetType type, String uid, String name, String path, JsonNode payload, String status) {
        ObjectNode view = JSON.objectNode();
        view.put("uid", uid);
        view.put("name", name);
        view.put("path", path);
        view.put("type", type.name());
        JsonNode content = AssetValueProjection.project(type, uid, name, payload, false);
        view.set("content", content);
        ObjectNode meta = JSON.objectNode();
        if (type == AssetType.MEDIA) {
            if (content.isObject()) {
                content.fields().forEachRemaining(field -> {
                    if (!AssetValueProjection.META.equals(field.getKey())) {
                        meta.set(field.getKey(), field.getValue());
                    }
                });
            }
            meta.set("alt", content.path("altText").isMissingNode() ? JSON.nullNode() : content.get("altText"));
            view.set("mimeType", payload.path("mimeType").isMissingNode() ? JSON.nullNode() : payload.get("mimeType"));
        } else if (payload.path("meta").isObject()) {
            meta.setAll((ObjectNode) payload.get("meta"));
        }
        view.set("meta", meta);
        view.set("release", status == null ? JSON.nullNode() : JSON.objectNode().put("status", status));
        return view;
    }
}
