package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.DescendantIssue;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code M20.2.1} + {@code M20.2.2}: abstract page templates, the derived parent, effective definitions, descendant
 * validation on parent saves, the descendant-wide rename migration, the child → parent {@code TEMPLATE} edge and what
 * it drives (usages, delete guard, export).
 */
@SpringBootTest
@ActiveProfiles("test")
class TemplateInheritanceIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String BASE_CDL = "content { editor text title { label \"Title\" required } }";
    private static final String BASE_HTML =
            "<h1>$CMS_VALUE(title)$</h1>$CMS_BLOCK(content)$base$CMS_END_BLOCK$$CMS_BLOCK(footer)$f$CMS_END_BLOCK$";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetReferenceRepository referenceRepository;
    @Autowired TemplateService templateService;
    @Autowired PageService pageService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ProjectExportImportService exportImportService;

    @Test
    void pagesCantUseAnAbstractTemplate() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView article = template(fx, "Article", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);

        assertProblem(() -> pageService.create(new CreatePageCommand("Nope", null, base.uuid()), fx.ctx()), 422, "SF-DOM-0123");

        AssetVersionView page = pageService.create(new CreatePageCommand("Page", null, article.uuid()), fx.ctx());
        ObjectNode switched = page.payload().deepCopy();
        switched.put("templateRef", base.uuid().toString());
        assertProblem(() -> pageService.update(page.uuid(), switched, page.validFromRevision(), fx.ctx()), 422, "SF-DOM-0123");
    }

    @Test
    void aTemplateInUseCantBecomeAbstract() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, false);
        pageService.create(new CreatePageCommand("One", null, base.uuid()), fx.ctx());
        pageService.create(new CreatePageCommand("Two", null, base.uuid()), fx.ctx());

        SfException problem = assertProblem(() -> update(fx, base, BASE_CDL, Map.of("html", BASE_HTML), true), 422, "SF-DOM-0122");
        assertThat(problem.getProblem().getExtensions()).containsEntry("pageCount", 2);
        assertThat(problem.getProblem().getDetail()).contains("2 pages");
    }

    @Test
    void sectionTemplatesCantExtend() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        SfException problem = assertProblem(() -> templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.SECTION_TEMPLATE, "Section", "",
                Map.of("html", "$CMS_EXTENDS(page_template:" + base.uid() + ")$"), null, false, null), fx.ctx()), 422, null);
        assertThat(codes(problem)).contains(DiagnosticCodes.OCTL_EXTENDS_TARGET);
    }

    @Test
    void channelsMustExtendTheSameParent() {
        Fixture fx = newFixture();
        TemplateView a = template(fx, "A", "", Map.of("html", "a", "markdown", "a"), true);
        TemplateView b = template(fx, "B", "", Map.of("html", "b", "markdown", "b"), true);
        SfException problem = assertProblem(() -> template(fx, "Mixed", "", Map.of(
                "html", "$CMS_EXTENDS(page_template:" + a.uid() + ")$",
                "markdown", "$CMS_EXTENDS(page_template:" + b.uid() + ")$"), false), 422, null);
        assertThat(codes(problem)).contains(DiagnosticCodes.OCTL_CHANNELS_EXTEND_DIFFERENT_PARENTS);
    }

    @Test
    void aChildEditorCollidingWithAnInheritedOneIsRejected() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        SfException problem = assertProblem(() -> template(fx, "Child", "content { editor text title { label \"Again\" } }",
                "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false), 422, null);
        assertThat(codes(problem)).contains(DiagnosticCodes.CDL_INHERITED_NAME_COLLISION);
    }

    @Test
    void aChildMayUseItsParentsEditorsAndReadsItsEffectiveDefinition() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        String childHtml = "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(content)$$CMS_VALUE(title)$$CMS_END_BLOCK$";
        TemplateView child = template(fx, "Child", "content { editor text summary { label \"Summary\" } }", childHtml, false);

        assertThat(child.payload().path("parentTemplateRef").asText()).isEqualTo(base.uuid().toString());
        assertThat(child.payload().path("abstract").asBoolean()).isFalse();
        assertThat(base.isAbstract()).isTrue();

        TemplateView read = templateService.get(fx.project().getId(), child.uuid());
        assertThat(read.ancestors()).extracting(TemplateView.TemplateRef::uid).containsExactly(base.uid());
        assertThat(read.effectiveDefinition().definition().editors()).extracting("name").containsExactly("title", "summary");
        assertThat(read.effectiveDefinition().editorsInheritedFrom()).containsExactly(Map.entry("title", base.uid()));
        assertThat(read.payload().path("compiledDefinition").path("editors")).hasSize(1);

        // The same source on a template without the parent fails the name check.
        SfException problem = assertProblem(() -> template(fx, "Orphan", "", "$CMS_VALUE(title)$", false), 422, null);
        assertThat(codes(problem)).contains(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);

        // A channel that doesn't extend still inherits the CDL through the other channel's parent.
        TemplateView mixed = template(fx, "Mixed", "", Map.of(
                "html", "$CMS_EXTENDS(page_template:" + base.uid() + ")$",
                "markdown", "# $CMS_VALUE(title)$"), false);
        assertThat(mixed.payload().path("parentTemplateRef").asText()).isEqualTo(base.uuid().toString());
    }

    @Test
    void pageContentValidatesAgainstTheEffectiveDefinition() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView child = template(fx, "Child", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);
        AssetVersionView page = pageService.create(new CreatePageCommand("Page", null, child.uuid()), fx.ctx());

        List<ContentIssue> issues = pageService.contentIssues(fx.project().getId(), page.payload());
        assertThat(issues).anySatisfy(issue -> {
            assertThat(issue.kind()).isEqualTo(ContentIssue.Kind.COMPLETENESS);
            assertThat(issue.path()).contains("title");
        });

        ObjectNode filled = page.payload().deepCopy();
        filled.withObject("content").put("title", "Hello");
        assertThat(pageService.contentIssues(fx.project().getId(), filled)).isEmpty();
    }

    @Test
    void aParentSaveThatBreaksAGrandchildIsRejectedAndWritesNothing() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView docs = template(fx, "Docs", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", true);
        TemplateView article = template(fx, "Article", "content { editor text note { label \"Note\" } }",
                "$CMS_EXTENDS(page_template:" + docs.uid() + ")$$CMS_BLOCK(content)$$CMS_VALUE(note)$$CMS_END_BLOCK$", false);
        long head = head(fx);

        String collidingCdl = "content { editor text title { label \"Title\" required } editor text note { label \"N\" } }";
        SfException problem = assertProblem(
                () -> update(fx, base, collidingCdl, Map.of("html", BASE_HTML + "$CMS_VALUE(note)$"), true), 422, "SF-DOM-0124");

        @SuppressWarnings("unchecked")
        List<DescendantIssue> descendants = (List<DescendantIssue>) problem.getProblem().getExtensions().get("descendants");
        assertThat(descendants).extracting(DescendantIssue::uid).containsExactly(article.uid());
        assertThat(descendants.get(0).diagnostics()).extracting(Diagnostic::code)
                .contains(DiagnosticCodes.CDL_INHERITED_NAME_COLLISION);
        assertThat(problem.getProblem().getDetail()).contains(article.uid());

        assertThat(head(fx)).isEqualTo(head);
        assertThat(templateService.get(fx.project().getId(), base.uuid()).validFromRevision()).isEqualTo(base.validFromRevision());
        assertThat(templateService.get(fx.project().getId(), docs.uuid()).validFromRevision()).isEqualTo(docs.validFromRevision());
    }

    @Test
    void aParentSaveWithOnlyDescendantWarningsSucceedsAndReturnsThem() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView child = template(fx, "Child", "",
                "$CMS_EXTENDS(page_template:" + base.uid() + ")$$CMS_BLOCK(footer)$mine$CMS_END_BLOCK$", false);

        TemplateView saved = update(fx, base, BASE_CDL, Map.of("html", BASE_HTML.replace("footer", "foot")), true);

        assertThat(saved.descendantWarnings()).singleElement().satisfies(warning -> {
            assertThat(warning.uid()).isEqualTo(child.uid());
            assertThat(warning.channel()).isEqualTo("html");
            assertThat(warning.diagnostics()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE);
        });
    }

    @Test
    void aParentEditorRenameMigratesPagesOfEveryDescendantInOneRevision() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, false);
        TemplateView docs = template(fx, "Docs", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);
        TemplateView article = template(fx, "Article", "", "$CMS_EXTENDS(page_template:" + docs.uid() + ")$", false);
        List<UUID> pages = new ArrayList<>();
        for (TemplateView template : List.of(base, docs, article)) {
            AssetVersionView page = pageService.create(new CreatePageCommand("On " + template.uid(), null, template.uuid()), fx.ctx());
            ObjectNode payload = page.payload().deepCopy();
            payload.withObject("content").put("title", "Hello " + template.uid());
            pages.add(pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx()).uuid());
        }

        String renamed = "content { editor text headline { label \"Headline\" renamedFrom \"title\" } }";
        TemplateView saved = update(fx, base, renamed, Map.of("html", BASE_HTML.replace("title", "headline")), false);

        for (UUID page : pages) {
            AssetVersionView current = assetService.requireCurrent(fx.project().getId(), page);
            assertThat(current.payload().path("content").has("title")).isFalse();
            assertThat(current.payload().path("content").path("headline").asText()).startsWith("Hello ");
            assertThat(current.validFromRevision()).isEqualTo(saved.validFromRevision());
        }
        JsonNode summary = revisionRepository.findByProjectIdAndRevisionId(fx.project().getId(), saved.validFromRevision())
                .orElseThrow().getSummary();
        Set<String> touched = new java.util.HashSet<>();
        summary.path("assets").forEach(entry -> touched.add(entry.path("uuid").asText()));
        Set<String> expected = pages.stream().map(UUID::toString).collect(Collectors.toSet());
        expected.add(base.uuid().toString());
        assertThat(touched).isEqualTo(expected);
    }

    @Test
    void theParentEdgeIsWrittenOnSaveAndClosedWhenTheParentGoes() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView child = template(fx, "Child", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);
        long baseId = assetId(fx, base.uuid());

        AssetReference edge = parentEdges(baseId).stream().filter(e -> e.getValidToRevision() == null).findFirst().orElseThrow();
        assertThat(edge.getFromAssetId()).isEqualTo(assetId(fx, child.uuid()));
        assertThat(edge.getValidFromRevision()).isEqualTo(child.validFromRevision());

        List<UsageView> usages = assetService.usages(fx.project().getId(), base.uuid());
        assertThat(usages).anySatisfy(usage -> {
            assertThat(usage.fromUid()).isEqualTo(child.uid());
            assertThat(usage.kind()).isEqualTo(ReferenceKind.TEMPLATE);
        });

        TemplateView standalone = update(fx, child, BASE_CDL, Map.of("html", "<p>$CMS_VALUE(title)$</p>"), false);
        assertThat(standalone.payload().path("parentTemplateRef").isNull()).isTrue();
        assertThat(parentEdges(baseId)).allSatisfy(e -> assertThat(e.getValidToRevision()).isEqualTo(standalone.validFromRevision()));
    }

    @Test
    void deletingATemplateWithChildrenIsBlockedNamingThem() {
        Fixture fx = newFixture();
        TemplateView base = template(fx, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView child = template(fx, "Child", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", false);

        SfException problem = assertProblem(() -> templateService.delete(base.uuid(), fx.ctx()), 409, "SF-DOM-0120");
        assertThat(problem.getProblem().getDetail()).contains(child.uid());
        assertThat(problem.getProblem().getExtensions()).containsEntry("children", List.of(child.uid()));
    }

    @Test
    void exportingAGrandchildPullsItsChainInAndImportsIntoAnEmptyProject() {
        Fixture source = newFixture();
        TemplateView base = template(source, "Base", BASE_CDL, BASE_HTML, true);
        TemplateView docs = template(source, "Docs", "", "$CMS_EXTENDS(page_template:" + base.uid() + ")$", true);
        TemplateView article = template(source, "Article", "content { editor text note { label \"Note\" } }",
                "$CMS_EXTENDS(page_template:" + docs.uid() + ")$$CMS_BLOCK(content)$$CMS_VALUE(note)$$CMS_END_BLOCK$", false);

        byte[] archive = exportImportService.exportSelection(
                source.project().getId(), new ExportSelection(Set.of(article.uuid()), false, false, Set.of()));
        Fixture target = newFixture();
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        long targetId = target.project().getId();
        TemplateView importedArticle = templateService.get(targetId, article.uuid());
        assertThat(importedArticle.payload().path("parentTemplateRef").asText()).isEqualTo(docs.uuid().toString());
        assertThat(importedArticle.ancestors()).extracting(TemplateView.TemplateRef::uuid).containsExactly(docs.uuid(), base.uuid());
        assertThat(templateService.get(targetId, docs.uuid()).isAbstract()).isTrue();
        assertThat(templateService.get(targetId, base.uuid()).isAbstract()).isTrue();
        assertThat(importedArticle.effectiveDefinition().definition().editors()).extracting("name").containsExactly("title", "note");
        assertThat(parentEdges(assetId(target, docs.uuid()))).anySatisfy(e -> assertThat(e.getValidToRevision()).isNull());
    }

    // ------------------------------------------------------------------

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), user.getId(), "inheritance test");
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("inh-user-" + n, "inh-user-" + n + "@example.com", "Inherit " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("inhp_" + n, "Inheritance " + n, null, "inheritance"), user.getId());
        return new Fixture(project, user);
    }

    private TemplateView template(Fixture fx, String name, String cdl, String html, boolean abstractTemplate) {
        return template(fx, name, cdl, Map.of("html", html), abstractTemplate);
    }

    private TemplateView template(Fixture fx, String name, String cdl, Map<String, String> channels, boolean abstractTemplate) {
        return templateService.create(new CreateTemplateCommand(
                fx.project().getId(), AssetType.PAGE_TEMPLATE, name, cdl, channels, null, false,
                Map.of("html", "{displayNameSlug}.{ext}"), null, abstractTemplate), fx.ctx());
    }

    private TemplateView update(Fixture fx, TemplateView template, String cdl, Map<String, String> channels, boolean abstractTemplate) {
        TemplateView current = templateService.get(fx.project().getId(), template.uuid());
        return templateService.update(template.uuid(), new UpdateTemplateCommand(
                current.displayName(), cdl, channels, null, false, Map.of("html", "{displayNameSlug}.{ext}"), abstractTemplate),
                current.validFromRevision(), fx.ctx());
    }

    private long head(Fixture fx) {
        return revisionRepository.findHeadRevisionId(fx.project().getId()).orElse(0L);
    }

    private long assetId(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).orElseThrow().getId();
    }

    private List<AssetReference> parentEdges(long parentAssetId) {
        return referenceRepository.findByToAssetId(parentAssetId).stream()
                .filter(e -> e.getKind() == ReferenceKind.TEMPLATE && "parentTemplateRef".equals(e.getSourcePath()))
                .toList();
    }

    private static SfException assertProblem(Runnable call, int status, String code) {
        SfException[] caught = new SfException[1];
        assertThatThrownBy(call::run).isInstanceOfSatisfying(SfException.class, ex -> {
            assertThat(ex.getStatus()).as(String.valueOf(ex.getProblem().getExtensions())).isEqualTo(status);
            if (code != null) {
                assertThat(ex.getProblem().getExtensions()).containsEntry("code", code);
            }
            caught[0] = ex;
        });
        return caught[0];
    }

    @SuppressWarnings("unchecked")
    private static List<String> codes(SfException problem) {
        return ((List<Diagnostic>) problem.getProblem().getExtensions().get("diagnostics")).stream().map(Diagnostic::code).toList();
    }
}
