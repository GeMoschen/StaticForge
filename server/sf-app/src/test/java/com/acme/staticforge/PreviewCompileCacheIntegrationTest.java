package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * `M16.1.1`: preview reuses compiled templates across requests, but never one compiled for another
 * template version or against a stale {@code assetType:uid → UUID} resolution.
 */
@SpringBootTest
@ActiveProfiles("test")
class PreviewCompileCacheIntegrationTest {

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired PageRenderService pageRenderService;
    @Autowired MeterRegistry meterRegistry;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void previewReusesCompilesUntilTheTemplateOrAReferenceChanges() {
        AppUser user = userService.create("preview-cache", "preview-cache@example.com", "Preview Cache", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("previewcache", "Preview Cache", null, "compile cache preview"), user.getId());
        long projectId = project.getId();
        RevisionContext ctx = RevisionContext.of(projectId, user.getId(), "compile cache preview");

        AssetVersionView target = page(projectId, ctx, "Target", null);
        TemplateView template = templateService.create(
                new CreateTemplateCommand(projectId, AssetType.PAGE_TEMPLATE, "Cache Template", "",
                        Map.of("html", "v1[$CMS_REF(page:" + target.uid() + ")$]"), null, false, null, null),
                ctx);
        AssetVersionView home = page(projectId, ctx, "Home", template.uuid());
        long revisionBeforeEdit = assetService.requireCurrent(projectId, home.uuid()).validFromRevision();

        // Two consecutive renders: one compile. (Unrewritten $CMS_REF renders the target's uid.)
        double before = octlCompiles();
        assertThat(render(projectId, home.uuid(), null)).isEqualTo("v1[" + target.uid() + "]");
        assertThat(render(projectId, home.uuid(), null)).isEqualTo("v1[" + target.uid() + "]");
        assertThat(octlCompiles() - before).isEqualTo(1);

        // Editing the channel (a new template version) recompiles.
        TemplateView current = templateService.get(projectId, template.uuid());
        templateService.saveChannel(
                template.uuid(), "html", "v2[$CMS_REF(page:" + target.uid() + ")$]", current.validFromRevision(), ctx);
        assertThat(render(projectId, home.uuid(), null)).isEqualTo("v2[" + target.uid() + "]");
        assertThat(octlCompiles() - before).isEqualTo(2);

        // Time travel to before the edit renders with the template version valid then, not the newer one.
        assertThat(render(projectId, home.uuid(), revisionBeforeEdit)).isEqualTo("v1[" + target.uid() + "]");

        // Renaming the referenced page's uid: the cached resolution is stale and must not be used —
        // page:<old uid> no longer resolves, so the reference renders empty.
        String oldUid = target.uid();
        assetService.changeUid(target.uuid(), "renamed_target", ctx);
        double beforeRename = octlCompiles();
        assertThat(render(projectId, home.uuid(), null)).isEqualTo("v2[]");
        assertThat(octlCompiles() - beforeRename).isEqualTo(1);
        assertThat(oldUid).isNotEqualTo("renamed_target");
    }

    private String render(long projectId, UUID page, Long revision) {
        return pageRenderService.renderPage(projectId, page, revision, "html", false);
    }

    private AssetVersionView page(long projectId, RevisionContext ctx, String name, UUID templateUuid) {
        ObjectNode payload = mapper.createObjectNode();
        if (templateUuid != null) {
            payload.put("templateRef", templateUuid.toString());
        }
        payload.set("content", mapper.createObjectNode());
        return assetService.create(new CreateAssetCommand(projectId, AssetType.PAGE, name, null, payload, null), ctx);
    }

    private double octlCompiles() {
        return meterRegistry.get("sf.template.compiles").tag("kind", "octl").counter().count();
    }
}
