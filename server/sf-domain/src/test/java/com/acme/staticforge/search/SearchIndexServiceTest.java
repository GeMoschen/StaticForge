package com.acme.staticforge.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.SfException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.stream.Stream;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.store.Lock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

/** {@link SearchIndexServiceImpl} without Spring (M23.1.1). */
class SearchIndexServiceTest {

    @TempDir
    Path root;

    private SearchIndexServiceImpl service;

    @AfterEach
    void tearDown() {
        if (service != null) {
            service.destroy();
        }
    }

    static SearchProperties properties(Path root, SearchProperties.DirectoryType type) {
        return new SearchProperties(root.toString(), type, Duration.ofMillis(100), 200_000, 5000, 500, 16, true);
    }

    static SearchDocument page(UUID uuid, String uid, String displayName, String text) {
        return new SearchDocument(
                uuid, AssetType.PAGE, uid, displayName, "/pages_root/", null, 1, displayName + " " + uid, text, "");
    }

    private SearchIndexServiceImpl memory() {
        service = new SearchIndexServiceImpl(properties(root, SearchProperties.DirectoryType.MEMORY));
        return service;
    }

    private SearchIndexServiceImpl filesystem() {
        service = new SearchIndexServiceImpl(properties(root, SearchProperties.DirectoryType.FILESYSTEM));
        return service;
    }

    private static long hits(SearchIndexService index, long projectId, String q) {
        return index.search(projectId, SearchQuery.of(q, 20)).totalHits();
    }

    @Test
    void upsertThenSearchFindsTheDocument() {
        SearchIndexServiceImpl index = memory();
        UUID uuid = UUID.randomUUID();
        index.upsert(1, page(uuid, "about", "About us", "We build lighthouses"));
        index.commit(1, 3, "owner");

        SearchHits hits = index.search(1, SearchQuery.of("lighthouses", 20));
        assertThat(hits.totalHits()).isEqualTo(1);
        assertThat(hits.hits().get(0).uuid()).isEqualTo(uuid);
        assertThat(hits.hits().get(0).type()).isEqualTo(AssetType.PAGE);
        assertThat(hits.hits().get(0).displayName()).isEqualTo("About us");
    }

    @Test
    void secondUpsertWithTheSameUuidReplacesTheDocument() {
        SearchIndexServiceImpl index = memory();
        UUID uuid = UUID.randomUUID();
        index.upsert(1, page(uuid, "about", "About", "first version apples"));
        index.upsert(1, page(uuid, "about", "About", "second version pears"));
        index.commit(1, 2, "owner");

        assertThat(hits(index, 1, "version")).isEqualTo(1);
        assertThat(hits(index, 1, "apples")).isZero();
        assertThat(hits(index, 1, "pears")).isEqualTo(1);
    }

    @Test
    void deleteRemovesTheDocument() {
        SearchIndexServiceImpl index = memory();
        UUID uuid = UUID.randomUUID();
        index.upsert(1, page(uuid, "about", "About", "harbour"));
        index.commit(1, 1, "owner");
        index.delete(1, uuid);
        index.commit(1, 2, "owner");

        assertThat(hits(index, 1, "harbour")).isZero();
    }

    @Test
    void projectIndexesAreIsolated() {
        SearchIndexServiceImpl index = memory();
        index.upsert(1, page(UUID.randomUUID(), "a", "A", "shared word zebra"));
        index.upsert(2, page(UUID.randomUUID(), "b", "B", "shared word zebra"));
        index.upsert(2, page(UUID.randomUUID(), "c", "C", "only in two giraffe"));
        index.commit(1, 1, "owner");
        index.commit(2, 1, "owner");

        assertThat(hits(index, 1, "zebra")).isEqualTo(1);
        assertThat(hits(index, 2, "zebra")).isEqualTo(1);
        assertThat(hits(index, 1, "giraffe")).isZero();
    }

    @Test
    void commitStampSurvivesReopen() {
        SearchIndexServiceImpl index = filesystem();
        assertThat(index.indexedRevision(7)).isEmpty();
        assertThat(index.check(7).condition()).isEqualTo(IndexCheck.Condition.MISSING);

        index.upsert(7, page(UUID.randomUUID(), "x", "X", "text"));
        index.commit(7, 42, "owner");
        index.close(7);
        assertThat(index.openProjects()).doesNotContain(7L);

        assertThat(index.indexedRevision(7)).hasValue(42);
        IndexCheck check = index.check(7);
        assertThat(check.current("owner")).isTrue();
        assertThat(check.current("another database")).isFalse();
        assertThat(check.schemaVersion()).hasValue(SearchSchemaVersion.CURRENT);
    }

    @Test
    void filesystemIndexSurvivesServiceRestart() {
        SearchIndexServiceImpl first = filesystem();
        UUID uuid = UUID.randomUUID();
        first.upsert(3, page(uuid, "persisted", "Persisted", "durable content"));
        first.commit(3, 9, "owner");
        first.destroy();

        SearchIndexServiceImpl second = filesystem();
        assertThat(second.indexedRevision(3)).hasValue(9);
        assertThat(second.search(3, SearchQuery.of("durable", 20)).hits())
                .extracting(SearchHit::uuid)
                .containsExactly(uuid);
    }

