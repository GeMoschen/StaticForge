package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.search.SearchProperties;
import com.acme.staticforge.search.TextCap;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Builds the {@link ExtractionContext} of one indexing pass over a project's current state (M23.1.2). Definitions
 * compile through {@link CompiledTemplateCache}, keyed by template version, so a changed template is a new key and
 * nothing needs invalidating; within the pass each template is looked up once. Must be used inside a transaction.
 */
@Component
public class LiveExtractionContexts {

    private static final Logger log = LoggerFactory.getLogger(LiveExtractionContexts.class);

    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final TemplateHierarchies hierarchies;
    private final CompiledTemplateCache compiledTemplates;
    private final BlobStore blobStore;
    private final SearchProperties properties;

    public LiveExtractionContexts(
            AssetRepository assets,
            AssetVersionRepository versions,
            TemplateHierarchies hierarchies,
            CompiledTemplateCache compiledTemplates,
            BlobStore blobStore,
            SearchProperties properties) {
        this.assets = assets;
        this.versions = versions;
        this.hierarchies = hierarchies;
        this.compiledTemplates = compiledTemplates;
        this.blobStore = blobStore;
        this.properties = properties;
    }

    /** A context over {@code projectId}'s current assets, memoizing lookups for one pass. */
    public ExtractionContext forPass(long projectId) {
        return new Live(projectId, hierarchies.live(projectId));
    }

    private final class Live implements ExtractionContext {

        private final long projectId;
        private final TemplateHierarchy hierarchy;
        private final Map<UUID, Optional<ContentDefinition>> pageTemplates = new ConcurrentHashMap<>();
        private final Map<UUID, Optional<ContentDefinition>> sectionTemplates = new ConcurrentHashMap<>();
        private final Map<UUID, Optional<ContentDefinition>> datasets = new ConcurrentHashMap<>();
        private final Map<UUID, Optional<String>> datasetNames = new ConcurrentHashMap<>();

        Live(long projectId, TemplateHierarchy hierarchy) {
            this.projectId = projectId;
            this.hierarchy = hierarchy;
        }

        @Override
        public Optional<ContentDefinition> pageTemplateDefinition(UUID pageTemplate) {
            return pageTemplates.computeIfAbsent(
                    pageTemplate, uuid -> hierarchy.effectiveDefinition(uuid).map(EffectiveDefinition::definition));
        }

        @Override
        public Optional<ContentDefinition> sectionTemplateDefinition(UUID sectionTemplate) {
            return sectionTemplates.computeIfAbsent(sectionTemplate, uuid -> own(uuid, AssetType.SECTION_TEMPLATE));
        }

        @Override
        public Optional<ContentDefinition> datasetDefinition(UUID dataset) {
            return datasets.computeIfAbsent(dataset, uuid -> own(uuid, AssetType.DATASET));
        }

        @Override
        public Optional<String> datasetName(UUID dataset) {
            return datasetNames.computeIfAbsent(dataset, uuid -> assets.findByProjectIdAndUuid(projectId, uuid)
                    .filter(asset -> asset.getAssetType() == AssetType.DATASET)
                    .flatMap(asset -> versions.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                    .filter(version -> !version.isDeleted())
                    .map(version -> version.getDisplayName()));
        }

        @Override
        public ContentDefinition definition(UUID owner, long revision, CdlSources cdlSource) {
            return compiledTemplates.definition(projectId, owner, revision, cdlSource == null ? CdlSources.EMPTY : cdlSource);
        }

        @Override
        public Optional<String> blobText(String sha256) {
            try {
                byte[] bytes = blobStore.get(sha256);
                return Optional.of(TextCap.cap(new String(bytes, StandardCharsets.UTF_8), properties.maxTextChars()));
            } catch (RuntimeException e) {
                log.debug("Blob {} of project {} can't be read for search", sha256, projectId, e);
                return Optional.empty();
            }
        }

        @Override
        public int maxTextChars() {
            return properties.maxTextChars();
        }

        private Optional<ContentDefinition> own(UUID uuid, AssetType type) {
            return assets.findByProjectIdAndUuid(projectId, uuid)
                    .filter(asset -> asset.getAssetType() == type)
                    .flatMap(asset -> versions.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                            .filter(version -> !version.isDeleted())
                            .map(version -> definition(
                                    uuid,
                                    version.getValidFromRevision(),
                                    CdlSources.of(version.getPayload()))));
        }
    }
}
