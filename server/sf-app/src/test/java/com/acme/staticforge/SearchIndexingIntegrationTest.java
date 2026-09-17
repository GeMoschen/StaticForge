package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.search.SearchDocument;
import com.acme.staticforge.search.SearchHit;
import com.acme.staticforge.search.SearchIndexService;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.search.SearchStatus;
import com.acme.staticforge.search.extract.ExtractionContext;
import com.acme.staticforge.search.extract.IndexableAsset;
import com.acme.staticforge.search.extract.PageTextExtractor;
import com.acme.staticforge.search.extract.SearchTextExtractor;
import com.acme.staticforge.user.UserService;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * After-commit indexing (M23.2.1): every mutation path reaches the index once its transaction commits, from the
 * assets' current versions, without the request waiting; a rolled-back transaction never does.
 */
@SpringBootTest
@ActiveProfiles("test")
class SearchIndexingIntegrationTest {

    /** Blocks indexing of pages named "Slow …" until released, to prove saves don't wait for indexing. */
    @TestConfiguration
    static class SlowExtractorConfiguration {
        static final CountDownLatch RELEASE = new CountDownLatch(1);
        static final CountDownLatch ENTERED = new CountDownLatch(1);

        @Bean
        @Order(Ordered.HIGHEST_PRECEDENCE)
        SearchTextExtractor slowPageExtractor() {
            PageTextExtractor pages = new PageTextExtractor();
            return new SearchTextExtractor() {
                @Override
                public boolean supports(AssetType type) {
                    return type == AssetType.PAGE;
                }

                @Override
                public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
                    if (asset.displayName().startsWith("Slow")) {
                        ENTERED.countDown();
                        try {
                            RELEASE.await(30, TimeUnit.SECONDS);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    return pages.extract(asset, context);
                }
            };
        }
    }

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired MediaService media;
    @Autowired ChannelService channels;
    @Autowired FolderService folders;
    @Autowired PageService pages;
    @Autowired RevisionService revisionService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired ProjectRestoreService restoreService;
    @Autowired ProjectExportImportService exportImport;
    @Autowired SearchService search;
    @Autowired SearchIndexer indexer;
    @Autowired SearchIndexService index;
    @Autowired MeterRegistry meters;
    @Autowired PlatformTransactionManager transactionManager;

    private SearchFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new SearchFixtures(users, projects, assets, templates, search, indexer);
    }

    private double events() {
        return meters.get("sf.search.index.events").counter().count();
    }

