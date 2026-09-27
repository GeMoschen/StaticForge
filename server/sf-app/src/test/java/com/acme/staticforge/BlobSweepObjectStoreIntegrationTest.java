package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.BlobWriter;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.blobs.BlobSweepJob;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The {@code blob-sweep} job (M29.2.3) against an object store: the S3 store is still a stub ({@code S3BlobStore}
 * throws "not implemented"), so this context selects a store the filesystem backend doesn't match
 * ({@code sf.media.store=object-double}) and provides an in-memory double with object-storage semantics (a flat key
 * listing with sizes and modification times, like {@code ListObjectsV2}). The sweep uses only the {@link BlobStore}
 * contract, so the same rows and orphan objects are collected as on the filesystem.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "sf.media.store=object-double")
@Import(BlobSweepObjectStoreIntegrationTest.ObjectStoreConfig.class)
class BlobSweepObjectStoreIntegrationTest {

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired MediaService mediaService;
    @Autowired BlobStore blobStore;
    @Autowired BlobRepository blobs;
    @Autowired BlobWriter blobWriter;
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository runs;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("object store: unreferenced rows and orphan objects past the grace period go, referenced blobs stay")
    void sweepsAnObjectStore() {
        assertThat(blobStore).isInstanceOf(InMemoryObjectStore.class);
        InMemoryObjectStore store = (InMemoryObjectStore) blobStore;
        AppUser user = userService.create("objsweep", "objsweep@example.com", "Sweep", "secret-password");
        Project project = projectService.create(new CreateProjectRequest("objsweep", "objsweep", null, "s"), user.getId());
        AssetVersionView kept = mediaService.upload(project.getId(), null, "kept.txt", null, bytes("kept"),
                RevisionContext.of(project.getId(), user.getId(), "sweep"));
        String keptSha = kept.payload().path("blobSha256").asText();
        String orphanRow = sha256(bytes("orphan row"));
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(s -> blobWriter.store(orphanRow, bytes("orphan row"), "text/plain"));
        String orphanObject = sha256(bytes("orphan object"));
        blobStore.put(orphanObject, bytes("orphan object"));
        Instant old = Instant.now().minus(Duration.ofHours(25));
        for (String sha : List.of(keptSha, orphanRow)) {
            OffsetDateTime at = OffsetDateTime.ofInstant(old, ZoneOffset.UTC);
            jdbc.update("UPDATE blob SET created_at = ?, last_referenced_at = ? WHERE sha256 = ?", at, at, sha);
        }
        store.touch(orphanObject, old);
        store.touch(keptSha, old);

        SystemJobRun dry = run(true);
        assertThat(dry.getReport().path("rowsDeleted").asLong()).isEqualTo(1);
        assertThat(dry.getReport().path("orphanObjectsDeleted").asLong()).isEqualTo(1);
        assertThat(store.exists(orphanObject)).isTrue();

        SystemJobRun real = run(false);
        assertThat(real.getReport().path("rowsDeleted").asLong()).isEqualTo(1);
        assertThat(real.getReport().path("orphanObjectsDeleted").asLong()).isEqualTo(1);
        assertThat(real.getBytesFreed()).isEqualTo(dry.getBytesFreed())
                .isEqualTo(bytes("orphan row").length + bytes("orphan object").length);
        assertThat(store.exists(orphanRow)).isFalse();
        assertThat(blobs.findById(orphanRow)).isEmpty();
        assertThat(store.exists(orphanObject)).isFalse();
        assertThat(store.exists(keptSha)).isTrue();
        assertThat(blobs.findById(keptSha)).isPresent();
    }

    private SystemJobRun run(boolean dryRun) {
        SystemJobRunner.Started started = runner.start(BlobSweepJob.KEY, JobTrigger.MANUAL, dryRun, null).orElseThrow();
        started.done().orTimeout(60, TimeUnit.SECONDS).join();
        SystemJobRun run = runs.findById(started.run().getId()).orElseThrow();
        assertThat(run.getOutcome()).as("run message: %s", run.getMessage()).isEqualTo(JobOutcome.SUCCEEDED);
        return run;
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @TestConfiguration
    static class ObjectStoreConfig {
        @Bean
        BlobStore objectStore() {
            return new InMemoryObjectStore();
        }
    }

    /** An object store in memory: flat keys under a prefix, with sizes and modification times. */
    static final class InMemoryObjectStore implements BlobStore {

        private record StoredBytes(byte[] bytes, Instant modified) {}

        private final Map<String, StoredBytes> objects = new ConcurrentHashMap<>();

        void touch(String sha, Instant modified) {
            objects.computeIfPresent(storageKey(sha), (k, v) -> new StoredBytes(v.bytes(), modified));
        }

        @Override
        public void put(String sha256, byte[] bytes) {
            objects.putIfAbsent(storageKey(sha256), new StoredBytes(bytes.clone(), Instant.now()));
        }

        @Override
        public byte[] get(String sha256) {
            StoredBytes stored = objects.get(storageKey(sha256));
            if (stored == null) {
                throw new IllegalStateException("No object " + sha256);
            }
            return stored.bytes().clone();
        }

        @Override
        public boolean exists(String sha256) {
            return objects.containsKey(storageKey(sha256));
        }

        @Override
        public void delete(String sha256) {
            objects.remove(storageKey(sha256));
        }

        @Override
        public String storageKey(String sha256) {
            return "media/" + sha256;
        }

        @Override
        public void forEachObject(Consumer<StoredObject> consumer) {
            Map.copyOf(objects).forEach((key, stored) -> consumer.accept(
                    new StoredObject(key.substring("media/".length()), stored.bytes().length, stored.modified())));
        }
    }
}
