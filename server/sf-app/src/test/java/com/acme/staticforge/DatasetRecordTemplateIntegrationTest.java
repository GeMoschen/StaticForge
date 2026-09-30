package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UidLiteralReference;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordTemplates;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.reference.ProjectReferenceResolver;
import com.acme.staticforge.asset.template.CompiledChannel;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.channel.TemplateRef;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M25.2.1}: per-channel record templates on a dataset — compile on save against the schema with the record
 * as the scope, the {@code 422} shapes, reference rows and usages, the rename rule, the compile cache, and the
 * channel and uid-literal scans that now include datasets.
 */
@SpringBootTest
@ActiveProfiles("test")
class DatasetRecordTemplateIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String TEAM_CDL =
            """
            content {
              editor text name { label "Name" required }
              editor text role { label "Role" }
              editor number level { label "Level" }
            }
            """;

    private static final String HTML =
            """
            <li class="member$CMS_IF(_first)$ first$CMS_END_IF$" data-index="$CMS_VALUE(_index)$">
              <a href="$CMS_REF(page:home)$">$CMS_VALUE(name)$</a> — $CMS_VALUE(role)$ ($CMS_VALUE(_uid)$, $CMS_VALUE(_count)$)
            </li>
            """;

    private static final String MD = "- **$CMS_VALUE(name)$** $CMS_VALUE(_displayName)$$CMS_IF(_last)$\n$CMS_END_IF$";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired DatasetService datasetService;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired ChannelService channelService;
    @Autowired CompiledTemplateCache compiledTemplates;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ProjectReferenceResolver projectReferences;

    @Test
    void aDatasetStoresAndCompilesAnHtmlAndAMarkdownRecordTemplate() {
        Fixture fx = newFixture();
        addMarkdownChannel(fx);
        home(fx);

        DatasetView team = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Team", CdlSources.split(TEAM_CDL), "name", null, Map.of("html", HTML, "md", MD)),
                fx.ctx());

        assertThat(team.channelTemplates().path("html").path("source").asText()).isEqualTo(HTML);
        assertThat(team.channelTemplates().path("md").path("source").asText()).isEqualTo(MD);
        assertThat(team.channelTemplates().path("html").path("compiledHash").asText()).hasSize(64);
        assertThat(team.recordTemplateDiagnostics()).isEmpty();
        AssetVersionView stored = assetService.requireCurrent(fx.projectId(), team.uuid());
        assertThat(RecordTemplates.sources(stored.payload())).containsExactly(Map.entry("html", HTML), Map.entry("md", MD));
        assertThat(RecordTemplates.source(stored.payload(), "html")).contains(HTML);
        assertThat(RecordTemplates.source(stored.payload(), "plain")).isEmpty();

        DatasetView read = datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow();
        assertThat(read.channelTemplates()).isEqualTo(team.channelTemplates());

        DatasetView updated = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), "name", null, Map.of("html", HTML.replace("<li", "<li id=\"m\""))),
                team.revision(),
                fx.ctx());
        assertThat(updated.channelTemplates().has("md")).as("a map replaces every record template").isFalse();
        assertThat(updated.channelTemplates().path("html").path("source").asText()).contains("id=\"m\"");
    }

    @Test
    void anUndeclaredFieldIsRejectedWithItsChannelLineAndColumnAndNothingIsWritten() {
        Fixture fx = newFixture();
        addMarkdownChannel(fx);
        int revisions = revisionCount(fx);

        assertThatThrownBy(() -> datasetService.create(
                        new CreateDatasetCommand(fx.projectId(), null, "Team", CdlSources.split(TEAM_CDL), null, null,
                                Map.of("html", "<li>$CMS_VALUE(name)$</li>", "md", "- $CMS_VALUE(name)$\n  $CMS_VALUE(email)$")),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getExtensions()).containsEntry("channel", "md");
                    Diagnostic diagnostic = diagnostics(ex).getFirst();
                    assertThat(diagnostic.code()).isEqualTo(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
                    assertThat(diagnostic.message()).contains("email");
                    assertThat(diagnostic.line()).isEqualTo(2);
                    assertThat(diagnostic.column()).isEqualTo(3);
                    assertThat(((Map<?, ?>) ex.getProblem().getExtensions().get("channelDiagnostics")).keySet().stream().map(String::valueOf))
                            .containsExactly("md");
                });

        assertThat(datasetService.list(fx.projectId())).isEmpty();
        assertThat(revisionCount(fx)).isEqualTo(revisions);
    }

    @Test
    void bodiesAndInheritanceAreRejectedWithTheirOwnCode() {
        Fixture fx = newFixture();
        DatasetView team = team(fx, Map.of());

        for (String source : List.of(
                "$CMS_BODY(x)$",
                "$CMS_EXTENDS(page_template:base)$",
                "$CMS_BLOCK(card)$$CMS_VALUE(name)$$CMS_END_BLOCK$")) {
            assertThatThrownBy(() -> datasetService.update(
                            team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), null, null, Map.of("html", source)),
                            team.revision(), fx.ctx()))
                    .as(source)
                    .isInstanceOfSatisfying(SfException.class, ex -> {
                        assertThat(ex.getStatus()).isEqualTo(422);
                        assertThat(ex.getProblem().getExtensions()).containsEntry("channel", "html");
                        assertThat(diagnostics(ex)).extracting(Diagnostic::code)
                                .containsOnly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
                        assertThat(diagnostics(ex).getFirst().line()).isEqualTo(1);
                    });
        }
        assertThat(assetService.requireCurrent(fx.projectId(), team.uuid()).validFromRevision()).isEqualTo(team.revision());
    }

    @Test
    void anUnknownChannelKeyIsRejected() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> team(fx, Map.of("print", "$CMS_VALUE(name)$")))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    assertThat(ex.getProblem().getExtensions()).containsEntry("field", "channelTemplates.print");
                });
        assertThat(datasetService.list(fx.projectId())).isEmpty();
    }

    @Test
    void warningsComeBackPerChannelAndUnusedFieldsAreNotReported() {
        Fixture fx = newFixture();

        DatasetView team = team(fx, Map.of("html", "<b>$CMS_VALUE(name|raw)$</b>"));

        assertThat(team.recordTemplateDiagnostics()).containsOnlyKeys("html");
        assertThat(team.recordTemplateDiagnostics().get("html")).extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_RAW_ON_TEXT);
        assertThat(datasetService.find(fx.projectId(), team.uuid(), null).orElseThrow().recordTemplateDiagnostics())
                .as("reads carry no save diagnostics")
                .isEmpty();
    }

    @Test
    void recordTemplateReferencesAreRowsUnderTheirChannelAndShowInTheTargetsUsages() {
        Fixture fx = newFixture();
        addMarkdownChannel(fx);
        AssetVersionView home = home(fx);

        DatasetView team = team(fx, Map.of("html", HTML, "md", "$CMS_VALUE(page:home.title)$ $CMS_VALUE(name)$"));

        List<UsageView> usages = assetService.usages(fx.projectId(), home.uuid());
        assertThat(usages)
                .filteredOn(usage -> usage.fromUuid().equals(team.uuid()))
                .extracting(UsageView::fromType, UsageView::kind, UsageView::sourcePath)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(AssetType.DATASET, ReferenceKind.OCTL_REF, "channelTemplates.html"),
                        org.assertj.core.groups.Tuple.tuple(AssetType.DATASET, ReferenceKind.OCTL_VALUE, "channelTemplates.md"));

        // Dropping the templates closes the rows; the revision before still has them (time travel).
        DatasetView cleared = datasetService.update(
                team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), null, null, Map.of()), team.revision(), fx.ctx());
        assertThat(cleared.channelTemplates().isEmpty()).isTrue();
        assertThat(assetService.usages(fx.projectId(), home.uuid())).noneMatch(u -> u.fromUuid().equals(team.uuid()));
        assertThat(assetService.usagesAt(fx.projectId(), home.uuid(), team.revision()))
                .anyMatch(u -> u.fromUuid().equals(team.uuid()));

        // The uid-literal scan of a uid change lists the dataset's record template like a template's channel.
        DatasetView again = datasetService.update(
                team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), null, null, Map.of("html", HTML)),
                cleared.revision(), fx.ctx());
        List<UidLiteralReference> literals = assetService.changeUid(home.uuid(), "start", fx.ctx()).affectedTemplates();
        assertThat(literals).anyMatch(ref -> ref.assetUuid().equals(again.uuid()) && ref.assetType() == AssetType.DATASET);
    }

    @Test
    void datasetsWithoutRecordTemplatesKeepTheM19PayloadAndAnUpdateWithoutTemplatesKeepsTheStoredOnes() {
        Fixture fx = newFixture();

        DatasetView plain = team(fx, null);
        assertThat(assetService.requireCurrent(fx.projectId(), plain.uuid()).payload().has(RecordTemplates.PAYLOAD_FIELD))
                .isFalse();
        assertThat(plain.channelTemplates().isEmpty()).isTrue();
        DatasetView plainUpdated = datasetService.update(
                plain.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(TEAM_CDL), "name", "People"), plain.revision(), fx.ctx());
        assertThat(assetService.requireCurrent(fx.projectId(), plain.uuid()).payload().has(RecordTemplates.PAYLOAD_FIELD))
                .isFalse();
        assertThat(plainUpdated.description()).isEqualTo("People");

        DatasetView withTemplate = datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Crew", CdlSources.split(TEAM_CDL), null, null, Map.of("html", "$CMS_VALUE(name)$")),
                fx.ctx());
        DatasetView kept = datasetService.update(
                withTemplate.uuid(), new UpdateDatasetCommand("Crew", CdlSources.split(TEAM_CDL), null, "kept"), withTemplate.revision(),
                fx.ctx());
        assertThat(kept.channelTemplates().path("html").path("source").asText()).isEqualTo("$CMS_VALUE(name)$");
    }

    @Test
    void aRenameDoesNotRewriteRecordTemplatesSoTheOldNameFailsTheSaveUntilTheTemplateIsFixed() {
        Fixture fx = newFixture();
        DatasetView team = team(fx, Map.of("html", "<li>\n  $CMS_VALUE(role)$\n</li>"));
        String renamed = TEAM_CDL.replace("editor text role { label \"Role\" }",
                "editor text position { label \"Position\" renamedFrom \"role\" }");

        // Stored templates are recompiled against the new schema even when the request leaves them out.
        assertThatThrownBy(() -> datasetService.update(
                        team.uuid(), new UpdateDatasetCommand("Team", CdlSources.split(renamed), null, null), team.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> {
                    assertThat(ex.getStatus()).isEqualTo(422);
                    Diagnostic diagnostic = diagnostics(ex).getFirst();
                    assertThat(diagnostic.code()).isEqualTo(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
                    assertThat(diagnostic.line()).isEqualTo(2);
                });
        assertThat(assetService.requireCurrent(fx.projectId(), team.uuid()).validFromRevision()).isEqualTo(team.revision());

        DatasetView fixed = datasetService.update(
                team.uuid(),
                new UpdateDatasetCommand("Team", CdlSources.split(renamed), null, null, Map.of("html", "<li>\n  $CMS_VALUE(position)$\n</li>")),
                team.revision(),
                fx.ctx());
        assertThat(fixed.channelTemplates().path("html").path("source").asText()).contains("position");
    }

    @Test
    void aRecordTemplateLoopingItsOwnDatasetIsCheckedAgainstTheSchemaBeingSaved() {
        Fixture fx = newFixture();
        DatasetView team = team(fx, Map.of());
        String withLevel2 = TEAM_CDL.replace("editor number level { label \"Level\" }", "editor number rank { label \"Rank\" }");

        assertThatThrownBy(() -> datasetService.update(
                        team.uuid(),
                        new UpdateDatasetCommand("Team", CdlSources.split(withLevel2), null, null,
                                Map.of("html", "$CMS_FOR(m : dataset:team, where=\"m.level > 1\")$$CMS_VALUE(m.name)$$CMS_END_FOR$")),
                        team.revision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(diagnostics(ex)).extracting(Diagnostic::code)
                        .contains(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
    }

    @Test
    void renderingObtainsTheCompiledRecordTemplateThroughTheCompileCache() {
        Fixture fx = newFixture();
        AssetVersionView home = home(fx);
        DatasetView team = team(fx, Map.of("html", HTML));
        AssetVersionView version = assetService.requireCurrent(fx.projectId(), team.uuid());
        CdlSources cdl = CdlSources.of(version.payload());
        String source = RecordTemplates.source(version.payload(), "html").orElseThrow();
        ReferenceResolver resolver = projectReferences.forProject(fx.projectId());

        CompiledChannel first = compiledTemplates.compileRecordTemplate(
                fx.projectId(), team.uuid(), version.validFromRevision(), "html", cdl, source, resolver);
        CompiledChannel second = compiledTemplates.compileRecordTemplate(
                fx.projectId(), team.uuid(), version.validFromRevision(), "html", cdl, source, resolver);

        assertThat(second).isSameAs(first);
        assertThat(first.octl().diagnostics()).isEmpty();
        assertThat(first.template().references()).containsEntry("page:home", home.uuid());
        assertThat(first.template().hash()).isEqualTo(version.payload().path("channelTemplates").path("html")
                .path("compiledHash").asText());
    }

    @Test
    void channelsSeeRecordTemplates() {
        Fixture fx = newFixture();
        addMarkdownChannel(fx);
        DatasetView team = team(fx, Map.of("md", MD));

        assertThat(channelService.previewDelete(fx.projectId(), "md").affectedTemplates())
                .extracting(TemplateRef::uid)
                .containsExactly(team.uid());
        assertThatThrownBy(() -> channelService.delete("md", fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(409));

        channelService.create(
                new CreateChannelRequest("plain", "Plain", "txt", "text/plain", "NONE", true, false, 2, null, "md"), fx.ctx());
        AssetVersionView seeded = assetService.requireCurrent(fx.projectId(), team.uuid());
        assertThat(RecordTemplates.source(seeded.payload(), "plain")).contains(MD);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private DatasetView team(Fixture fx, Map<String, String> templates) {
        return datasetService.create(
                new CreateDatasetCommand(fx.projectId(), null, "Team", CdlSources.split(TEAM_CDL), null, null, templates), fx.ctx());
    }

    private void addMarkdownChannel(Fixture fx) {
        channelService.create(
                new CreateChannelRequest("md", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null),
                fx.ctx());
    }

    /** A page with uid {@code home}. */
    private AssetVersionView home(Fixture fx) {
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, "Plain", CdlSources.split("content { editor text title { } }"),
                        Map.of("html", "$CMS_VALUE(title)$"), null, false, Map.of("html", "{displayNameSlug}.{ext}")),
                fx.ctx());
        AssetVersionView home = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());
        assertThat(home.uid()).isEqualTo("home");
        return home;
    }

    private int revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.projectId()).size();
    }

    @SuppressWarnings("unchecked")
    private static List<Diagnostic> diagnostics(SfException ex) {
        return (List<Diagnostic>) ex.getProblem().getExtensions().get("diagnostics");
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "recordtpl-user-" + n, "recordtpl-user-" + n + "@example.com", "Record Template User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("recordtpl_" + n, "Record Template Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        long projectId() {
            return project().getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