    @Test
    void createUpdateDeleteRestoreAndUidChangeReachTheIndex() {
        SearchFixtures.Fixture fx = fixtures.project("idx");
        TemplateView template = fixtures.pageTemplate(fx, "Article");

        AssetVersionView page = fixtures.page(fx, "About us", template.uuid(), "Intro", "<p>We keep <strong>lighthouses</strong></p>");
        assertThat(fixtures.find(fx, "lighthouses")).containsExactly(page.uuid());

        AssetVersionView edited = fixtures.edit(fx, page.uuid(), payload -> payload.withObject("content")
                .putObject("body").put("format", "html").put("value", "<p>We keep windmills</p>"));
        assertThat(fixtures.find(fx, "windmills")).containsExactly(page.uuid());
        assertThat(fixtures.find(fx, "lighthouses")).isEmpty();

        assets.softDelete(page.uuid(), false, fx.ctx());
        assertThat(fixtures.find(fx, "windmills")).isEmpty();

        assets.restore(page.uuid(), edited.validFromRevision(), fx.ctx());
        assertThat(fixtures.find(fx, "windmills")).containsExactly(page.uuid());

        String oldUid = assets.requireCurrent(fx.projectId(), page.uuid()).uid();
        assets.changeUid(page.uuid(), "renamed_about_page", fx.ctx());
        fixtures.awaitIndexed();
        assertThat(fixtures.hits(fx, "renamed_about_page"))
                .extracting(SearchHit::uuid, SearchHit::matchedIn)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(page.uuid(), SearchHit.MatchedIn.UID));
        assertThat(fixtures.hits(fx, oldUid)).extracting(SearchHit::matchedIn).doesNotContain(SearchHit.MatchedIn.UID);
    }

    @Test
    void projectCreationIsIndexedAndNothingIsDuplicated() {
        SearchFixtures.Fixture fx = fixtures.project("create");
        fixtures.awaitIndexed();
        SearchStatus status = indexer.status(fx.projectId());
        assertThat(status.indexedRevision()).isEqualTo(status.latestRevision());
        assertThat(status.state()).isEqualTo(SearchStatus.State.READY);

        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView page = fixtures.page(fx, "Unique", template.uuid(), "zanzibar", "<p>zanzibar again</p>");
        fixtures.edit(fx, page.uuid(), payload -> payload.withObject("content").put("intro", "zanzibar edited"));

        assertThat(fixtures.find(fx, "zanzibar")).containsExactly(page.uuid());
    }

    @Test
    void projectRollbackReflectsTheRestoredContent() {
        SearchFixtures.Fixture fx = fixtures.project("rollback");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView page = fixtures.page(fx, "Story", template.uuid(), "Intro", "<p>original marmalade</p>");
        long before = page.validFromRevision();
        fixtures.edit(fx, page.uuid(), payload -> payload.withObject("content")
                .putObject("body").put("format", "html").put("value", "<p>replaced porridge</p>"));
        AssetVersionView later = fixtures.page(fx, "Later page", template.uuid(), "Intro", "<p>afterthought</p>");
        assertThat(fixtures.find(fx, "porridge")).containsExactly(page.uuid());

        restoreService.restoreTo(fx.projectId(), before, fx.user().getId(), "roll back");

        assertThat(fixtures.find(fx, "marmalade")).containsExactly(page.uuid());
        assertThat(fixtures.find(fx, "porridge")).isEmpty();
        assertThat(fixtures.find(fx, "afterthought")).doesNotContain(later.uuid());
    }

    @Test
    void importedPagesAreSearchable() {
        SearchFixtures.Fixture source = fixtures.project("export");
        TemplateView template = fixtures.pageTemplate(source, "Article");
        AssetVersionView page = fixtures.page(source, "Exported", template.uuid(), "Intro", "<p>quokka habitat</p>");
        byte[] archive = exportImport.exportProject(source.projectId());

        SearchFixtures.Fixture target = fixtures.project("import");
        exportImport.importProject(target.projectId(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(fixtures.find(target, "quokka")).hasSize(1);
        assertThat(fixtures.find(source, "quokka")).containsExactly(page.uuid());
    }

    @Test
    void mediaMetadataIsSearchable() {
        SearchFixtures.Fixture fx = fixtures.project("media");
        AssetVersionView file = media.upload(
                fx.projectId(), null, "notes.txt", null, "plain file".getBytes(StandardCharsets.UTF_8), fx.ctx());
        assertThat(fixtures.find(fx, "notes.txt")).containsExactly(file.uuid());

        media.updateMetadata(file.uuid(), "A foggy harbour at dawn", "Harbour", "Jane Doe", null, file.validFromRevision(), fx.ctx());
        assertThat(fixtures.find(fx, "foggy")).containsExactly(file.uuid());
    }

    @Test
    void sectionTemplateDefinitionChangeReextractsItsPages() {
        SearchFixtures.Fixture fx = fixtures.project("cascade");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        String cdl = """
                content {
                  editor text headline { label "Headline" }
                  editor text note { label "Note" }
                }
                """;
        TemplateView teaser = fixtures.sectionTemplate(fx, "Teaser", cdl, "<h2>$CMS_VALUE(headline)$</h2>$CMS_VALUE(note)$");
        AssetVersionView page = fixtures.page(fx, "With section", template.uuid(), payload -> {
            var content = fixtures.section(payload, "main", teaser.uuid());
            content.put("headline", "pelican headline");
            content.put("note", "flamingo note");
        });
        assertThat(fixtures.find(fx, "flamingo")).containsExactly(page.uuid());

        fixtures.updateTemplate(fx, teaser.uuid(), """
                content {
                  editor text headline { label "Headline" }
                }
                """, "<h2>$CMS_VALUE(headline)$</h2>");

        assertThat(fixtures.find(fx, "flamingo")).isEmpty();
        assertThat(fixtures.find(fx, "pelican")).containsExactly(page.uuid());
    }

    @Test
    void channelSeedingReachesTheTemplatesItCopiesInto() {
        SearchFixtures.Fixture fx = fixtures.project("channel");
        TemplateView teaser = fixtures.sectionTemplate(
                fx, "Teaser", "content { editor text headline { label \"Headline\" } }", "<p>ibis marker</p>");
        fixtures.awaitIndexed();
        assertThat(fixtures.hits(fx, "ibis")).singleElement()
                .satisfies(hit -> assertThat(hit.snippet().highlights()).hasSize(1));

        // A new channel copying html seeds every template's source in one ChannelServiceImpl revision.
        channels.create(new CreateChannelRequest("markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1,
                null, "html"), fx.ctx());
        fixtures.awaitIndexed();

        assertThat(fixtures.hits(fx, "ibis")).singleElement().satisfies(hit -> {
            assertThat(hit.uuid()).isEqualTo(teaser.uuid());
            assertThat(hit.snippet().highlights()).as("html and the seeded markdown source").hasSize(2);
        });
    }

    @Test
    void templateRenameCascadeKeepsMigratedValuesSearchable() {
        SearchFixtures.Fixture fx = fixtures.project("rename");
        TemplateView template = templates.create(new com.acme.staticforge.asset.template.CreateTemplateCommand(
                fx.projectId(), AssetType.PAGE_TEMPLATE, "Story", "content { editor text title { label \"Title\" } }",
                java.util.Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false,
                java.util.Map.of("html", "{displayNameSlug}.{ext}")), fx.ctx());
        AssetVersionView created = pages.create(new CreatePageCommand("Tale", null, template.uuid()), fx.ctx());
        com.fasterxml.jackson.databind.node.ObjectNode payload = created.payload().deepCopy();
        payload.withObject("content").put("title", "cormorant tale");
        AssetVersionView page = pages.update(created.uuid(), payload, created.validFromRevision(), fx.ctx());
        assertThat(fixtures.find(fx, "cormorant")).containsExactly(page.uuid());

        // Renaming the editor migrates every page's value in the template's revision. Were the pages not re-indexed,
        // their stale key would no longer be in the definition and the word would stop matching.
        fixtures.updateTemplate(fx, template.uuid(),
                "content { editor text headline { label \"Headline\" renamedFrom \"title\" } }",
                "<h1>$CMS_VALUE(headline)$</h1>");

        assertThat(assets.requireCurrent(fx.projectId(), page.uuid()).payload().path("content").has("headline")).isTrue();
        assertThat(fixtures.find(fx, "cormorant")).containsExactly(page.uuid());
    }

    @Test
    void movesReachTheFolderFilter() {
        SearchFixtures.Fixture fx = fixtures.project("move");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView news = folders.create(null, "News", FolderScope.PAGES, fx.ctx());
        AssetVersionView archive = folders.create(null, "Archive", FolderScope.PAGES, fx.ctx());
        AssetVersionView page = fixtures.page(fx, "Heron report", template.uuid(), "Intro", "<p>grey heron</p>");
        assets.move(page.uuid(), news.uuid(), fx.ctx());
        fixtures.awaitIndexed();
        assertThat(search.search(fx.projectId(), "heron", null, news.folderPath(), 0, 20, null).hits().hits())
                .extracting(SearchHit::uuid)
                .containsExactly(page.uuid());

        // Moving the folder moves the page's path too.
        folders.move(news.uuid(), archive.uuid(), fx.ctx());
        fixtures.awaitIndexed();
        String movedPath = assets.requireCurrent(fx.projectId(), page.uuid()).folderPath();
        assertThat(movedPath).startsWith(archive.folderPath());
        assertThat(search.search(fx.projectId(), "heron", null, archive.folderPath(), 0, 20, null).hits().hits())
                .extracting(SearchHit::uuid, SearchHit::folderPath)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(page.uuid(), movedPath));
        assertThat(search.search(fx.projectId(), "heron", null, news.folderPath(), 0, 20, null).hits().hits()).isEmpty();
    }

    @Test
    void rolledBackTransactionNeverReachesTheIndex() {
        SearchFixtures.Fixture fx = fixtures.project("tx");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.awaitIndexed();
        double eventsBefore = events();
        long headBefore = revisionRepository.findHeadRevisionId(fx.projectId()).orElseThrow();

        assertThatThrownBy(() -> new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    fixtures.page(fx, "Doomed", template.uuid(), "Intro", "<p>kumquat</p>");
                    throw new IllegalStateException("forced rollback after the summary was appended");
                }))
                .isInstanceOf(IllegalStateException.class);

        fixtures.awaitIndexed();
        assertThat(events()).isEqualTo(eventsBefore);
        assertThat(revisionRepository.findHeadRevisionId(fx.projectId())).hasValue(headBefore);
        assertThat(fixtures.find(fx, "kumquat")).isEmpty();
    }

    @Test
    void compoundRevisionTriggersExactlyOneIndexingPass() {
        SearchFixtures.Fixture fx = fixtures.project("batch");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.awaitIndexed();
        double eventsBefore = events();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            Revision batch = revisionService.beginBatch(fx.projectId(), ChangeType.CREATE, "batch", fx.user().getId());
            RevisionContext joined = RevisionContext.joining(batch, fx.user().getId(), "batch");
            for (String name : new String[] {"First", "Second", "Third"}) {
                SearchFixtures.Fixture inBatch = new SearchFixtures.Fixture(fx.project(), fx.user(), joined);
                fixtures.page(inBatch, name, template.uuid(), "Intro", "<p>batched nectarine " + name + "</p>");
            }
        });

        assertThat(fixtures.find(fx, "nectarine")).hasSize(3);
        assertThat(events()).isEqualTo(eventsBefore + 1);
    }

    @Test
    void savesReturnBeforeIndexingCompletes() throws Exception {
        SearchFixtures.Fixture fx = fixtures.project("slow");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.awaitIndexed();

        AssetVersionView page = fixtures.page(fx, "Slow page", template.uuid(), "Intro", "<p>tortoise</p>");

        // The save has returned while indexing is still blocked inside extraction.
        assertThat(SlowExtractorConfiguration.ENTERED.await(30, TimeUnit.SECONDS)).isTrue();
        assertThat(SlowExtractorConfiguration.RELEASE.getCount()).isEqualTo(1);
        assertThat(fixtures.hits(fx, "tortoise")).isEmpty();

        SlowExtractorConfiguration.RELEASE.countDown();
        assertThat(fixtures.find(fx, "tortoise")).containsExactly(page.uuid());
    }

    @Test
    void archivingAProjectClosesItsIndex() {
        SearchFixtures.Fixture fx = fixtures.project("archive");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.page(fx, "Open", template.uuid(), "Intro", "<p>kept open</p>");
        fixtures.awaitIndexed();
        assertThat(index.openProjects()).contains(fx.projectId());

        projects.archive(fx.key(), fx.ctx());
        fixtures.awaitIndexed();

        assertThat(index.openProjects()).doesNotContain(fx.projectId());
    }
}
