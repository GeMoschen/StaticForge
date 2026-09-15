package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code asset_reference} is written on save (spec §5.4, {@code M16.3.1}): every version write
 * syncs the asset's outgoing edges in the same revision, and closes the edges the new version no
 * longer has — across plain saves, sections, soft delete, asset and project restore, import and
 * compound revisions.
 */
@SpringBootTest
@ActiveProfiles("test")
class ReferenceMaterializationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired ProjectRestoreService projectRestoreService;
    @Autowired ProjectExportImportService exportImportService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetReferenceRepository referenceRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void mediaValueOpensAnEdgeAndRemovingItClosesTheEdgeAtTheNewRevision() {
        Fixture fx = newFixture();
        AssetVersionView template = pageTemplate(fx);
        AssetVersionView media = media(fx, "hero");
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());

        ObjectNode withMedia = page.payload().deepCopy();
        withMedia.withObject("content").set("hero", mediaRef(media.uuid()));
        AssetVersionView saved = assetService.update(
                page.uuid(), new UpdateAssetCommand("Home", withMedia), page.validFromRevision(), fx.ctx());

        List<AssetReference> mediaRows = rows(fx, page.uuid(), ReferenceKind.MEDIA_REF);
        assertThat(mediaRows).singleElement().satisfies(row -> {
            assertThat(row.getToAssetId()).isEqualTo(id(fx, media.uuid()));
            assertThat(row.getSourcePath()).isEqualTo("content.hero");
            assertThat(row.getValidFromRevision()).isEqualTo(saved.validFromRevision());
            assertThat(row.getValidToRevision()).isNull();
        });

        ObjectNode withoutMedia = saved.payload().deepCopy();
        withoutMedia.withObject("content").remove("hero");
        AssetVersionView removed = assetService.update(
                page.uuid(), new UpdateAssetCommand("Home", withoutMedia), saved.validFromRevision(), fx.ctx());

        assertThat(rows(fx, page.uuid(), ReferenceKind.MEDIA_REF)).singleElement()
                .satisfies(row -> assertThat(row.getValidToRevision()).isEqualTo(removed.validFromRevision()));
        assertThat(open(fx, page.uuid())).extracting(AssetReference::getKind).containsExactly(ReferenceKind.TEMPLATE);
    }

    @Test
    void pageTemplateSectionTemplateAndCatalogCardEdges() {
        Fixture fx = newFixture();
        AssetVersionView template = pageTemplate(fx);
        AssetVersionView section = sectionTemplate(fx, "Teaser");
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, template.uuid()), fx.ctx());

        assertThat(open(fx, page.uuid())).singleElement().satisfies(row -> {
            assertThat(row.getKind()).isEqualTo(ReferenceKind.TEMPLATE);
            assertThat(row.getToAssetId()).isEqualTo(id(fx, template.uuid()));
            assertThat(row.getSourcePath()).isEqualTo("templateRef");
        });

        AssetVersionView withSection = pageService.addSection(
                page.uuid(), "main", section.uuid().toString(), null, page.validFromRevision(), fx.ctx());
        assertThat(open(fx, page.uuid()))
                .filteredOn(row -> row.getToAssetId().equals(id(fx, section.uuid())))
                .singleElement()
                .satisfies(row -> {
                    assertThat(row.getKind()).isEqualTo(ReferenceKind.TEMPLATE);
                    assertThat(row.getSourcePath()).isEqualTo("bodies.main[0].templateRef");
                    assertThat(row.getValidFromRevision()).isEqualTo(withSection.validFromRevision());
                });

        ObjectNode withCard = withSection.payload().deepCopy();
        ObjectNode catalog = withCard.withObject("content").putObject("cards");
        catalog.put("type", "CATALOG");
        ObjectNode card = catalog.putArray("cards").addObject();
        card.put("instanceId", UUID.randomUUID().toString());
        card.put("templateRef", section.uuid().toString());
        card.putObject("content");
        assetService.update(page.uuid(), new UpdateAssetCommand("Home", withCard), withSection.validFromRevision(), fx.ctx());

        assertThat(open(fx, page.uuid()))
                .filteredOn(row -> row.getKind() == ReferenceKind.CONTENT_REF)
                .singleElement()
                .satisfies(row -> {
                    assertThat(row.getToAssetId()).isEqualTo(id(fx, section.uuid()));
                    assertThat(row.getSourcePath()).isEqualTo("content.cards.cards[0].templateRef");
                });
    }

    @Test
    void pageReferenceWritesANavEdge() {
        Fixture fx = newFixture();
        AssetVersionView page = pageService.create(new CreatePageCommand("Home", null, pageTemplate(fx).uuid()), fx.ctx());

        AssetVersionView reference = pageReferenceService.create(
                new CreatePageReferenceCommand("Home link", null, PageReferenceTargetKind.PAGE, page.uuid(), null), fx.ctx());

        assertThat(open(fx, reference.uuid())).singleElement().satisfies(row -> {
            assertThat(row.getKind()).isEqualTo(ReferenceKind.NAV);
            assertThat(row.getToAssetId()).isEqualTo(id(fx, page.uuid()));
            assertThat(row.getSourcePath()).isEqualTo("target");
        });
    }

    @Test
    void softDeleteClosesEdgesAndAssetAndProjectRestoreReopenThem() {
        Fixture fx = newFixture();
        AssetVersionView template = pageTemplate(fx);
        AssetVersionView media = media(fx, "hero");
        ObjectNode payload = pagePayload(template.uuid());
        payload.withObject("content").set("hero", mediaRef(media.uuid()));
        AssetVersionView page = createPage(fx, payload);
        List<Edge> edges = edges(open(fx, page.uuid()));
        assertThat(edges).hasSize(2);

        assetService.softDelete(page.uuid(), false, fx.ctx());
        long deletedAt = assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision();
        assertThat(open(fx, page.uuid())).isEmpty();
        assertThat(rows(fx, page.uuid(), null)).allSatisfy(row -> assertThat(row.getValidToRevision()).isEqualTo(deletedAt));

        AssetVersionView restored = assetService.restore(page.uuid(), page.validFromRevision(), fx.ctx());
        assertThat(edges(open(fx, page.uuid()))).containsExactlyInAnyOrderElementsOf(edges);
        assertThat(open(fx, page.uuid()))
                .allSatisfy(row -> assertThat(row.getValidFromRevision()).isEqualTo(restored.validFromRevision()));

        ObjectNode withoutMedia = restored.payload().deepCopy();
        withoutMedia.withObject("content").remove("hero");
        assetService.update(page.uuid(), new UpdateAssetCommand("Page", withoutMedia), restored.validFromRevision(), fx.ctx());
        assertThat(open(fx, page.uuid())).extracting(AssetReference::getKind).containsExactly(ReferenceKind.TEMPLATE);

        long rollback = projectRestoreService
                .restoreTo(fx.project().getId(), restored.validFromRevision(), fx.user().getId(), "rollback")
                .getRevisionId();
        assertThat(edges(open(fx, page.uuid()))).containsExactlyInAnyOrderElementsOf(edges);
        assertThat(open(fx, page.uuid()))
                .filteredOn(row -> row.getKind() == ReferenceKind.MEDIA_REF)
                .singleElement()
                .satisfies(row -> assertThat(row.getValidFromRevision()).isEqualTo(rollback));
    }

    @Test
    void importWritesEdgesForEveryImportedAssetInTheImportRevision() {
        Fixture source = newFixture();
        AssetVersionView template = pageTemplate(source);
        AssetVersionView media = media(source, "hero");
        ObjectNode payload = pagePayload(template.uuid());
        payload.withObject("content").set("hero", mediaRef(media.uuid()));
        AssetVersionView page = createPage(source, payload);
        byte[] archive = exportImportService.exportProject(source.project().getId());

        Fixture target = newFixture();
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        AssetVersionView importedPage = assetService.requireCurrent(target.project().getId(), page.uuid());
        assertThat(open(target, page.uuid()))
                .extracting(row -> new Edge(row.getToAssetId(), row.getKind(), row.getSourcePath()))
                .containsExactlyInAnyOrder(
                        new Edge(id(target, template.uuid()), ReferenceKind.TEMPLATE, "templateRef"),
                        new Edge(id(target, media.uuid()), ReferenceKind.MEDIA_REF, "content.hero"));
        assertThat(open(target, page.uuid()))
                .allSatisfy(row -> assertThat(row.getValidFromRevision()).isEqualTo(importedPage.validFromRevision()));
    }

    @Test
    void editorRenameCascadeWritesEveryRewrittenPagesEdgesInTheOneBatchRevision() {
        Fixture fx = newFixture();
        AssetVersionView template = pageTemplate(fx);
        AssetVersionView media = media(fx, "hero");
        TemplateView section = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.SECTION_TEMPLATE, "Card",
                        "content { editor text image {} }", Map.of(), null, false, null),
                fx.ctx());
        List<AssetVersionView> pages = List.of(
                createPage(fx, pageWithImageSection(template.uuid(), section.uuid(), media.uuid())),
                createPage(fx, pageWithImageSection(template.uuid(), section.uuid(), media.uuid())));

        TemplateView renamed = templateService.update(
                section.uuid(),
                new UpdateTemplateCommand("Card", "content { editor text hero { renamedFrom \"image\" } }",
                        Map.of("html", "$CMS_REF(page:" + pages.get(0).uid() + ")$"), null, false, null),
                section.validFromRevision(),
                fx.ctx());

        // The renamed template's own version carries its new OCTL edge set ...
        assertThat(open(fx, section.uuid())).singleElement().satisfies(row -> {
            assertThat(row.getKind()).isEqualTo(ReferenceKind.OCTL_REF);
            assertThat(row.getToAssetId()).isEqualTo(id(fx, pages.get(0).uuid()));
            assertThat(row.getValidFromRevision()).isEqualTo(renamed.validFromRevision());
        });

        // ... and every rewritten page's edge set is written in the cascade's one batch revision.
        long batch = assetService.requireCurrent(fx.project().getId(), pages.get(0).uuid()).validFromRevision();
        assertThat(batch).isGreaterThan(renamed.validFromRevision());
        for (AssetVersionView page : pages) {
            assertThat(assetService.requireCurrent(fx.project().getId(), page.uuid()).validFromRevision()).isEqualTo(batch);
            List<AssetReference> mediaRows = rows(fx, page.uuid(), ReferenceKind.MEDIA_REF);
            assertThat(mediaRows).filteredOn(row -> row.getValidToRevision() == null).singleElement().satisfies(row -> {
                assertThat(row.getSourcePath()).isEqualTo("bodies.main[0].content.hero");
                assertThat(row.getValidFromRevision()).isEqualTo(batch);
            });
            assertThat(mediaRows).filteredOn(row -> row.getValidToRevision() != null).singleElement().satisfies(row -> {
                assertThat(row.getSourcePath()).isEqualTo("bodies.main[0].content.image");
                assertThat(row.getValidToRevision()).isEqualTo(batch);
            });
        }
    }

    @Test
    void templateSaveWritesOctlEdgesPerChannelAndClosesRemovedOnes() {
        Fixture fx = newFixture();
        TemplateView teaser = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.SECTION_TEMPLATE, "Teaser", "",
                        Map.of("html", "<p>teaser</p>"), null, false, null),
                fx.ctx());
        AssetVersionView about = createPage(fx, pagePayload(pageTemplate(fx).uuid()));

        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Landing", "",
                        Map.of(
                                "html", "<main>$CMS_INCLUDE(section_template:" + teaser.uid() + ")$</main>",
                                "markdown", "[About]($CMS_REF(page:" + about.uid() + ")$)"),
                        null, false, null),
                fx.ctx());

        assertThat(open(fx, template.uuid()))
                .extracting(row -> new Edge(row.getToAssetId(), row.getKind(), row.getSourcePath()))
                .containsExactlyInAnyOrder(
                        new Edge(id(fx, teaser.uuid()), ReferenceKind.OCTL_INCLUDE, "channelTemplates.html"),
                        new Edge(id(fx, about.uuid()), ReferenceKind.OCTL_REF, "channelTemplates.markdown"));

        TemplateView withoutInclude = templateService.saveChannel(
                template.uuid(), "html", "<main></main>", template.validFromRevision(), fx.ctx());

        assertThat(rows(fx, template.uuid(), ReferenceKind.OCTL_INCLUDE)).singleElement()
                .satisfies(row -> assertThat(row.getValidToRevision()).isEqualTo(withoutInclude.validFromRevision()));
        assertThat(open(fx, template.uuid())).extracting(AssetReference::getKind).containsExactly(ReferenceKind.OCTL_REF);
    }

    @Test
    void navRootReferenceWritesAnOctlRefToTheNavigationRoot() {
        Fixture fx = newFixture();
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Nav", "",
                        Map.of("html", "<nav>$CMS_NAVIGATION(nav:root)$</nav>"), null, false, null),
                fx.ctx());

        long navigationRoot = assetRepository
                .findByProjectIdAndAssetTypeAndUid(fx.project().getId(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getId)
                .orElseThrow();
        assertThat(open(fx, template.uuid())).singleElement().satisfies(row -> {
            assertThat(row.getKind()).isEqualTo(ReferenceKind.OCTL_REF);
            assertThat(row.getToAssetId()).isEqualTo(navigationRoot);
            assertThat(row.getSourcePath()).isEqualTo("channelTemplates.html");
        });
    }

    // ------------------------------------------------------------------

    private AssetVersionView pageTemplate(Fixture fx) {
        ObjectNode payload = mapper.createObjectNode();
        payload.putArray("bodies").addObject().put("name", "main");
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, "Layout", null, payload, null),
                fx.ctx());
    }

    private AssetVersionView sectionTemplate(Fixture fx, String name) {
        return assetService.create(
                new CreateAssetCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, name, null, mapper.createObjectNode(), null),
                fx.ctx());
    }

    private AssetVersionView media(Fixture fx, String name) {
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.MEDIA, name, null, mapper.createObjectNode(), null),
                fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, ObjectNode payload) {
        return assetService.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE, "Page", null, payload, null), fx.ctx());
    }

    private ObjectNode pagePayload(UUID templateUuid) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.putObject("content");
        return payload;
    }

    private ObjectNode pageWithImageSection(UUID templateUuid, UUID sectionUuid, UUID mediaUuid) {
        ObjectNode payload = pagePayload(templateUuid);
        ObjectNode section = payload.putObject("bodies").putArray("main").addObject();
        section.put("instanceId", UUID.randomUUID().toString());
        section.put("templateRef", sectionUuid.toString());
        section.putObject("content").set("image", mediaRef(mediaUuid));
        return payload;
    }

    private ObjectNode mediaRef(UUID mediaUuid) {
        return mapper.createObjectNode().put("type", "MEDIA_REF").put("uuid", mediaUuid.toString());
    }

    private long id(Fixture fx, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(fx.project().getId(), uuid).map(Asset::getId).orElseThrow();
    }

    private List<AssetReference> open(Fixture fx, UUID from) {
        return referenceRepository.findByFromAssetIdAndValidToRevisionIsNull(id(fx, from));
    }

    private List<AssetReference> rows(Fixture fx, UUID from, ReferenceKind kind) {
        return referenceRepository.findByFromAssetId(id(fx, from)).stream()
                .filter(row -> kind == null || row.getKind() == kind)
                .toList();
    }

    private static List<Edge> edges(List<AssetReference> rows) {
        return rows.stream().map(row -> new Edge(row.getToAssetId(), row.getKind(), row.getSourcePath())).toList();
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("ref-user-" + n, "ref-user-" + n + "@example.com", "Ref User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("refp_" + n, "Reference Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Edge(long toAssetId, ReferenceKind kind, String sourcePath) {}

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
