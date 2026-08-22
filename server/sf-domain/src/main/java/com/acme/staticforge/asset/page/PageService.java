package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * Page operations (spec §10, §20.2). Pages bind a page template, fill its own content and
 * carry ordered section instances in named bodies. All mutations are revision-aware and
 * optimistic-concurrency-checked.
 */
public interface PageService {

    AssetVersionView create(CreatePageCommand cmd, RevisionContext ctx);

    AssetVersionView update(UUID uuid, JsonNode payload, long expectedRevision, RevisionContext ctx);

    AssetVersionView patchContent(UUID uuid, JsonNode mergePatch, long expectedRevision, RevisionContext ctx);

    AssetVersionView addSection(UUID uuid, String bodyName, String templateUuid, Integer position, long expectedRevision, RevisionContext ctx);

    AssetVersionView reorderSections(UUID uuid, String bodyName, List<String> instanceIds, long expectedRevision, RevisionContext ctx);

    AssetVersionView deleteSection(UUID uuid, String bodyName, String instanceId, long expectedRevision, RevisionContext ctx);

    AssetVersionView duplicate(UUID uuid, RevisionContext ctx);

    AssetVersionView find(UUID uuid);

    TemplateRefView resolveTemplate(UUID uuid);

    List<AssetVersionView> list(long projectId, PageQuery query);
}
