package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.ContentIssue;
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

    /**
     * Moves a section instance from {@code sourceBody} of {@code sourcePageUuid} into
     * {@code targetBody} of {@code targetUuid} at {@code position}. When both pages are the
     * same asset, this is a single-payload edit; otherwise the source page's own current
     * revision is used to remove it there (there is no client-observed revision for a page
     * shown only read-only in the nav tree), while {@code expectedTargetRevision} still
     * guards the page actually open for editing. Returns the target page's new view.
     */
    AssetVersionView moveSection(
            UUID sourcePageUuid,
            String sourceBody,
            String instanceId,
            UUID targetUuid,
            String targetBody,
            Integer position,
            long expectedTargetRevision,
            RevisionContext ctx);

    AssetVersionView duplicate(UUID uuid, RevisionContext ctx);

    AssetVersionView find(long projectId, UUID uuid);

    /**
     * Every content-validation finding on a page payload against its current templates (spec
     * §10.5): the advisory list a page view carries. Structural findings never reach a saved
     * version through this service's own writes, but content saved before validation existed may
     * still hold some; {@code ERROR} completeness findings block publish.
     */
    List<ContentIssue> contentIssues(long projectId, JsonNode payload);

    TemplateRefView resolveTemplate(long projectId, UUID uuid);

    List<AssetVersionView> list(long projectId, PageQuery query);
}
