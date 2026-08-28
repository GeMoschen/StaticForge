package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.channel.DeletePreview;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Integration tests for {@link ChannelService} (spec §15): the default {@code html} channel on
 * project create, duplicate-key rejection, non-deletable {@code html}, the delete-block for
 * used channels, copy-from seeding and escaping lookup.
 */
@SpringBootTest
@ActiveProfiles("test")
class ChannelServiceTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired ChannelService channelService;
    @Autowired TemplateService templateService;
    @Autowired AssetService assetService;

    @Test
    void projectCreateSeedsDefaultHtmlChannel() {
        Fixture fx = newFixture();

        OutputChannel html = channelService.list(fx.project().getId()).stream()
                .filter(c -> c.getKey().equals("html"))
                .findFirst()
                .orElseThrow();

        assertThat(html.getName()).isEqualTo("HTML");
        assertThat(html.getFileExtension()).isEqualTo("html");
        assertThat(html.getMimeType()).isEqualTo("text/html");
        assertThat(html.getDefaultEscaping()).isEqualTo("HTML");
        assertThat(html.isEnabled()).isTrue();
        assertThat(html.isDefaultChannel()).isTrue();
        assertThat(html.getPosition()).isZero();
        assertThat(html.getSettings()).isNotNull();
        assertThat(html.getSettings().path("indexFileName").asText()).isEqualTo("index.html");
    }

    @Test
    void duplicateKeyIsRejected() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> channelService.create(
                        new CreateChannelRequest("html", "HTML", "html", "text/html", "HTML",
                                true, true, 0, null, null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));
    }

    @Test
    void htmlChannelIsNonDeletable() {
        Fixture fx = newFixture();

        assertThatThrownBy(() ->
                        channelService.delete("html", fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getExtensions().get("code")).isEqualTo("SF-CH-0101");
                });
    }

    @Test
    void deletingUsedChannelIsBlockedAndListsTemplates() {
        Fixture fx = newFixture();
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN",
                        true, false, 1, null, null),
                fx.ctx());

        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Teaser",
                        "content { editor text headline { required } }",
                        Map.of("markdown", "# $CMS_VALUE(headline)$"),
                        null,
                        false,
                        null),
                fx.ctx());

        DeletePreview preview = channelService.previewDelete(fx.project().getId(), "markdown");
        assertThat(preview.affectedTemplates())
                .extracting(t -> t.uid())
                .contains(template.uid());

        assertThatThrownBy(() ->
                        channelService.delete("markdown", fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(409);
                    assertThat(ex.getProblem().getExtensions().get("code")).isEqualTo("SF-CH-0201");
                    assertThat(ex.getProblem().getExtensions().get("blockedBy")).isNotNull();
                });
    }

    @Test
    void copyFromSeedsChannelTemplate() {
        Fixture fx = newFixture();

        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.SECTION_TEMPLATE,
                        "Hero",
                        "content { editor text headline { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());

        OutputChannel markdown = channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN",
                        true, false, 1, null, "html"),
                fx.ctx());

        assertThat(markdown.getKey()).isEqualTo("markdown");

        AssetVersionView seeded = assetService.requireCurrent(fx.project().getId(), template.uuid());
        assertThat(seeded.payload().path("channelTemplates").has("markdown")).isTrue();
        assertThat(seeded.payload().path("channelTemplates").path("markdown").path("source").asText())
                .isEqualTo("<h1>$CMS_VALUE(headline)$</h1>");
    }

    @Test
    void defaultEscapingMapsStoredName() {
        Fixture fx = newFixture();
        channelService.create(
                new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN",
                        true, false, 1, null, null),
                fx.ctx());

        assertThat(channelService.defaultEscaping(fx.project().getId(), "markdown")).isEqualTo(Escaping.MARKDOWN);
        assertThat(channelService.defaultEscaping(fx.project().getId(), "html")).isEqualTo(Escaping.HTML);
        assertThat(channelService.defaultEscaping(fx.project().getId(), "missing")).isEqualTo(Escaping.HTML);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("ch-user-" + n, "ch-user-" + n + "@example.com", "Channel User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("chp_" + n, "Channel Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
