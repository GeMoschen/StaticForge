package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.bootstrap.SearchIndexCatchUpRunner;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.health.SearchIndexHealthIndicator;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.search.SearchIndexService;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchSchemaVersion;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.search.SearchStatus;
import com.acme.staticforge.user.UserService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;
import java.util.stream.Stream;
import org.apache.lucene.index.IndexWriter;
import org.apache.lucene.index.IndexWriterConfig;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.store.Lock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Crash consistency and recovery (M23.2.2) on a filesystem index with live indexing switched off, so a commit that
 * never reached the index (the app stopped before indexing) is reproducible: startup catch-up, a deleted index, an
 * outdated document model, and a directory locked by a second instance.
 */
@SpringBootTest
@ActiveProfiles("test")
class SearchIndexRecoveryIntegrationTest {

    private static final Path INDEX_ROOT;

    static {
        try {
            INDEX_ROOT = Files.createTempDirectory("sf-search-recovery");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("sf.search.directory", () -> "filesystem");
        registry.add("sf.search.index-root", INDEX_ROOT::toString);
        registry.add("sf.search.live-indexing", () -> "false");
    }

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired RevisionRepository revisions;
    @Autowired SearchService search;
    @Autowired SearchIndexer indexer;
    @Autowired SearchIndexService index;
    @Autowired SearchIndexCatchUpRunner startup;
    @Autowired SearchIndexHealthIndicator health;

    private SearchFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new SearchFixtures(users, projects, assets, templates, search, indexer);
    }

    /** What a restart does for search: the catch-up runner, then waiting for its background syncs. */
    private void restart() {
        startup.run(null);
        fixtures.awaitIndexed();
    }

    private long head(SearchFixtures.Fixture fx) {
        return revisions.findHeadRevisionId(fx.projectId()).orElseThrow();
    }

    @Test
    void startupCatchesUpRevisionsThatNeverReachedTheIndex() {
        SearchFixtures.Fixture fx = fixtures.project("catchup");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView before = fixtures.page(fx, "Before", template.uuid(), "Intro", "<p>indexed aardvark</p>");
        restart();
        assertThat(fixtures.find(fx, "aardvark")).containsExactly(before.uuid());

        AssetVersionView missed = fixtures.page(fx, "Missed", template.uuid(), "Intro", "<p>ocelot sighting</p>");
        fixtures.edit(fx, before.uuid(), payload -> payload.withObject("content").put("intro", "edited while down"));
        fixtures.awaitIndexed();
        assertThat(fixtures.hits(fx, "ocelot")).isEmpty();
        SearchStatus lagging = indexer.status(fx.projectId());
        assertThat(lagging.lag()).isEqualTo(2);
        assertThat(lagging.state()).isEqualTo(SearchStatus.State.CATCHING_UP);

        restart();

        assertThat(fixtures.find(fx, "ocelot")).containsExactly(missed.uuid());
        assertThat(fixtures.find(fx, "edited")).containsExactly(before.uuid());
        SearchStatus caughtUp = indexer.status(fx.projectId());
        assertThat(caughtUp.indexedRevision()).isEqualTo(head(fx));
        assertThat(caughtUp.lag()).isZero();
        assertThat(caughtUp.state()).isEqualTo(SearchStatus.State.READY);
        assertThat(caughtUp.lastRebuildAt()).isNotNull();
    }

    @Test
    void deletedIndexDirectoryIsRebuiltOnStartup() throws IOException {
        SearchFixtures.Fixture fx = fixtures.project("deleted");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView page = fixtures.page(fx, "Kept", template.uuid(), "Intro", "<p>resilient badger</p>");
        restart();
        assertThat(fixtures.find(fx, "badger")).containsExactly(page.uuid());

        index.close(fx.projectId());
        deleteRecursively(INDEX_ROOT.resolve(Long.toString(fx.projectId())));
        assertThat(index.indexedRevision(fx.projectId())).isEmpty();

        restart();

        assertThat(fixtures.find(fx, "badger")).containsExactly(page.uuid());
        assertThat(indexer.status(fx.projectId()).indexedRevision()).isEqualTo(head(fx));
    }

    @Test
    void outdatedDocumentModelTriggersARebuild() throws IOException {
        SearchFixtures.Fixture fx = fixtures.project("schema");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        restart();
        AssetVersionView page = fixtures.page(fx, "Unseen", template.uuid(), "Intro", "<p>elusive lynx</p>");

        // An index stamped current but written by an older document model: replay alone would find nothing to do.
        index.close(fx.projectId());
        try (Directory directory = FSDirectory.open(INDEX_ROOT.resolve(Long.toString(fx.projectId())));
                IndexWriter writer = new IndexWriter(directory, new IndexWriterConfig())) {
            writer.deleteAll();
            writer.setLiveCommitData(Map.of(
                            "sf.indexedRevision", Long.toString(head(fx)),
                            "sf.schemaVersion", "0",
                            "sf.owner", SearchIndexer.owner(fx.project()))
                    .entrySet());
            writer.commit();
        }

        restart();

        assertThat(fixtures.find(fx, "lynx")).containsExactly(page.uuid());
    }

    @Test
    void indexOfAnotherDatabaseIsRebuilt() throws IOException {
        SearchFixtures.Fixture fx = fixtures.project("owner");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        restart();
        AssetVersionView page = fixtures.page(fx, "Fresh", template.uuid(), "Intro", "<p>wandering heron</p>");

        index.close(fx.projectId());
        try (Directory directory = FSDirectory.open(INDEX_ROOT.resolve(Long.toString(fx.projectId())));
                IndexWriter writer = new IndexWriter(directory, new IndexWriterConfig())) {
            writer.deleteAll();
            writer.setLiveCommitData(Map.of(
                            "sf.indexedRevision", Long.toString(head(fx)),
                            "sf.schemaVersion", Integer.toString(SearchSchemaVersion.CURRENT),
                            "sf.owner", "someone-else@0")
                    .entrySet());
            writer.commit();
        }

        restart();

        assertThat(fixtures.find(fx, "heron")).containsExactly(page.uuid());
    }

    @Test
    void lockedIndexDirectoryMakesSearchUnavailableWithoutFailingTheApp() throws IOException {
        SearchFixtures.Fixture fx = fixtures.project("locked");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.page(fx, "Page", template.uuid(), "Intro", "<p>locked words</p>");
        restart();
        index.close(fx.projectId());

        try (Directory other = FSDirectory.open(INDEX_ROOT.resolve(Long.toString(fx.projectId())));
                Lock held = other.obtainLock(IndexWriter.WRITE_LOCK_NAME)) {
            restart();

            assertThat(indexer.status(fx.projectId()).state()).isEqualTo(SearchStatus.State.UNAVAILABLE);
            assertThatThrownBy(() -> fixtures.hits(fx, "locked"))
                    .isInstanceOf(SfException.class)
                    .satisfies(e -> assertThat(((SfException) e).getStatus()).isEqualTo(503));
            assertThat(health.health().getStatus().getCode()).isEqualTo("UP");
            assertThat(health.health().getDetails()).containsEntry("search", "DEGRADED");
            held.ensureValid();
        }
    }

    private static void deleteRecursively(Path path) throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(path)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.delete(p);
            }
        }
    }
}
