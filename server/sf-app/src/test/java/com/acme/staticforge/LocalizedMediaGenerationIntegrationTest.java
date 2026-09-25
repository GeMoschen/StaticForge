package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Localized media in generation and preview (M27.3.2): each locale that publishes its own file gets a copy under its
 * prefix, references resolve to the file the render locale renders (own, or the owner's it falls back to), media
 * releases per locale, incremental plans follow the locale, and preview share links serve the locale's file.
 *
 * <p>Locales: {@code de} (default, at the site root), {@code en} and {@code fr} (falls back to {@code de}). Text media
 * keeps the file contents readable.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LocalizedMediaGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-locmedia");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired PreviewTokenService previewTokenService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("Golden: own files are written under their locale's prefix; a fallback links the owner's file")
    void perLocaleOutputs() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN"), fx.ctx());
        AssetVersionView plain = mediaService.upload(fx.id(), null, "plain.txt", null, bytes("PLAIN"), fx.ctx());
        page(fx, "home", "<img src=\"$CMS_REF(media:" + shot.uid() + ")$\"><a href=\"$CMS_REF(media:" + plain.uid() + ")$\">");
        releaseFixtures.releaseAll(fx.id());

        GenerationRun run = generate(fx, GenerationMode.FULL);
        Map<String, String> files = files(fx, run);
        String file = "assets/media/" + shot.uid() + ".txt";
        String plainFile = "assets/media/" + plain.uid() + ".txt";
        assertThat(files).containsEntry(file, "DE").containsEntry("en/" + file, "EN").doesNotContainKey("fr/" + file);
        // Links are relative to the page: English links its own copy, French the German file it falls back to.
        assertThat(files.get("home.html")).isEqualTo("<img src=\"" + file + "\"><a href=\"" + plainFile + "\">");
        assertThat(files.get("en/home.html")).isEqualTo("<img src=\"" + file + "\"><a href=\"../" + plainFile + "\">");
        assertThat(files.get("fr/home.html")).isEqualTo("<img src=\"../" + file + "\"><a href=\"../" + plainFile + "\">");
        // Media that isn't localized is written once, as before.
        assertThat(files).containsEntry(plainFile, "PLAIN").doesNotContainKeys("en/" + plainFile, "fr/" + plainFile);

        JsonNode outputs = manifest(fx, run).path("outputs");
        assertThat(localeOf(outputs, "en/" + file)).isEqualTo("en");
        assertThat(localeOf(outputs, file)).isEqualTo("de");
        assertThat(localeOf(outputs, plainFile)).isNull();
    }

    @Test
    @DisplayName("Image variants follow their locale's file and prefix")
    void variantsFollowTheFile() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView image = localize(fx, mediaService.upload(fx.id(), null, "hero.png", null, png(java.awt.Color.RED), fx.ctx()));
        JsonNode english = mediaService
                .putLocaleFile(image.uuid(), "en", "hero-en.png", null, png(java.awt.Color.BLUE), fx.ctx())
                .media()
                .payload()
                .at("/localeFiles/en/variants/0");
        String variant = english.path("name").asText();
        page(fx, "home", "<img src=\"$CMS_REF(media:" + image.uid() + ", variant=\"" + variant + "\")$\">");
        releaseFixtures.releaseAll(fx.id());

        Map<String, byte[]> files = binaryFiles(fx, generate(fx, GenerationMode.FULL));
        String variantFile = "assets/media/" + image.uid() + "-" + variant + ".jpg";
        assertThat(files).containsKeys(variantFile, "en/" + variantFile);
        assertThat(files.get("en/" + variantFile)).isNotEqualTo(files.get(variantFile));
        assertThat(new String(files.get("en/home.html"), StandardCharsets.UTF_8)).isEqualTo("<img src=\"" + variantFile + "\">");
    }

    @Test
    @DisplayName("Released in German only: English pages render the reference empty with SF-GEN-0221")
    void unreleasedInOneLocale() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        UUID home = page(fx, "home", "<img src=\"$CMS_REF(media:" + shot.uid() + ")$\">");
        release(fx, ReleaseItem.of(home), ReleaseItem.of(shot.uuid(), "de"));

        GenerationRun run = generate(fx, GenerationMode.FULL);
        Map<String, String> files = files(fx, run);
        assertThat(files.get("home.html")).isEqualTo("<img src=\"assets/media/" + shot.uid() + ".txt\">");
        assertThat(files.get("en/home.html")).isEqualTo("<img src=\"\">");
        assertThat(run.getDiagnostics().toString())
                .contains("'en/home.html' (en): reference to unreleased media '" + shot.uid() + "'")
                .doesNotContain("'home.html' (de)");
        assertThat(files).containsKey("assets/media/" + shot.uid() + ".txt").doesNotContainKey("en/assets/media/" + shot.uid() + ".txt");
    }

    @Test
    @DisplayName("A locale falling back to a file its owner doesn't publish writes its own copy")
    void fallbackWithoutThePublishedOwner() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        UUID home = page(fx, "home", "<img src=\"$CMS_REF(media:" + shot.uid() + ")$\">");
        release(fx, ReleaseItem.of(home), ReleaseItem.of(shot.uuid(), "fr"));

        Map<String, String> files = files(fx, generate(fx, GenerationMode.FULL));
        assertThat(files.get("fr/home.html")).isEqualTo("<img src=\"assets/media/" + shot.uid() + ".txt\">");
        assertThat(files).containsEntry("fr/assets/media/" + shot.uid() + ".txt", "DE")
                .doesNotContainKey("assets/media/" + shot.uid() + ".txt");
    }

    @Test
    @DisplayName("Incremental: releasing the English file plans only English pages; the German file also French ones")
    void incrementalPlansFollowTheLocale() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN"), fx.ctx());
        page(fx, "home", "<img src=\"$CMS_REF(media:" + shot.uid() + ")$\">");
        page(fx, "other", "<p>no media</p>");
        releaseFixtures.releaseAll(fx.id());
        generate(fx, GenerationMode.FULL);

        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN v2"), fx.ctx());
        assertThat(dryRun(fx)).as("a draft changes nothing online").isEmpty();
        release(fx, ReleaseItem.of(shot.uuid(), "en"));

        List<PlanEntryRecord> planned = dryRun(fx);
        assertThat(planned).extracting(PlanEntryRecord::outputPath).containsExactly("en/home.html");
        assertThat(planned.get(0).reason().rootKind()).isEqualTo(RebuildRootKind.ASSET_RELEASED);
        assertThat(planned.get(0).reason().rootUuid()).isEqualTo(shot.uuid());

        GenerationRun run = generate(fx, GenerationMode.INCREMENTAL);
        Map<String, String> files = files(fx, run);
        assertThat(files).containsEntry("en/assets/media/" + shot.uid() + ".txt", "EN v2")
                .containsEntry("assets/media/" + shot.uid() + ".txt", "DE");
        assertThat(files).containsKeys("home.html", "fr/home.html", "other.html", "en/other.html");

        // The German file is what French falls back to: releasing it replans German and French pages.
        mediaService.replace(shot.uuid(), "shot.txt", null, bytes("DE v2"), fx.ctx());
        release(fx, ReleaseItem.of(shot.uuid(), "de"));
        assertThat(dryRun(fx)).extracting(PlanEntryRecord::outputPath).containsExactlyInAnyOrder("home.html", "fr/home.html");
        Map<String, String> after = files(fx, generate(fx, GenerationMode.INCREMENTAL));
        assertThat(after).containsEntry("assets/media/" + shot.uid() + ".txt", "DE v2")
                .containsEntry("en/assets/media/" + shot.uid() + ".txt", "EN v2");
    }

    @Test
    @DisplayName("A processed stylesheet renders each locale's own source in that locale; plans list its outputs per locale")
    void processedMediaPerLocale() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView image = localizedText(fx, "bg.txt", "BG-DE");
        mediaService.putLocaleFile(image.uuid(), "en", "bg-en.txt", null, bytes("BG-EN"), fx.ctx());
        AssetVersionView draft = localizedText(fx, "site.css", "de{background:url($CMS_REF(media:" + image.uid() + ")$)}");
        AssetVersionView css = mediaService.setProcessCms(draft.uuid(), true, "de", draft.validFromRevision(), fx.ctx()).media();
        mediaService.putLocaleFile(css.uuid(), "en", "site.css", null,
                bytes("en{background:url($CMS_REF(media:" + image.uid() + ")$)}"), fx.ctx());
        page(fx, "home", "<link href=\"$CMS_REF(media:" + css.uid() + ")$\">");
        releaseFixtures.releaseAll(fx.id());

        Map<String, String> files = files(fx, generate(fx, GenerationMode.FULL));
        String cssFile = "assets/media/" + css.uid() + ".css";
        String imageFile = image.uid() + ".txt";
        assertThat(files).containsEntry(cssFile, "de{background:url(" + imageFile + ")}")
                .containsEntry("en/" + cssFile, "en{background:url(" + imageFile + ")}")
                .containsEntry("en/assets/media/" + imageFile, "BG-EN")
                .doesNotContainKey("fr/" + cssFile);
        assertThat(files.get("fr/home.html")).isEqualTo("<link href=\"../" + cssFile + "\">");

        mediaService.putLocaleFile(image.uuid(), "en", "bg-en.txt", null, bytes("BG-EN v2"), fx.ctx());
        release(fx, ReleaseItem.of(image.uuid(), "en"));
        assertThat(dryRun(fx))
                .filteredOn(entry -> entry.assetUuid().equals(css.uuid()))
                .extracting(PlanEntryRecord::outputPath, PlanEntryRecord::locale)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(cssFile, "de"),
                        org.assertj.core.groups.Tuple.tuple("en/" + cssFile, "en"));
        Map<String, String> after = files(fx, generate(fx, GenerationMode.INCREMENTAL));
        assertThat(after).containsEntry("en/assets/media/" + imageFile, "BG-EN v2")
                .containsEntry("en/" + cssFile, "en{background:url(" + imageFile + ")}")
                .containsEntry(cssFile, "de{background:url(" + imageFile + ")}");
    }

    @Test
    @DisplayName("A page on a locale media file's path is an output collision (SF-GEN-0110)")
    void pageOnAMediaPathCollides() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN"), fx.ctx());
        TemplateView squatter = template(fx, "Squatter", "x", "{locale}/assets/media/" + shot.uid() + ".txt");
        pageService.create(new CreatePageCommand("squat", null, squatter.uuid()), fx.ctx());
        page(fx, "home", "<img src=\"$CMS_REF(media:" + shot.uid() + ")$\">");
        releaseFixtures.releaseAll(fx.id());

        GenerationRun run = start(fx, GenerationMode.FULL);
        assertThat(run.getStatus()).isEqualTo(RunStatus.FAILED);
        assertThat(run.getDiagnostics().toString())
                .contains("SF-GEN-0110")
                .contains("en/assets/media/" + shot.uid() + ".txt");
    }

    @Test
    @DisplayName("Preview share links serve the locale's file, drafts or released")
    void previewServesTheLocaleFile() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView shot = localizedText(fx, "shot.txt", "DE");
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN"), fx.ctx());
        releaseFixtures.releaseAll(fx.id());
        mediaService.putLocaleFile(shot.uuid(), "en", "shot-en.txt", null, bytes("EN draft"), fx.ctx());

        assertThat(share(fx, shot, "en", ContentView.Kind.DRAFT)).isEqualTo("EN draft");
        assertThat(share(fx, shot, "en", ContentView.Kind.PUBLISHED)).isEqualTo("EN");
        assertThat(share(fx, shot, "fr", ContentView.Kind.DRAFT)).isEqualTo("DE");
        assertThat(share(fx, shot, "de", ContentView.Kind.PUBLISHED)).isEqualTo("DE");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String share(Fixture fx, AssetVersionView media, String locale, ContentView.Kind view) throws Exception {
        String token = previewTokenService.issueMediaShareToken(media.uuid(), null, fx.project().getKey(), locale, view);
        return mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/media/" + media.uuid() + "/share")
                        .param("t", token))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
    }

    private AssetVersionView localizedText(Fixture fx, String name, String text) {
        return localize(fx, mediaService.upload(fx.id(), null, name, null, bytes(text), fx.ctx()));
    }

    private AssetVersionView localize(Fixture fx, AssetVersionView media) {
        return mediaService.setLocalized(media.uuid(), true, false, media.validFromRevision(), fx.ctx());
    }

    private UUID page(Fixture fx, String name, String html) {
        TemplateView template = template(fx, "T" + SEQ.incrementAndGet(), html, "{locale}/{folder}{uid}.{ext}");
        return pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid();
    }

    private TemplateView template(Fixture fx, String name, String html, String outputPath) {
        return templateService.create(
                new CreateTemplateCommand(fx.id(), AssetType.PAGE_TEMPLATE, name, "", Map.of("html", html), null, false,
                        Map.of("html", outputPath)),
                fx.ctx());
    }

    private void release(Fixture fx, ReleaseItem... items) {
        releaseService.release(Arrays.asList(items), RevisionContext.of(fx.id(), null, "test release"));
    }

    private List<PlanEntryRecord> dryRun(Fixture fx) {
        return generationService.dryRun(fx.project().getKey(), request(fx, GenerationMode.INCREMENTAL), false).entries();
    }

    private GenerationRequest request(Fixture fx, GenerationMode mode) {
        return new GenerationRequest(mode, null, List.of("html"), fx.target().getId(), null, null, null, null);
    }

    private GenerationRun generate(Fixture fx, GenerationMode mode) throws InterruptedException {
        GenerationRun run = start(fx, mode);
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
        return run;
    }

    private GenerationRun start(Fixture fx, GenerationMode mode) throws InterruptedException {
        GenerationRun started = generationService.start(fx.project().getKey(), request(fx, mode), fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), started.getId());
            if (run.getStatus().isTerminal()) {
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private Path buildDir(Fixture fx, GenerationRun run) {
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target()).resolve("builds");
    }

    private Map<String, String> files(Fixture fx, GenerationRun run) throws IOException {
        Map<String, String> files = new TreeMap<>();
        binaryFiles(fx, run).forEach((path, bytes) -> files.put(path, new String(bytes, StandardCharsets.UTF_8)));
        return files;
    }

    private Map<String, byte[]> binaryFiles(Fixture fx, GenerationRun run) throws IOException {
        Path dir = buildDir(fx, run).resolve(String.valueOf(run.getId()));
        Map<String, byte[]> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readAllBytes(file));
            }
        }
        return files;
    }

    private JsonNode manifest(Fixture fx, GenerationRun run) throws IOException {
        return mapper.readTree(buildDir(fx, run).resolve(run.getId() + ".manifest.json").toFile());
    }

    private static String localeOf(JsonNode outputs, String path) {
        for (JsonNode output : outputs) {
            if (path.equals(output.path("path").asText())) {
                return output.path("locale").asText(null);
            }
        }
        throw new AssertionError("No output " + path);
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] png(java.awt.Color color) throws IOException {
        java.awt.image.BufferedImage image = new java.awt.image.BufferedImage(8, 8, java.awt.image.BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, 8, 8);
        g.dispose();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private Fixture newFixture() throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("locgen" + n, "locgen" + n + "@example.com", "Localized", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("locgen" + n, "locgen" + n, null, "localized media"), user.getId());
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "localized media");
        projectService.updateLocales(
                project.getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"), new ProjectLocale("fr", "Français")),
                        "de",
                        Map.of("fr", List.of("de")),
                        true),
                true,
                ctx);
        return new Fixture(project, user, ctx, target);
    }

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {
        long id() {
            return project.getId();
        }
    }
}
