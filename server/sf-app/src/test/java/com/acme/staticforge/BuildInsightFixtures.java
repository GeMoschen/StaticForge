package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Shared fixtures of the build insight tests (M22): a project with templates, pages, media and navigation built through
 * the services, generation runs awaited to a terminal state, and the published files of a target read back.
 */
final class BuildInsightFixtures {

    private static final AtomicInteger SEQ = new AtomicInteger();

    final ObjectMapper mapper = new ObjectMapper();

    private final UserService users;
    private final ProjectService projects;
    private final AssetService assets;
    private final AssetRepository assetRepository;
    private final TemplateService templates;
    private final MediaService media;
    private final PageReferenceService pageReferences;
    private final GenerationTargetRepository targets;
    private final GenerationService generation;
    private final ReleaseFixtures releases;
    private final Path outputRoot;

    BuildInsightFixtures(
            UserService users,
            ProjectService projects,
            AssetService assets,
            AssetRepository assetRepository,
            TemplateService templates,
            MediaService media,
            PageReferenceService pageReferences,
            GenerationTargetRepository targets,
            GenerationService generation,
            ReleaseFixtures releases,
            Path outputRoot) {
        this.users = users;
        this.projects = projects;
        this.assets = assets;
        this.assetRepository = assetRepository;
        this.templates = templates;
        this.media = media;
        this.pageReferences = pageReferences;
        this.targets = targets;
        this.generation = generation;
        this.releases = releases;
        this.outputRoot = outputRoot;
    }

    record Fixture(Project project, AppUser user, RevisionContext ctx) {

        long projectId() {
            return project.getId();
        }
    }

    Fixture project(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(
                prefix + "-user-" + n, prefix + "-user-" + n + "@example.com", prefix + " user " + n, "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix + "p" + n, prefix + " project " + n, null, "build insight test"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "build insight test"));
    }

    // ------------------------------------------------------------------
    // Assets
    // ------------------------------------------------------------------

    TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return templates.create(new CreateTemplateCommand(
                fx.projectId(), AssetType.PAGE_TEMPLATE, name, cdl, Map.of("html", html), null, false,
                Map.of("html", "{displayNameSlug}.{ext}")), fx.ctx());
    }

    TemplateView sectionTemplate(Fixture fx, String name, String cdl, String html) {
        return templates.create(new CreateTemplateCommand(
                fx.projectId(), AssetType.SECTION_TEMPLATE, name, cdl, Map.of("html", html), null, false, null), fx.ctx());
    }

    /** Saves a template's html channel source and output path pattern. */
    TemplateView updateTemplate(Fixture fx, UUID uuid, String html, String outputPath) {
        TemplateView now = templates.get(fx.projectId(), uuid);
        String cdl = now.payload().path("contentDefinition").asText("");
        Map<String, String> paths = outputPath == null ? Map.of() : Map.of("html", outputPath);
        return templates.update(uuid, new UpdateTemplateCommand(now.displayName(), cdl, Map.of("html", html), null, false,
                paths, false, Map.of()), now.validFromRevision(), fx.ctx());
    }

