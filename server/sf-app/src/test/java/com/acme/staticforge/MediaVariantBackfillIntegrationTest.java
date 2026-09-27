package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaProperties;
import com.acme.staticforge.asset.media.MediaProperties.VariantDefinition;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.media.MediaVariantResolver;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.variants.MediaVariantBackfillJob;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Derived media variants (M29.3.2): the {@code media-variant-backfill} job creates variants of a changed policy in
 * {@code media_variant} only — no revision, the release status unchanged — and every reader sees them through
 * {@link MediaVariantResolver}: binary serving (preview), generation ({@code $CMS_REF(…, variant=…)} and the ASSETS
 * stage), export and a re-import. Failures are reported and retried, unsupported formats reported once, and
 * per-locale files get their own variants.
 */
@SpringBootTest
@ActiveProfiles("test")
class MediaVariantBackfillIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final AtomicInteger PIXEL = new AtomicInteger();
    private static final VariantDefinition SMALL = new VariantDefinition("small", 4, "jpeg", 80);
    private static final VariantDefinition LARGE = new VariantDefinition("large", 6, "png", null);

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-variants");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired MediaProperties mediaProperties;
    @Autowired BlobStore blobStore;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ReleaseStatusService statuses;
    @Autowired RevisionRepository revisions;
    @Autowired ProjectExportImportService exportImport;
    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository runs;
    @Autowired JdbcTemplate jdbc;

    private final ObjectMapper mapper = new ObjectMapper();
    private List<VariantDefinition> policyBefore;

    @BeforeEach
    void rememberPolicy() {
        policyBefore = new ArrayList<>(mediaProperties.getVariants());
    }

    @AfterEach
    void restorePolicy() {
        mediaProperties.setVariants(policyBefore);
    }

    @Test
    @DisplayName("a policy change: the backfill adds the variant without a revision; preview, generation, export use it")
    void backfillAfterPolicyChange() throws Exception {
        Fixture fx = newFixture(false);
        mediaProperties.setVariants(new ArrayList<>(List.of(SMALL)));
        AssetVersionView hero = mediaService.upload(fx.id(), null, "hero.png", null, png(Color.RED, 8), fx.ctx());
        String sha = hero.payload().path("blobSha256").asText();
        assertThat(names(hero.payload().path("variants"))).containsExactly("small");
        assertThat(rows(sha)).as("an upload records its variants").containsExactly("small");
        page(fx, "home", "<img src=\"$CMS_REF(media:" + hero.uid() + ", variant=\"large\")$\">");
        releaseFixtures.releaseAll(fx.id());
        long headBefore = head(fx);

        mediaProperties.setVariants(new ArrayList<>(List.of(SMALL, LARGE)));
        SystemJobRun run = run();
        assertThat(run.getOutcome()).isIn(JobOutcome.SUCCEEDED, JobOutcome.PARTIAL);
        assertThat(rows(sha)).containsExactlyInAnyOrder("small", "large");
        assertThat(run.getReport().path("sample").toString()).contains(sha);

        // No revision, no draft: the media stays PUBLISHED and its stored payload is unchanged.
        assertThat(head(fx)).isEqualTo(headBefore);
        assertThat(statuses.ofAsset(fx.id(), hero.uuid()).get(ReleaseLocales.ALL).status()).isEqualTo(ReleaseStatus.PUBLISHED);
        assertThat(names(mediaService.require(fx.id(), hero.uuid()).payload().path("variants"))).containsExactly("small");

        // Binary serving (what preview links) finds the derived variant.
        MediaBinary large = mediaService.binary(fx.id(), hero.uuid(), "large");
        assertThat(large.mimeType()).isEqualTo("image/png");
        assertThat(ImageIO.read(new ByteArrayInputStream(large.bytes())).getWidth()).isEqualTo(6);

        // Generation references and copies it.
        Map<String, byte[]> files = generate(fx);
        String variantFile = "assets/media/" + hero.uid() + "-large.png";
        assertThat(files).containsKey(variantFile);
        assertThat(new String(files.get("home.html"), StandardCharsets.UTF_8)).isEqualTo("<img src=\"" + variantFile + "\">");

        // Export writes the merged list (and the variant's blob); an import stores it in the payload.
        byte[] archive = exportImport.exportProject(fx.id());
        Map<String, byte[]> entries = unzip(archive);
        JsonNode exported = mapper.readTree(entries.get("assets/" + hero.uuid() + ".json"));
        assertThat(names(exported.path("payload").path("variants"))).containsExactly("small", "large");
        String largeSha = exported.path("payload").path("variants").get(1).path("blobSha256").asText();
        assertThat(entries).containsKey("blobs/" + largeSha);
        Fixture target = newFixture(false);
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);
        JsonNode imported = payloadOfUid(target, hero.uid());
        assertThat(names(imported.path("variants"))).containsExactly("small", "large");

        // A second run finds nothing more to do for this file.
        SystemJobRun again = run();
        assertThat(again.getReport().path("sample").toString()).doesNotContain(sha);
        assertThat(rows(sha)).hasSize(2);
    }

    @Test
    @DisplayName("an encode failure is reported and retried next run; an unsupported format is reported once")
    void failureIsRetried() throws Exception {
        Fixture fx = newFixture(false);
        mediaProperties.setVariants(new ArrayList<>());
        AssetVersionView shot = mediaService.upload(fx.id(), null, "shot.png", null, png(Color.GREEN, 8), fx.ctx());
        String sha = shot.payload().path("blobSha256").asText();
        byte[] original = blobStore.get(sha);
        blobStore.delete(sha);
        blobStore.put(sha, "not an image".getBytes(StandardCharsets.UTF_8));
        try {
            mediaProperties.setVariants(new ArrayList<>(List.of(SMALL, new VariantDefinition("modern", 4, "webp", 80))));
            SystemJobRun failed = run();
            assertThat(failed.getOutcome()).isEqualTo(JobOutcome.PARTIAL);
            assertThat(rows(sha)).isEmpty();
            assertThat(failed.getReport().path("failures").toString())
                    .contains("\"mimeType\":\"image/png\"")
                    .contains("small:4:jpeg:80")
                    .contains("source could not be decoded");
            JsonNode unsupported = failed.getReport().path("unsupported");
            assertThat(unsupported).hasSize(1);
            assertThat(unsupported.get(0).asText()).isEqualTo("modern:4:webp (unsupported format)");
        } finally {
            blobStore.delete(sha);
            blobStore.put(sha, original);
        }

        run();
        assertThat(rows(sha)).containsExactly("small");
    }

    @Test
    @DisplayName("per-locale files of localized media get their own variants")
    void localizedFiles() throws Exception {
        Fixture fx = newFixture(true);
        mediaProperties.setVariants(new ArrayList<>());
        AssetVersionView image = mediaService.upload(fx.id(), null, "hero.png", null, png(Color.RED, 8), fx.ctx());
        image = mediaService.setLocalized(image.uuid(), true, false, image.validFromRevision(), fx.ctx());
        JsonNode payload = mediaService
                .putLocaleFile(image.uuid(), "en", "hero-en.png", null, png(Color.BLUE, 8), fx.ctx())
                .media()
                .payload();
        String deSha = payload.path("blobSha256").asText();
        String enSha = payload.path("localeFiles").path("en").path("blobSha256").asText();
        assertThat(enSha).isNotEqualTo(deSha);

        mediaProperties.setVariants(new ArrayList<>(List.of(SMALL)));
        run();
        assertThat(rows(deSha)).containsExactly("small");
        assertThat(rows(enSha)).containsExactly("small");
        // Each locale serves the variant of its own file.
        byte[] deSmall = mediaService.binary(fx.id(), image.uuid(), "small", null, "de").bytes();
        byte[] enSmall = mediaService.binary(fx.id(), image.uuid(), "small", null, "en").bytes();
        assertThat(enSmall).isNotEmpty().isNotEqualTo(deSmall);
    }

    // ------------------------------------------------------------------

    private SystemJobRun run() {
        SystemJobRunner.Started started = runner.start(MediaVariantBackfillJob.KEY, JobTrigger.MANUAL, false, null)
                .orElseThrow();
        started.done().orTimeout(120, TimeUnit.SECONDS).join();
        return runs.findById(started.run().getId()).orElseThrow();
    }

    private List<String> rows(String sourceSha) {
        return jdbc.queryForList("SELECT name FROM media_variant WHERE source_sha = ? ORDER BY id", String.class, sourceSha);
    }

    private long head(Fixture fx) {
        return revisions.findHeadRevisionId(fx.id()).orElseThrow();
    }

    private JsonNode payloadOfUid(Fixture fx, String uid) {
        return mediaService.list(fx.id(), null, null, true, null, PageRequest.of(0, 50)).getContent().stream()
                .filter(media -> uid.equals(media.uid()))
                .findFirst()
                .orElseThrow()
                .payload();
    }

    private static List<String> names(JsonNode variants) {
        List<String> out = new ArrayList<>();
        if (variants != null) {
            variants.forEach(v -> out.add(v.path("name").asText()));
        }
        return out;
    }

    private void page(Fixture fx, String name, String html) {
        TemplateView template = templateService.create(
                new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, "T" + SEQ.incrementAndGet(), "",
                        Map.of("html", html), null, false, Map.of("html", "{folder}{uid}.{ext}")),
                fx.ctx());
        pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
    }

    private Map<String, byte[]> generate(Fixture fx) throws Exception {
        GenerationRun started = generationService.start(fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        GenerationRun run = started;
        while (!run.getStatus().isTerminal()) {
            assertThat(System.currentTimeMillis()).as("generation finished").isLessThan(deadline);
            Thread.sleep(50);
            run = generationService.status(fx.project().getKey(), started.getId());
        }
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
        Path dir = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, byte[]> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readAllBytes(file));
            }
        }
        return files;
    }

    private static Map<String, byte[]> unzip(byte[] archive) throws IOException {
        Map<String, byte[]> entries = new TreeMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries.put(entry.getName(), zip.readAllBytes());
            }
        }
        return entries;
    }

    private static byte[] png(Color color, int size) throws IOException {
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, size, size);
        g.dispose();
        // One unique pixel: blobs are content-addressed and shared, so every test image is its own source.
        image.setRGB(0, 0, PIXEL.incrementAndGet() & 0xFFFFFF ^ (int) (System.nanoTime() & 0xFFFF));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture(boolean localized) throws IOException {
        int n = SEQ.incrementAndGet();
        String key = "mvb" + n + "x" + (System.nanoTime() % 1_000_000);
        AppUser user = userService.create(key, key + "@example.com", "Variants", "secret-password");
        Project project = projectService.create(new CreateProjectRequest(key, key, null, "variants"), user.getId());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "variants");
        if (localized) {
            projectService.updateLocales(project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de",
                            Map.of(), true),
                    true, ctx);
        }
        return new Fixture(project, user, ctx, target);
    }

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {
        long id() {
            return project.getId();
        }
    }
}
