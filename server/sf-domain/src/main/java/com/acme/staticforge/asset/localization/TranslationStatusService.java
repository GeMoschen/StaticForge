package com.acme.staticforge.asset.localization;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Which languages an asset is still missing translations in (M24.4.2).
 *
 * <p>Computed from the current versions on request — no stored counters to keep in sync, and no
 * second definition of "missing" for the UI to drift from. A page counts its own values and those of
 * every section instance and catalog card inside it, because that is what an editor sees on the page.
 */
@Service
public class TranslationStatusService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final TemplateHierarchies hierarchies;
    private final PageContentValidation pageContentValidation;
    private final ProjectLocales projectLocales;

    public TranslationStatusService(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            TemplateHierarchies hierarchies,
            PageContentValidation pageContentValidation,
            ProjectLocales projectLocales) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.hierarchies = hierarchies;
        this.pageContentValidation = pageContentValidation;
        this.projectLocales = projectLocales;
    }

    /** The status of one asset; {@link TranslationStatus#none} in a project without languages. */
    @Transactional(readOnly = true)
    public TranslationStatus of(long projectId, UUID assetUuid) {
        LocaleConfig locales = projectLocales.forProject(projectId);
        if (!locales.isLocalized()) {
            return TranslationStatus.none(assetUuid);
        }
        AssetVersion version = assetRepository
                .findByProjectIdAndUuid(projectId, assetUuid)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .filter(v -> !v.isDeleted())
                .orElse(null);
        if (version == null) {
            return TranslationStatus.none(assetUuid);
        }
        return statusOf(projectId, assetUuid, version.getPayload(), locales, pageContentValidation.sectionTemplates(projectId));
    }

    /**
     * The status of every content-holding asset of the project, in asset order — what a list view's
     * "missing in en" filter reads. Computed in one pass over the current versions so a large project
     * costs one query per asset type rather than one per asset.
     */
    @Transactional(readOnly = true)
    public List<TranslationStatus> ofProject(long projectId, AssetType type) {
        LocaleConfig locales = projectLocales.forProject(projectId);
        if (!locales.isLocalized()) {
            return List.of();
        }
        SectionTemplateLookup sections = pageContentValidation.sectionTemplates(projectId);
        List<AssetType> types = type != null
                ? List.of(type)
                : List.of(AssetType.PAGE, AssetType.GLOBAL_SET, AssetType.RECORD);
        Map<UUID, ContentDefinition> definitions = new LinkedHashMap<>();
        List<TranslationStatus> out = new ArrayList<>();
        for (AssetType each : types) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, each)) {
                if (version.isDeleted()) {
                    continue;
                }
                UUID uuid = uuidOf(version);
                if (uuid == null) {
                    continue;
                }
                out.add(statusOf(projectId, uuid, version.getPayload(), locales, sections, definitions));
            }
        }
        return List.copyOf(out);
    }

    private UUID uuidOf(AssetVersion version) {
        Asset asset = version.getAsset();
        if (asset != null) {
            return asset.getUuid();
        }
        return assetRepository.findById(version.getAssetId()).map(Asset::getUuid).orElse(null);
    }

    private TranslationStatus statusOf(
            long projectId,
            UUID assetUuid,
            JsonNode payload,
            LocaleConfig locales,
            SectionTemplateLookup sections) {
        return statusOf(projectId, assetUuid, payload, locales, sections, new LinkedHashMap<>());
    }

    private TranslationStatus statusOf(
            long projectId,
            UUID assetUuid,
            JsonNode payload,
            LocaleConfig locales,
            SectionTemplateLookup sections,
            Map<UUID, ContentDefinition> definitions) {
        Counter counter = new Counter(locales);

        ContentDefinition own = ownDefinition(projectId, payload, definitions);
        if (own != null) {
            counter.count(payload.path("content"), own);
        }
        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.forEach(body -> {
                if (body.isArray()) {
                    body.forEach(section -> countInstance(section, sections, counter));
                }
            });
        }
        countCards(payload.path("content"), sections, counter);
        return counter.build(assetUuid);
    }

    private void countInstance(JsonNode instance, SectionTemplateLookup sections, Counter counter) {
        if (instance == null || !instance.isObject()) {
            return;
        }
        Optional<SectionTemplateLookup.SectionTemplate> template =
                sections.find(instance.path("templateRef").asText(""));
        if (template.isEmpty()) {
            return;
        }
        counter.count(instance.path("content"), template.get().definition());
        countCards(instance.path("content"), sections, counter);
    }

    private void countCards(JsonNode content, SectionTemplateLookup sections, Counter counter) {
        if (content == null || !content.isObject()) {
            return;
        }
        content.forEach(value -> {
            if (value.isObject() && "CATALOG".equals(value.path("type").asText(null))) {
                value.path("cards").forEach(card -> countInstance(card, sections, counter));
            }
        });
    }

    private ContentDefinition ownDefinition(long projectId, JsonNode payload, Map<UUID, ContentDefinition> cache) {
        String templateRef = payload.path("templateRef").asText(null);
        if (templateRef != null) {
            UUID uuid = parse(templateRef);
            return uuid == null
                    ? null
                    : cache.computeIfAbsent(uuid, key -> hierarchies.live(projectId)
                            .effectiveDefinition(key)
                            .map(effective -> effective.definition())
                            .orElse(null));
        }
        if (payload.has("contentDefinition") || payload.has("compiledDefinition")) {
            return TemplateContentDefinitions.of(payload);
        }
        UUID dataset = parse(payload.path("datasetRef").asText(null));
        if (dataset == null) {
            return null;
        }
        return cache.computeIfAbsent(dataset, key -> assetRepository.findByProjectIdAndUuid(projectId, key)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .map(version -> TemplateContentDefinitions.of(version.getPayload()))
                .orElse(null));
    }

    private static UUID parse(String value) {
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Walks content by definition, counting per language what has a default value but no translation. */
    private static final class Counter {

        private final LocaleConfig locales;
        private final Map<String, Integer> missing = new LinkedHashMap<>();
        private final Set<String> orphaned = new LinkedHashSet<>();
        private int total;

        Counter(LocaleConfig locales) {
            this.locales = locales;
            locales.codes().forEach(code -> missing.put(code, 0));
        }

        void count(JsonNode content, ContentDefinition definition) {
            if (content == null || !content.isObject() || definition == null) {
                return;
            }
            for (EditorDefinition editor : definition.editors()) {
                visit(editor, content);
            }
        }

        private void visit(EditorDefinition editor, JsonNode content) {
            if (editor.isGroup()) {
                editor.items().forEach(item -> visit(item, content));
                return;
            }
            JsonNode value = content.get(editor.name());
            if (editor.isList()) {
                if (value != null && value.isArray()) {
                    value.forEach(item -> {
                        if (item.isObject()) {
                            editor.items().forEach(child -> visit(child, item));
                        }
                    });
                }
                return;
            }
            if (!editor.localizable() || value == null) {
                return;
            }
            orphaned.addAll(L10nValues.orphanedLocales(value, locales.codes()));
            // Only a field the default language actually fills is one the others owe a translation for.
            if (L10nValues.get(value, locales.defaultLocale()) == null) {
                return;
            }
            total++;
            for (String code : locales.codes()) {
                if (!code.equals(locales.defaultLocale()) && L10nValues.get(value, code) == null) {
                    missing.merge(code, 1, Integer::sum);
                }
            }
        }

        TranslationStatus build(UUID assetUuid) {
            List<TranslationStatus.LocaleStatus> statuses = new ArrayList<>();
            for (String code : locales.codes()) {
                statuses.add(new TranslationStatus.LocaleStatus(code, missing.getOrDefault(code, 0), total));
            }
            return new TranslationStatus(assetUuid, statuses, List.copyOf(orphaned));
        }
    }
}
