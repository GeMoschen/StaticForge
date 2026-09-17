package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * `M16.5.1`: an include cycle in preview fails the render with a {@code 422} problem carrying
 * {@code SF-TPL-0135} — the same guard generation uses — instead of a {@code StackOverflowError}
 * surfacing as a 500.
 */
@SpringBootTest
@ActiveProfiles("test")
class PreviewRenderLimitsIntegrationTest {

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired PageRenderService pageRenderService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void includeCycleInPreviewIsA422ProblemWith0135() {
        AppUser user = userService.create("preview-cycle", "preview-cycle@example.com", "Preview Cycle", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("previewcycle", "Preview Cycle", null, "include cycle preview"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "include cycle preview");

        // A cycle cannot be saved in one step (each include must resolve on save): create A, then B
        // including A, then point A at B.
        TemplateView a = section(project, ctx, "Cycle A", "A");
        TemplateView b = section(project, ctx, "Cycle B", "B[$CMS_INCLUDE(section_template:" + a.uid() + ")$]");
        TemplateView current = templateService.get(project.getId(), a.uuid());
        templateService.saveChannel(
                a.uuid(), "html", "A[$CMS_INCLUDE(section_template:" + b.uid() + ")$]", current.validFromRevision(), ctx);

        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Cycle Page Template", "",
                        Map.of("html", "<main>$CMS_INCLUDE(section_template:" + a.uid() + ")$</main>"), null, false, null, null),
                ctx);
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", pageTemplate.uuid().toString());
        payload.set("content", mapper.createObjectNode());
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE, "Cycle Page", null, payload, null), ctx);

        assertThatThrownBy(() -> pageRenderService.renderPage(project.getId(), page.uuid(), null, "html", false))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(422);
                    assertThat(e.getProblem().getExtensions()).containsEntry("code", DiagnosticCodes.OCTL_INCLUDE_CYCLE);
                    assertThat(e.getProblem().getDetail())
                            .isEqualTo("Include cycle: " + a.uid() + " → " + b.uid() + " → " + a.uid());
                });
        assertThatThrownBy(() -> pageRenderService.renderSection(project.getId(), b.uuid(), mapper.createObjectNode(), "html"))
                .isInstanceOfSatisfying(SfException.class, e ->
                        assertThat(e.getProblem().getExtensions()).containsEntry("code", DiagnosticCodes.OCTL_INCLUDE_CYCLE));
    }

    @Test
    void catalogCardsOfTheSameTemplateRenderNestedInPreview() {
        AppUser user = userService.create("preview-cards", "preview-cards@example.com", "Preview Cards", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("previewcards", "Preview Cards", null, "nested catalog preview"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "nested catalog preview");
        String catalogCdl = "content { editor catalog related { label \"Related\" } }";
        TemplateView card = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.SECTION_TEMPLATE, "Card", catalogCdl,
                        Map.of("html", "card[$CMS_VALUE(related)$]"), null, false, null, null),
                ctx);
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Cards Page Template", catalogCdl,
                        Map.of("html", "<main>$CMS_VALUE(related)$</main>"), null, false, null, null),
                ctx);
        ObjectNode innermost = mapper.createObjectNode();
        ObjectNode middle = mapper.createObjectNode().set("related", catalog(card, innermost, "inner"));
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", pageTemplate.uuid().toString());
        payload.set("content", mapper.createObjectNode().set("related", catalog(card, middle, "outer")));
        AssetVersionView page = assetService.create(
                new CreateAssetCommand(project.getId(), AssetType.PAGE, "Cards Page", null, payload, null), ctx);

        assertThat(pageRenderService.renderPage(project.getId(), page.uuid(), null, "html", false))
                .isEqualTo("<main>card[card[]]</main>");
    }

    private ObjectNode catalog(TemplateView cardTemplate, ObjectNode cardContent, String instanceId) {
        ObjectNode value = mapper.createObjectNode().put("type", "CATALOG");
        ObjectNode card = value.putArray("cards").addObject();
        card.put("instanceId", instanceId);
        card.put("templateRef", cardTemplate.uuid().toString());
        card.set("content", cardContent);
        return value;
    }

    private TemplateView section(Project project, RevisionContext ctx, String name, String html) {
        return templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.SECTION_TEMPLATE, name, "",
                        Map.of("html", html), null, false, null, null),
                ctx);
    }
}
