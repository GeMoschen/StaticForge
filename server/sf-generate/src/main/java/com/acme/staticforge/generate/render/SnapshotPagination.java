package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.navigation.NavigationServiceImpl;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.generate.nav.SnapshotNavigationLookup;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The pagination of a build's pages (M21.2.1), read from the snapshot: which pages paginate what (the page template's
 * effective definition through the build's compile memo, the page's stored value) and the items of a source
 * ({@link PaginationSource} over the snapshot's navigation and records). One per plan.
 */
public final class SnapshotPagination {

    private final Snapshot snapshot;
    private final TemplateHierarchy hierarchy;
    private final SnapshotNavigationLookup navigation;
    private final SnapshotAssetValueResolver records;
    private final NavigationServiceImpl navigationService = new NavigationServiceImpl();
    private final Map<UUID, Optional<ContentDefinition>> definitions = new ConcurrentHashMap<>();

    private SnapshotPagination(Snapshot snapshot, TemplateCompileMemo memo) {
        this.snapshot = snapshot;
        this.hierarchy = SnapshotTemplateHierarchy.of(snapshot, memo);
        this.navigation = new SnapshotNavigationLookup(snapshot);
        this.records = new SnapshotAssetValueResolver(snapshot, memo);
    }

    public static SnapshotPagination of(Snapshot snapshot, TemplateCompileMemo memo) {
        return new SnapshotPagination(snapshot, memo);
    }

    /** The page's pagination; empty for a page that isn't paginated (no editor, no value, or no template). */
    public Optional<PaginationValue> valueOf(SnapshotAsset page) {
        JsonNode content = page.payload() == null ? null : page.payload().get("content");
        if (content == null || !holdsPaginationValue(content)) {
            return Optional.empty(); // the common case, without looking at the template
        }
        SnapshotAsset template = GenerationRenderer.templateOf(snapshot, page);
        if (template == null) {
            return Optional.empty();
        }
        return definitions
                .computeIfAbsent(template.uuid(), uuid -> hierarchy.effectiveDefinition(uuid).map(EffectiveDefinition::definition))
                .flatMap(definition -> PaginationValue.of(definition, content));
    }

    /** The eligible items of {@code value}'s source, in page order. */
    public PaginationSource.Result items(PaginationValue value) {
        return PaginationSource.items(snapshot.projectId(), value, navigationService, navigation, records::datasetRecords);
    }

    private static boolean holdsPaginationValue(JsonNode content) {
        if (!content.isObject()) {
            return false;
        }
        for (JsonNode value : content) {
            if (value.isObject() && "PAGINATION".equals(value.path("type").asText())) {
                return true;
            }
        }
        return false;
    }
}