    /** A page on {@code template} whose payload {@code content} and {@code bodies} the customizer fills. */
    AssetVersionView page(Fixture fx, String name, UUID template, Consumer<ObjectNode> customizer) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", template.toString());
        payload.putObject("content");
        customizer.accept(payload);
        return assets.create(new CreateAssetCommand(fx.projectId(), AssetType.PAGE, name, null, payload, null), fx.ctx());
    }

    AssetVersionView page(Fixture fx, String name, UUID template) {
        return page(fx, name, template, payload -> {});
    }

    /** Adds section {@code section} to body {@code body} of a page payload. */
    ObjectNode section(ObjectNode payload, String body, UUID section) {
        ObjectNode instance = payload.withObject("bodies").withArray(body).addObject();
        instance.put("instanceId", UUID.randomUUID().toString());
        instance.put("templateRef", section.toString());
        return instance.putObject("content");
    }

    ObjectNode mediaRef(UUID mediaUuid) {
        return mapper.createObjectNode().put("type", "MEDIA_REF").put("uuid", mediaUuid.toString());
    }

    AssetVersionView media(Fixture fx, String name, String text) {
        return media.upload(fx.projectId(), null, name, null, text.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    AssetVersionView current(Fixture fx, UUID uuid) {
        return assets.requireCurrent(fx.projectId(), uuid);
    }

    /** Saves a new version of {@code uuid} with its payload changed by {@code change}. */
    AssetVersionView edit(Fixture fx, UUID uuid, Consumer<ObjectNode> change) {
        AssetVersionView now = current(fx, uuid);
        ObjectNode payload = now.payload().deepCopy();
        change.accept(payload);
        return assets.update(uuid, new UpdateAssetCommand(now.displayName(), payload), now.validFromRevision(), fx.ctx());
    }

    AssetVersionView rename(Fixture fx, UUID uuid, String displayName) {
        AssetVersionView now = current(fx, uuid);
        return assets.update(uuid, new UpdateAssetCommand(displayName, now.payload()), now.validFromRevision(), fx.ctx());
    }

    UUID navigationRoot(Fixture fx) {
        return assetRepository.findByProjectIdAndAssetTypeAndUid(fx.projectId(), AssetType.FOLDER, FolderScope.NAVIGATION_ROOT_UID)
                .map(Asset::getUuid)
                .orElseThrow();
    }

    AssetVersionView pageReference(Fixture fx, String name, UUID folder, UUID page) {
        return pageReferences.create(
                new CreatePageReferenceCommand(name, folder, PageReferenceTargetKind.PAGE, page, null), fx.ctx());
    }

    // ------------------------------------------------------------------
    // Generation
    // ------------------------------------------------------------------

    GenerationTarget target(Fixture fx, String name, TargetType type) {
        try {
            return targets.save(new GenerationTarget(
                    fx.projectId(), name, type, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), false));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    GenerationRun generate(Fixture fx, GenerationTarget target, GenerationMode mode) {
        return generate(fx, new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null));
    }

    /** Releases everything pending (M27.2.1) and runs {@code request} to its end. */
    GenerationRun generate(Fixture fx, GenerationRequest request) {
        releases.releaseAll(fx.projectId());
        GenerationRun started = generation.start(fx.project().getKey(), request, fx.user().getId());
        return await(fx, started.getId());
    }

    GenerationRun await(Fixture fx, long runId) {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generation.status(fx.project().getKey(), runId);
            if (run.getStatus().isTerminal()) {
                return run;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError(e);
            }
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    GenerationRun succeeded(GenerationRun run) {
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        return run;
    }

    Path targetDir(Fixture fx, GenerationTarget target) {
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), target);
    }

    /** Every published file of {@code run} on {@code target}, by path, as text. */
    Map<String, String> files(Fixture fx, GenerationTarget target, GenerationRun run) {
        Path root = targetDir(fx, target);
        Map<String, String> files = new TreeMap<>();
        try {
            switch (target.getType()) {
                case FILESYSTEM -> readTree(root.resolve("builds").resolve(String.valueOf(run.getId())), files);
                case S3 -> readTree(root.resolve(String.valueOf(run.getId())), files);
                case ZIP -> {
                    try (ZipFile zip = new ZipFile(root.resolve("builds").resolve(run.getId() + ".zip").toFile())) {
                        for (ZipEntry entry : Collections.list(zip.entries())) {
                            try (InputStream in = zip.getInputStream(entry)) {
                                files.put(entry.getName(), new String(in.readAllBytes(), StandardCharsets.UTF_8));
                            }
                        }
                    }
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return files;
    }

    private static void readTree(Path dir, Map<String, String> files) throws IOException {
        assertThat(dir).isDirectory();
        try (var stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readString(file));
            }
        }
    }

    JsonNode json(String text) {
        try {
            return mapper.readTree(text);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
