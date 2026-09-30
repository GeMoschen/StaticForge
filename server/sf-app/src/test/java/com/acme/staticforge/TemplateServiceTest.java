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
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Integration tests for {@link TemplateService} (spec §12, §13): compile-on-save, channel
 * template edits, CDL-change content migration, and rejections of invalid OCTL.
 */
@SpringBootTest
@ActiveProfiles("test")
class TemplateServiceTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired RevisionRepository revisionRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void createsSectionTemplateWithCompiledDefinitionAndHash() {
        Fixture fx = newFixture();

        TemplateView created = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Teaser",
                        CdlSources.split("content { editor text headline { required } }"),
                        Map.of("html", "<h2>$CMS_VALUE(headline)$</h2>"),
                        "Hero",
                        false,
                        null),
                fx.ctx());

        assertThat(created.payload().get("compiledDefinition")).isNotNull();
        assertThat(created.payload().path("deprecated").asBoolean()).isFalse();

        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), created.uuid());
        String compiledHash = current.payload().path("channelTemplates").path("html").path("compiledHash").asText();
        assertThat(compiledHash).isNotEmpty();
        assertThat(current.payload().path("contentCdl").asText()).contains("headline");
    }

    @Test
    void invalidOctlThrows422() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> templateService.create(
                        new CreateTemplateCommand(
                                fx.project().getId(),
                                AssetType.SECTION_TEMPLATE,
                                "Broken",
                                CdlSources.split("content { editor text headline { required } }"),
                                Map.of("html", "$CMS_VALUE(missing)$"),
                                null,
                                false,
                                null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void saveChannelAddsAndDeleteChannelRemoves() {
        Fixture fx = newFixture();

        TemplateView created = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Teaser",
                        CdlSources.split("content { editor text headline { required } }"),
                        Map.of("html", "<h2>$CMS_VALUE(headline)$</h2>"),
                        null,
                        false,
                        null),
                fx.ctx());

        TemplateView withMarkdown = templateService.saveChannel(
                created.uuid(), "markdown", "# $CMS_VALUE(headline)$", created.validFromRevision(), fx.ctx());
        assertThat(withMarkdown.payload().path("channelTemplates").has("markdown")).isTrue();

        TemplateView removed = templateService.deleteChannel(
                created.uuid(), "markdown", withMarkdown.validFromRevision(), fx.ctx());
        assertThat(removed.payload().path("channelTemplates").has("markdown")).isFalse();
        assertThat(removed.payload().path("channelTemplates").has("html")).isTrue();
    }

    @Test
    void renameMigrationMovesContentProjectWideInOneRevision() {
        Fixture fx = newFixture();

        TemplateView section = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Card",
                        CdlSources.split("content { editor text headline {} }"),
                        Map.of(),
                        null,
                        false,
                        null),
                fx.ctx());

        AssetVersionView pageOne = createPage(fx, section, "first");
        AssetVersionView pageTwo = createPage(fx, section, "second");

        long before = maxRevision(fx);

        templateService.update(
                section.uuid(),
                new UpdateTemplateCommand(
                        "Card",
                        CdlSources.split("content { editor text title { renamedFrom \"headline\" } }"),
                        Map.of(),
                        null,
                        false,
                        null),
                section.validFromRevision(),
                fx.ctx());

        long after = maxRevision(fx);
        assertThat(after).isEqualTo(before + 2);

        AssetVersionView migratedOne = assetService.requireCurrent(fx.project().getId(), pageOne.uuid());
        AssetVersionView migratedTwo = assetService.requireCurrent(fx.project().getId(), pageTwo.uuid());

        JsonNode contentOne = migratedOne.payload().path("bodies").path("main").get(0).path("content");
        assertThat(contentOne.has("headline")).isFalse();
        assertThat(contentOne.path("title").asText()).isEqualTo("first");

        JsonNode contentTwo = migratedTwo.payload().path("bodies").path("main").get(0).path("content");
        assertThat(contentTwo.has("headline")).isFalse();
        assertThat(contentTwo.path("title").asText()).isEqualTo("second");

        assertThat(migratedOne.validFromRevision()).isEqualTo(migratedTwo.validFromRevision()).isEqualTo(after);
    }

    private AssetVersionView createPage(Fixture fx, TemplateView sectionTemplate, String headline) {
        ObjectNode payload = mapper.createObjectNode();
        payload.putObject("content");
        ObjectNode bodies = payload.putObject("bodies");
        ArrayNode main = bodies.putArray("main");
        ObjectNode section = main.addObject();
        section.put("instanceId", UUID.randomUUID().toString());
        section.put("templateRef", sectionTemplate.uuid().toString());
        section.putObject("content").put("headline", headline);
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE, "Page", null, payload, null), fx.ctx());
    }

    private long maxRevision(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).stream()
                .mapToLong(Revision::getRevisionId)
                .max()
                .orElseThrow();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("tpl-user-" + n, "tpl-user-" + n + "@example.com", "Tpl User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("tplp_" + n, "Template Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