    @Test
    void uncommittedChangesAreDroppedOnCloseSoTheStampNeverRunsAhead() {
        SearchIndexServiceImpl index = filesystem();
        index.upsert(4, page(UUID.randomUUID(), "one", "One", "committed"));
        index.commit(4, 1, "owner");
        index.upsert(4, page(UUID.randomUUID(), "two", "Two", "pending"));
        index.close(4);

        assertThat(index.indexedRevision(4)).hasValue(1);
        assertThat(hits(index, 4, "pending")).isZero();
        assertThat(hits(index, 4, "committed")).isEqualTo(1);
    }

    @Test
    void rebuildReplacesTheIndexOnlyAtTheSwap() throws Exception {
        SearchIndexServiceImpl index = filesystem();
        index.upsert(5, page(UUID.randomUUID(), "old", "Old", "before rebuild"));
        index.commit(5, 1, "owner");

        try (SearchIndexService.Rebuild rebuild = index.startRebuild(5)) {
            rebuild.add(page(UUID.randomUUID(), "new", "New", "after rebuild"));
            assertThat(hits(index, 5, "before")).isEqualTo(1);
            assertThat(hits(index, 5, "after")).isZero();
            rebuild.swap(8, "owner");
        }

        assertThat(hits(index, 5, "before")).isZero();
        assertThat(hits(index, 5, "after")).isEqualTo(1);
        assertThat(index.indexedRevision(5)).hasValue(8);
        try (Stream<Path> children = Files.list(root)) {
            assertThat(children.map(p -> p.getFileName().toString())).containsExactly("5");
        }
    }

    @Test
    void abandonedRebuildLeavesNoDirectoryBehind() throws Exception {
        SearchIndexServiceImpl index = filesystem();
        try (SearchIndexService.Rebuild rebuild = index.startRebuild(6)) {
            rebuild.add(page(UUID.randomUUID(), "x", "X", "discarded"));
        }
        try (Stream<Path> children = Files.list(root)) {
            assertThat(children).isEmpty();
        }
    }

    @Test
    void leftoverRebuildDirectoriesAreRemovedOnStartup() throws Exception {
        Files.createDirectories(root.resolve("12.rebuild-123"));
        Files.createDirectories(root.resolve("12.old-456"));
        Files.createDirectories(root.resolve("12"));

        filesystem();

        try (Stream<Path> children = Files.list(root)) {
            assertThat(children.map(p -> p.getFileName().toString())).containsExactly("12");
        }
    }

    @Test
    void memoryRebuildSwapsToo() {
        SearchIndexServiceImpl index = memory();
        index.upsert(1, page(UUID.randomUUID(), "old", "Old", "stale"));
        index.commit(1, 1, "owner");
        try (SearchIndexService.Rebuild rebuild = index.startRebuild(1)) {
            rebuild.add(page(UUID.randomUUID(), "new", "New", "fresh"));
            rebuild.swap(2, "owner");
        }
        assertThat(hits(index, 1, "stale")).isZero();
        assertThat(hits(index, 1, "fresh")).isEqualTo(1);
        assertThat(index.indexedRevision(1)).hasValue(2);
    }

    @Test
    void lockedIndexMakesTheProjectUnavailableInsteadOfFailing() throws Exception {
        Path projectDir = Files.createDirectories(root.resolve("11"));
        try (Directory other = FSDirectory.open(projectDir);
                Lock held = other.obtainLock("write.lock")) {
            SearchIndexServiceImpl index = filesystem();

            assertThatThrownBy(() -> index.search(11, SearchQuery.of("anything", 20)))
                    .isInstanceOf(SfException.class)
                    .satisfies(e -> assertThat(((SfException) e).getStatus()).isEqualTo(503));
            assertThat(index.unavailableProjects()).containsExactly(11L);
            assertThat(index.check(11).condition()).isEqualTo(IndexCheck.Condition.UNAVAILABLE);
            // Other projects are unaffected.
            index.upsert(12, page(UUID.randomUUID(), "fine", "Fine", "works"));
            index.commit(12, 1, "owner");
            assertThat(hits(index, 12, "works")).isEqualTo(1);
            held.ensureValid();
        }
    }

    @Test
    void corruptIndexIsReportedUnreadable() throws Exception {
        Path projectDir = Files.createDirectories(root.resolve("13"));
        Files.writeString(projectDir.resolve("segments_1"), "not a lucene commit");

        assertThat(filesystem().check(13).condition()).isEqualTo(IndexCheck.Condition.UNREADABLE);
    }

    @Test
    void pathsEscapingTheRootAreRejected() {
        assertThatThrownBy(() -> SearchIndexServiceImpl.resolveUnder(root, "../outside"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SearchIndexServiceImpl.resolveUnder(root.resolve("sub"), "../sub2/1"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SearchIndexServiceImpl.resolveUnder(root, "."))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(SearchIndexServiceImpl.resolveUnder(root, "42"))
                .isEqualTo(root.toAbsolutePath().normalize().resolve("42"));
    }

    @Test
    void memoryDirectoryIsRejectedInProduction() {
        MockEnvironment prod = new MockEnvironment();
        prod.setActiveProfiles("prod");
        assertThatThrownBy(() -> new SearchIndexServiceImpl(properties(root, SearchProperties.DirectoryType.MEMORY), prod))
                .isInstanceOf(IllegalStateException.class);
    }
}
