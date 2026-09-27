package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.BlobWriter;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.media.MediaVariantRepository;
import com.acme.staticforge.asset.media.MediaVariantSpec;
import com.acme.staticforge.health.BlobStoreHealthIndicator;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.blobs.BlobSweepJob;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The {@code blob-sweep} job (M29.2.3) on the filesystem store: what the mark keeps (old versions, variants, per-locale
 * files, {@code media_variant}), what the sweep deletes (unreferenced rows and orphan bytes past the grace period),
 * dry run, {@code ref_count}, and the row-lock interplay with a concurrent write of the same bytes.
 *
 * <p>This context has its own media root: the sweep lists the whole store, and other contexts' (other databases')
 * bytes in the shared test root must not look like orphans to it.
 */
@SpringBootTest
@ActiveProfiles("test")
class BlobSweepIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static Path mediaRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        mediaRoot = Files.createTempDirectory("sf-sweep-media");
        registry.add("sf.media.root", mediaRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired MediaService mediaService;
    @Autowired BlobStore blobStore;
    @Autowired BlobRepository blobs;
    @Autowired BlobWriter blobWriter;
    @Autowired MediaVariantRepository variantRows;
    @Autowired BlobSweepJob sweep;
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository runs;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired BlobStoreHealthIndicator health;

    @AfterEach
    void clearHooks() {
        sweep.setHooks(null);
    }

    @Test
    @DisplayName("keeps a blob of an old version and an in-flight one; deletes an unreferenced one (row and bytes); dry run first")
    void markAndSweep() throws Exception {
        Fixture fx = newFixture(false);
        AssetVersionView text = mediaService.upload(fx.id(), null, "a.txt", null, bytes("one " + unique()), fx.ctx());
        String oldSha = sha(text.payload());
        mediaService.writeText(text.uuid(), "two " + unique(), text.validFromRevision(), fx.ctx());
        age(oldSha);
        String orphan = storeWithoutVersion(bytes("orphan " + unique()));
        age(orphan);
        String inFlight = storeWithoutVersion(bytes("in flight " + unique()));

        SystemJobRun dry = run(true);
        assertThat(dry.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(sampled(dry)).contains(orphan).doesNotContain(oldSha, inFlight);
        assertThat(blobs.findById(orphan)).isPresent();
        assertThat(blobStore.exists(orphan)).isTrue();

        SystemJobRun real = run(false);
        assertThat(real.getItemsAffected()).isEqualTo(dry.getItemsAffected());
        assertThat(real.getBytesFreed()).isEqualTo(dry.getBytesFreed()).isPositive();
        assertThat(real.getReport().path("rowsDeleted").asLong()).isEqualTo(dry.getReport().path("rowsDeleted").asLong());
        assertThat(sampled(real)).contains(orphan);
        assertThat(blobs.findById(orphan)).isEmpty();
        assertThat(blobStore.exists(orphan)).isFalse();
        assertThat(blobs.findById(oldSha)).isPresent();
        assertThat(blobStore.exists(oldSha)).isTrue();
        assertThat(blobs.findById(inFlight)).isPresent();
        assertThat(blobStore.exists(inFlight)).isTrue();
        assertThat(mediaService.readText(fx.id(), text.uuid(), text.validFromRevision()).text()).startsWith("one ");

        // The health indicator names the last sweep.
        assertThat(health.health().getDetails().get("lastSweep"))
                .isEqualTo(Map.of("outcome", "SUCCEEDED", "finishedAt", real.getFinishedAt().toString(), "dryRun", false));
    }

    @Test
    @DisplayName("orphan bytes of a rolled-back upload are deleted after the grace period, young ones kept")
    void orphanBytes() throws Exception {
        byte[] content = bytes("rolled back " + unique());
        String sha = sha256(content);
        rolledBackWrite(sha, content);
        assertThat(blobs.findById(sha)).isEmpty();
        assertThat(blobStore.exists(sha)).as("bytes are written before the commit").isTrue();
        byte[] young = bytes("young orphan " + unique());
        rolledBackWrite(sha256(young), young);

        run(false);
        assertThat(blobStore.exists(sha)).as("within the grace period").isTrue();

        ageObject(sha);
        SystemJobRun dry = run(true);
        assertThat(dry.getReport().path("orphanObjectsDeleted").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(blobStore.exists(sha)).isTrue();
        SystemJobRun real = run(false);
        assertThat(real.getReport().path("orphanObjectsDeleted").asLong())
                .isEqualTo(dry.getReport().path("orphanObjectsDeleted").asLong());
        assertThat(sampled(real)).contains(sha);
        assertThat(blobStore.exists(sha)).isFalse();
        assertThat(blobStore.exists(sha256(young))).isTrue();
        assertThat(blobs.findById(sha)).as("the claim's placeholder row is gone").isEmpty();
    }

    @Test
    @DisplayName("variants, per-locale files and media_variant blobs are marked; ref_count is recomputed")
    void marksEveryReference() throws Exception {
        Fixture fx = newFixture(true);
        AssetVersionView image = mediaService.upload(fx.id(), null, "hero.png", null, png(), fx.ctx());
        String source = sha(image.payload());
        String variant = image.payload().path("variants").get(0).path("blobSha256").asText();
        image = mediaService.setLocalized(image.uuid(), true, false, image.validFromRevision(), fx.ctx());
        JsonNode payload = mediaService.putLocaleFile(image.uuid(), "en", "hero-en.png", null, png(), fx.ctx())
                .media()
                .payload();
        String english = payload.path("localeFiles").path("en").path("blobSha256").asText();
        String englishVariant = payload.path("localeFiles").path("en").path("variants").get(0).path("blobSha256").asText();
        String derived = storeWithoutVersion(bytes("derived variant " + unique()));
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> variantRows.insertIfAbsent(
                source, new MediaVariantSpec("extra", 3, "png", 0), derived, Instant.now()));
        for (String sha : List.of(source, variant, english, englishVariant, derived)) {
            age(sha);
        }
        jdbc.update("UPDATE blob SET ref_count = 99 WHERE sha256 = ?", source);

        SystemJobRun real = run(false);
        assertThat(real.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        for (String sha : List.of(source, variant, english, englishVariant, derived)) {
            assertThat(blobs.findById(sha)).as(sha).isPresent();
            assertThat(blobStore.exists(sha)).as(sha).isTrue();
        }
        // The source is referenced by the three versions (upload, localize, English file); its variant rows mark it only.
        assertThat(blobs.findById(source).orElseThrow().getRefCount()).isEqualTo(3);
        assertThat(blobs.findById(derived).orElseThrow().getRefCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("an upload of the same bytes after the mark keeps the blob (last_referenced_at)")
    void reuploadAfterMark() throws Exception {
        Fixture fx = newFixture(false);
        byte[] content = bytes("reused " + unique());
        String sha = storeWithoutVersion(content);
        age(sha);
        AtomicReference<AssetVersionView> uploaded = new AtomicReference<>();
        sweep.setHooks(new BlobSweepJob.Hooks() {
            @Override
            public void afterMark() {
                uploaded.set(mediaService.upload(fx.id(), null, "reused.txt", null, content, fx.ctx()));
            }
        });

        SystemJobRun real = run(false);
        assertThat(sampled(real)).doesNotContain(sha);
        assertThat(blobs.findById(sha)).isPresent();
        assertThat(blobStore.exists(sha)).isTrue();
        assertThat(mediaService.readText(fx.id(), uploaded.get().uuid(), null).text()).isEqualTo(new String(content,
                StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("an upload of the same bytes waiting on the sweep's row lock stores them again")
    void uploadWaitingOnTheRowLock() throws Exception {
        Fixture fx = newFixture(false);
        byte[] content = bytes("contended " + unique());
        String sha = storeWithoutVersion(content);
        age(sha);
        AtomicReference<CompletableFuture<AssetVersionView>> upload = new AtomicReference<>();
        sweep.setHooks(new BlobSweepJob.Hooks() {
            @Override
            public void beforeDelete(String sha256) {
                if (sha256.equals(sha)) {
                    upload.set(CompletableFuture.supplyAsync(
                            () -> mediaService.upload(fx.id(), null, "contended.txt", null, content, fx.ctx())));
                    pause(500); // the upload now waits for this transaction's row lock
                    assertThat(upload.get()).as("the upload waits for the lock").isNotDone();
                }
            }
        });

        SystemJobRun real = run(false);
        assertThat(sampled(real)).contains(sha);
        AssetVersionView media = upload.get().get(30, TimeUnit.SECONDS);
        assertThat(blobs.findById(sha)).isPresent();
        assertThat(blobStore.exists(sha)).isTrue();
        assertThat(mediaService.readText(fx.id(), media.uuid(), null).text()).isEqualTo(new String(content,
                StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("an upload of orphan bytes being claimed waits for the claim and stores them again")
    void uploadWaitingOnTheOrphanClaim() throws Exception {
        Fixture fx = newFixture(false);
        byte[] content = bytes("claimed " + unique());
        String sha = sha256(content);
        rolledBackWrite(sha, content);
        ageObject(sha);
        AtomicReference<CompletableFuture<AssetVersionView>> upload = new AtomicReference<>();
        sweep.setHooks(new BlobSweepJob.Hooks() {
            @Override
            public void beforeDelete(String sha256) {
                if (sha256.equals(sha)) {
                    upload.set(CompletableFuture.supplyAsync(
                            () -> mediaService.upload(fx.id(), null, "claimed.txt", null, content, fx.ctx())));
                    pause(500);
                    assertThat(upload.get()).as("the upload waits for the claim").isNotDone();
                }
            }
        });

        SystemJobRun real = run(false);
        assertThat(sampled(real)).contains(sha);
        AssetVersionView media = upload.get().get(30, TimeUnit.SECONDS);
        assertThat(blobs.findById(sha)).isPresent();
        assertThat(blobStore.exists(sha)).isTrue();
        assertThat(mediaService.readText(fx.id(), media.uuid(), null).text()).isEqualTo(new String(content,
                StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("only MEDIA payloads reference blobs: a new asset type must be checked against the sweep's mark")
    void assetTypesArePinned() {
        assertThat(AssetType.values())
                .as("A new asset type: if its payload can reference blobs, add it to BlobSweepJob's mark, then here.")
                .containsExactlyInAnyOrder(AssetType.PAGE, AssetType.MEDIA, AssetType.SECTION_TEMPLATE,
                        AssetType.PAGE_TEMPLATE, AssetType.FOLDER, AssetType.PAGE_REFERENCE, AssetType.GLOBAL_SET,
                        AssetType.DATASET, AssetType.RECORD, AssetType.RECORD_SET);
        Integer nonMedia = jdbc.queryForObject(
                "SELECT COUNT(*) FROM asset_version v JOIN asset a ON a.id = v.asset_id"
                        + " WHERE a.asset_type <> 'MEDIA' AND CAST(v.payload AS VARCHAR(1000000)) LIKE '%blobSha256%'",
                Integer.class);
        assertThat(nonMedia).as("non-media payloads with blob references").isZero();
    }

    // ------------------------------------------------------------------

    private SystemJobRun run(boolean dryRun) {
        SystemJobRunner.Started started = runner.start(BlobSweepJob.KEY, JobTrigger.MANUAL, dryRun, null).orElseThrow();
        started.done().orTimeout(120, TimeUnit.SECONDS).join();
        SystemJobRun run = runs.findById(started.run().getId()).orElseThrow();
        assertThat(run.getOutcome()).as("run message: %s", run.getMessage()).isEqualTo(JobOutcome.SUCCEEDED);
        return run;
    }

    private static List<String> sampled(SystemJobRun run) {
        List<String> out = new java.util.ArrayList<>();
        run.getReport().path("sample").forEach(item -> out.add(item.path("sha256").asText()));
        return out;
    }

    /** A committed blob row and bytes that no version references (e.g. an upload whose version never came). */
    private String storeWithoutVersion(byte[] content) {
        String sha = sha256(content);
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(status -> blobWriter.store(sha, content, "text/plain"));
        return sha;
    }

    /** Bytes written by a transaction that then rolled back: an object without a row. */
    private void rolledBackWrite(String sha, byte[] content) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            blobWriter.store(sha, content, "text/plain");
            status.setRollbackOnly();
        });
    }

    /** Moves a row's creation and last reference past the 24 h grace period. */
    private void age(String sha) {
        OffsetDateTime old = OffsetDateTime.ofInstant(Instant.now().minus(Duration.ofHours(25)), ZoneOffset.UTC);
        assertThat(jdbc.update("UPDATE blob SET created_at = ?, last_referenced_at = ? WHERE sha256 = ?", old, old, sha))
                .as("row of %s", sha)
                .isEqualTo(1);
    }

    private void ageObject(String sha) throws IOException {
        Path file = mediaRoot.resolve(sha.substring(0, 2)).resolve(sha.substring(2, 4)).resolve(sha);
        Files.setLastModifiedTime(file, FileTime.from(Instant.now().minus(Duration.ofHours(25))));
    }

    private static String sha(JsonNode payload) {
        return payload.path("blobSha256").asText();
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String unique() {
        return SEQ.incrementAndGet() + "-" + System.nanoTime();
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

    private static byte[] png() throws IOException {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new Color((int) (System.nanoTime() & 0xFFFFFF)));
        g.fillRect(0, 0, 8, 8);
        g.dispose();
        image.setRGB(0, 0, SEQ.incrementAndGet());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture(boolean localized) {
        String key = "sweep" + SEQ.incrementAndGet() + "x" + (System.nanoTime() % 1_000_000);
        AppUser user = userService.create(key, key + "@example.com", "Sweep", "secret-password");
        Project project = projectService.create(new CreateProjectRequest(key, key, null, "sweep"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "sweep");
        if (localized) {
            projectService.updateLocales(project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de",
                            Map.of(), true),
                    true, ctx);
        }
        return new Fixture(project, ctx);
    }

    private record Fixture(Project project, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }
}
