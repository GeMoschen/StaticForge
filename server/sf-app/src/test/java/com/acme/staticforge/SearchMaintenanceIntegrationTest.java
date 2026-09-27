package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.SystemJobService;
import com.acme.staticforge.housekeeping.search.SearchMaintenanceJob;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.search.SearchIndexService;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.apache.lucene.index.IndexWriter;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.store.Lock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The {@code search-maintenance} job (M29.3.3) on a filesystem index with live indexing switched off, so a commit
 * whose indexing event was lost is reproducible: lag caught up by the sync, a document deleted behind the indexer's
 * back repaired by a rebuild, merging of deleted documents above the threshold only, archived projects skipped and an
 * unavailable index reported without failing the job.
 */
@SpringBootTest
@ActiveProfiles("test")
class SearchMaintenanceIntegrationTest {

    private static Path indexRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        indexRoot = Files.createTempDirectory("sf-search-maintenance");
        registry.add("sf.search.directory", () -> "filesystem");
        registry.add("sf.search.index-root", indexRoot::toString);
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
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository runs;
    @Autowired SystemJobService jobs;

    private SearchFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new SearchFixtures(users, projects, assets, templates, search, indexer);
        mergeThreshold(20);
    }

    @Test
    @DisplayName("a document deleted from the index is detected by the count check and rebuilt")
    void missingDocumentIsRepaired() throws Exception {
        SearchFixtures.Fixture fx = fixtures.project("maintmiss");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        AssetVersionView lost = fixtures.page(fx, "Lost", template.uuid(), "Intro", "<p>vanishing aardvark</p>");
        fixtures.page(fx, "Kept", template.uuid(), "Intro", "<p>steady badger</p>");
        sync(fx);
        assertThat(fixtures.hits(fx, "aardvark")).hasSize(1);
        index.delete(fx.projectId(), lost.uuid());
        index.commit(fx.projectId(), head(fx), SearchIndexer.owner(fx.project()));
        assertThat(fixtures.hits(fx, "aardvark")).isEmpty();

        JsonNode entry = entry(run(), fx);
        assertThat(entry.path("result").asText()).isEqualTo("REPAIRED");
        assertThat(entry.path("documents").asLong()).isEqualTo(entry.path("indexable").asLong() - 1);
        assertThat(entry.path("documentsAfter").asLong()).isEqualTo(entry.path("indexable").asLong());
        assertThat(fixtures.find(fx, "aardvark")).containsExactly(lost.uuid());
    }

    @Test
    @DisplayName("a commit whose indexing event was lost is caught up by the sync, no rebuild")
    void lostEventIsCaughtUp() throws Exception {
        SearchFixtures.Fixture fx = fixtures.project("maintlag");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        fixtures.page(fx, "First", template.uuid(), "Intro", "<p>early heron</p>");
        sync(fx);
        AssetVersionView missed = fixtures.page(fx, "Missed", template.uuid(), "Intro", "<p>late ocelot</p>");
        assertThat(indexer.status(fx.projectId()).lag()).isEqualTo(1);
        assertThat(fixtures.hits(fx, "ocelot")).isEmpty();

        JsonNode entry = entry(run(), fx);
        assertThat(entry.path("result").asText()).isEqualTo("OK");
        assertThat(entry.path("lagBefore").asLong()).isEqualTo(1);
        assertThat(entry.path("lagAfter").asLong()).isZero();
        assertThat(entry.path("documents").asLong()).isEqualTo(entry.path("indexable").asLong());
        assertThat(fixtures.find(fx, "ocelot")).containsExactly(missed.uuid());
    }

    @Test
    @DisplayName("deleted documents are merged away above the threshold, not below")
    void mergeAboveTheThreshold() throws Exception {
        SearchFixtures.Fixture fx = fixtures.project("maintmerge");
        TemplateView template = fixtures.pageTemplate(fx, "Article");
        java.util.List<AssetVersionView> pages = new java.util.ArrayList<>();
        for (int i = 0; i < 10; i++) {
            pages.add(fixtures.page(fx, "Page " + i, template.uuid(), "Intro", "<p>merge candidate</p>"));
        }
        sync(fx); // one commit: the documents share a segment
        // One pure delete: no new segment is flushed, and 1 of 11 documents stays below the share of deletes Lucene's
        // merge policy expunges on its own (an update, or more deletes, would be merged away at the next commit).
        assets.softDelete(pages.get(0).uuid(), true, fx.ctx());
        sync(fx);
        SearchIndexer.IndexCounts before = indexer.counts(fx.projectId()).orElseThrow();
        assertThat(before.deleted()).as("updates left deleted documents").isPositive();

        mergeThreshold(50);
        JsonNode below = entry(run(), fx);
        assertThat(below.path("merged").asBoolean()).isFalse();
        assertThat(indexer.counts(fx.projectId()).orElseThrow().deleted()).isEqualTo(before.deleted());

        mergeThreshold(5);
        JsonNode above = entry(run(), fx);
        assertThat(above.path("merged").asBoolean()).isTrue();
        assertThat(above.path("result").asText()).isEqualTo("OK");
        SearchIndexer.IndexCounts after = indexer.counts(fx.projectId()).orElseThrow();
        assertThat(after.deleted()).isZero();
        assertThat(after.documents()).isEqualTo(before.documents());
        assertThat(indexer.status(fx.projectId()).indexedRevision()).isEqualTo(head(fx));
        assertThat(fixtures.find(fx, "candidate")).hasSize(9);
    }

    @Test
    @DisplayName("archived projects are skipped; an unavailable index is reported, not failed")
    void archivedAndUnavailable() throws Exception {
        SearchFixtures.Fixture archived = fixtures.project("maintarch");
        projects.archive(archived.key(), RevisionContext.of(archived.projectId(), archived.user().getId(), null));
        SearchFixtures.Fixture locked = fixtures.project("maintlock");
        TemplateView template = fixtures.pageTemplate(locked, "Article");
        fixtures.page(locked, "Page", template.uuid(), "Intro", "<p>locked words</p>");
        sync(locked);
        index.close(locked.projectId());

        try (Directory other = FSDirectory.open(indexRoot.resolve(Long.toString(locked.projectId())));
                Lock held = other.obtainLock(IndexWriter.WRITE_LOCK_NAME)) {
            SystemJobRun run = run();
            assertThat(run.getOutcome()).isEqualTo(JobOutcome.PARTIAL);
            assertThat(run.getReport().path("projects").has(archived.key())).isFalse();
            assertThat(run.getReport().path("archivedSkipped").asLong()).isPositive();
            JsonNode entry = entry(run, locked);
            assertThat(entry.path("result").asText()).isEqualTo("UNAVAILABLE");
            assertThat(entry.path("code").asText()).isEqualTo("SF-SEARCH-0503");
            held.ensureValid();
        }
    }

    // ------------------------------------------------------------------

    private SystemJobRun run() {
        SystemJobRunner.Started started = runner.start(SearchMaintenanceJob.KEY, JobTrigger.MANUAL, false, null)
                .orElseThrow();
        started.done().orTimeout(120, TimeUnit.SECONDS).join();
        SystemJobRun run = runs.findById(started.run().getId()).orElseThrow();
        assertThat(run.getOutcome()).as("run message: %s", run.getMessage()).isIn(JobOutcome.SUCCEEDED, JobOutcome.PARTIAL);
        return run;
    }

    private static JsonNode entry(SystemJobRun run, SearchFixtures.Fixture fx) {
        JsonNode entry = run.getReport().path("projects").path(fx.key());
        assertThat(entry.isObject()).as("report entry of %s: %s", fx.key(), run.getReport()).isTrue();
        return entry;
    }

    private void sync(SearchFixtures.Fixture fx) throws InterruptedException {
        assertThat(indexer.syncAndAwait(fx.projectId(), Duration.ofSeconds(60))).isTrue();
    }

    private long head(SearchFixtures.Fixture fx) {
        return revisions.findHeadRevisionId(fx.projectId()).orElseThrow();
    }

    private void mergeThreshold(int pct) {
        SystemJobService.JobState state = jobs.get(SearchMaintenanceJob.KEY);
        jobs.update(SearchMaintenanceJob.KEY, state.row().getVersion(), new SystemJobService.Update(null, null, null,
                JsonNodeFactory.instance.objectNode().put("mergeDeletesPct", pct)), null);
    }
}
