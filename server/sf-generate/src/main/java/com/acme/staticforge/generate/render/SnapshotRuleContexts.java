package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.rules.RuleContextProvider;
import com.acme.staticforge.asset.rules.RuleContexts;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * What a build's editor rules read beyond the page (M33.7): the snapshot — the released state the build renders —
 * in the language validated. Property sets and referenced assets resolve as the build renders them; a page's
 * {@code release.status} is {@code PUBLISHED} (or {@code NEW} for an unreleased page a draft build renders). One per
 * build; caches what it reads. Not thread-safe.
 */
final class SnapshotRuleContexts {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private final Snapshot snapshot;
    private final LocalizationContext localization;
    private final Map<String, Map<String, SnapshotAsset>> globalsByLocale = new HashMap<>();
    private final Map<String, JsonNode> refs = new HashMap<>();

    SnapshotRuleContexts(Snapshot snapshot, LocalizationContext localization) {
        this.snapshot = snapshot;
        this.localization = localization;
    }

    /** The context of {@code page}, rendered with {@code template}. */
    RuleContextProvider of(SnapshotAsset page, SnapshotAsset template) {
        return new RuleContextProvider() {
            private JsonNode meta;

            @Override
            public JsonNode meta() {
                if (meta == null) {
                    ObjectNode out = JSON.objectNode();
                    out.put("uid", page.uid());
                    out.put("uuid", page.uuid().toString());
                    out.put("name", page.displayName());
                    out.put("path", page.folderPath());
                    out.put("template", template == null ? null : template.uid());
                    meta = out;
                }
                return meta;
            }

            @Override
            public JsonNode release(String locale) {
                return JSON.objectNode().put("status", page.unreleased() ? "NEW" : "PUBLISHED");
            }

            @Override
            public JsonNode global(String setUid, String locale) {
                SnapshotAsset set = globals(locale).get(setUid);
                return set == null ? null : resolve(set.payload().path("content"), locale);
            }

            @Override
            public JsonNode ref(JsonNode value, String locale) {
                return SnapshotRuleContexts.this.ref(value, locale);
            }
        };
    }

    private Map<String, SnapshotAsset> globals(String locale) {
        return globalsByLocale.computeIfAbsent(locale == null ? "" : locale, key -> {
            Map<String, SnapshotAsset> byUid = new HashMap<>();
            for (SnapshotAsset set : view(locale).assetsOfType(AssetType.GLOBAL_SET)) {
                if (!set.deleted() && set.uid() != null) {
                    byUid.put(set.uid(), set);
                }
            }
            return byUid;
        });
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
            return Optional.ofNullable(view(locale).assetByUuid(target))
                    .filter(asset -> !asset.deleted())
                    .map(asset -> RuleContexts.view(asset.type(), asset.uid(), asset.displayName(), asset.folderPath(),
                            resolve(asset.payload(), locale), asset.unreleased() ? "NEW" : "PUBLISHED"))
                    .orElse(null);
        });
    }

    private Snapshot view(String locale) {
        return locale == null ? snapshot : snapshot.in(locale);
    }

    private JsonNode resolve(JsonNode node, String locale) {
        return localization.localized() ? L10nValues.resolveDeep(node, localization.chain(locale)) : node;
    }
}
