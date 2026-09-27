package com.acme.staticforge;

import static com.acme.staticforge.QualityBuildFixtures.document;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunProbe;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.quality.QualityCodes;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.QualitySidecar;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.common.L10nValues;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The {@code CHECK} stage in real builds (M30.1.3) with the test rules ({@link QualityTestRules}): findings stored with
 * their output and selector, the hold-back of an {@code ERROR}, warnings that leave a run {@code SUCCESS}, checks that
 * never change bytes, reference events, carried facts in incremental runs and the two new fallback causes.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(QualityTestRules.class)
class QualityCheckStageIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-check");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;
    @Autowired RunLatches latches;

    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        BuildInsightFixtures build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository,
                templateService, mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures,
                outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    /** A project that runs only the test rules: the production rules have their own tests. */
    private Fixture project(String prefix) {
        Fixture fx = q.project(prefix);
        q.only(fx, List.of(QualityTestRules.FLAG, QualityTestRules.MISSING, QualityTestRules.TO_HELD_BACK,
                QualityTestRules.EVENTS, QualityCodes.OUTPUT_NOT_CHECKED));
        return fx;
    }

    /** Home links a flagged page, a page that doesn't exist and a clean one. */
    private record Site(Fixture fx, AssetVersionView home, AssetVersionView flagged, AssetVersionView clean) {}

    private Site site(String prefix) {
        Fixture fx = project(prefix);
        AssetVersionView home = q.htmlPage(fx, "Home", document("Home",
                "<nav><a href=\"flagged.html\">flagged</a> <a href=\"gone.html\">gone</a> <a href=\"clean.html\">clean</a></nav>"));
        AssetVersionView flagged = q.htmlPage(fx, "Flagged", document("Flagged",
                "<main><p>fine</p><p data-sf-flag=\"bad\">bad</p></main>"));
        AssetVersionView clean = q.htmlPage(fx, "Clean", document("Clean", "<p>clean</p>"));
        return new Site(fx, home, flagged, clean);
    }

    @Test
    void anErrorHoldsThePageBackEverywhereAndTheRunIsPartial() {
        Site site = site("qcerr");
        Fixture fx = site.fx();
        q.configure(fx, Map.of(QualityTestRules.FLAG, QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        JsonNode errors = run.getDiagnostics().path("errors");
        assertThat(errors).singleElement().satisfies(error -> {
            assertThat(error.path("code").asText()).isEqualTo(QualityCodes.GEN_QUALITY_CHECK_FAILED);
            assertThat(error.path("messages").get(0).asText())
                    .isEqualTo("Quality check failed for page '" + site.flagged().uid() + "' (html): SF-CHK-0390");
        });
        assertThat(run.getWarningCount()).isZero();
        assertThat(run.getFindingErrors()).isEqualTo(1);
        assertThat(run.getFindingWarnings()).isEqualTo(2);

        Map<String, String> files = q.files(fx, target, run);
        assertThat(files).containsKeys("home.html", "clean.html").doesNotContainKey("flagged.html");
        assertThat(files.get("sitemap.xml")).contains("home.html").doesNotContain("flagged.html");
        assertThat(files.get("search-index.json")).contains("home.html").doesNotContain("flagged.html");
        BuildManifest manifest = q.manifest(fx, target, run).orElseThrow();
        assertThat(manifest.outputs()).extracting(BuildManifest.Output::path).doesNotContain("flagged.html");
        assertThat(q.sidecar(fx, target, run).orElseThrow().outputs()).containsOnlyKeys("home.html", "clean.html");

        assertThat(q.findings(fx, run))
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::severity, StoredFinding::selector,
                        StoredFinding::message, StoredFinding::carried)
                .containsExactly(
                        tuple("flagged.html", QualityTestRules.FLAG, QualitySeverity.ERROR, "body > main > p:nth-of-type(2)",
                                "Flagged: bad", false),
                        tuple("home.html", QualityTestRules.MISSING, QualitySeverity.WARNING,
                                "body > nav > a:nth-of-type(2)", "Missing: gone.html", false),
                        tuple("home.html", QualityTestRules.TO_HELD_BACK, QualitySeverity.WARNING,
                                "body > nav > a:nth-of-type(1)", "Held back: flagged.html", false));
        StoredFinding flagged = q.findings(fx, run, QualityTestRules.FLAG).get(0);
        assertThat(flagged.assetUuid()).isEqualTo(site.flagged().uuid());
        assertThat(flagged.channel()).isEqualTo("html");
        assertThat(flagged.uid()).isEqualTo(site.flagged().uid());
    }

    @Test
    void warningsAloneLeaveTheRunSuccessfulAndTheWarningCountUnchanged() {
        Site site = site("qcwarn");
        Fixture fx = site.fx();
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(run.getWarningCount()).isZero();
        assertThat(run.getErrorCount()).isZero();
        assertThat(run.getFindingWarnings()).isEqualTo(2);
        assertThat(run.getFindingCounts().path("links").asInt()).isEqualTo(1);
        assertThat(run.getFindingCounts().path("accessibility").asInt()).isEqualTo(1);
        assertThat(q.files(fx, target, run)).containsKeys("home.html", "flagged.html", "clean.html");
        assertThat(q.findings(fx, run)).extracting(StoredFinding::code)
                .containsExactly(QualityTestRules.FLAG, QualityTestRules.MISSING);
    }

    @Test
    void checksNeverChangeTheBytes() {
        Site site = site("qcbytes");
        Fixture fx = site.fx();
        GenerationTarget checked = q.target(fx, "checked");
        GenerationRun withChecks = q.generate(fx, checked, GenerationMode.FULL);
        q.allOff(fx);
        GenerationTarget unchecked = q.target(fx, "unchecked");

        GenerationRun withoutChecks = q.generate(fx, unchecked, GenerationMode.FULL);

        assertThat(q.findings(fx, withChecks)).isNotEmpty();
        assertThat(q.findings(fx, withoutChecks)).isEmpty();
        assertThat(q.files(fx, unchecked, withoutChecks)).isEqualTo(q.files(fx, checked, withChecks));
    }

    @Test
    void aLinkToAPageMissingFromTheSnapshotNoLongerFailsTheRun() {
        Fixture fx = project("qcmissing");
        UUID nowhere = UUID.randomUUID();
        TemplateView template = q.build.pageTemplate(fx, "Linking", "content { editor link cta }",
                "<!doctype html><html lang=\"en\"><head><title>Linking</title></head><body>"
                        + "<a href=\"$CMS_REF(cta)$\">go</a></body></html>");
        q.build.page(fx, "Linking", template.uuid(), payload -> payload.withObject("content").set("cta",
                q.build.mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", nowhere.toString())));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        assertThat(q.files(fx, target, run).get("linking.html")).contains("<a href=\"\">go</a>");
        assertThat(q.findings(fx, run, QualityTestRules.EVENTS))
                .extracting(StoredFinding::outputPath, StoredFinding::message)
                .containsExactly(tuple("linking.html", "MISSING page " + nowhere));
    }

    @Test
    void incrementalRunsCarryFactsAndFindingsAndFallBackWhenTheyCant() throws IOException {
        Site site = site("qcincr");
        Fixture fx = site.fx();
        GenerationTarget target = q.target(fx, "t");
        GenerationRun first = q.generate(fx, target, GenerationMode.FULL);
        assertThat(q.sidecar(fx, target, first)).isPresent();

        // Only the clean page changes: the flagged page and home are carried with their facts and findings.
        q.build.updateTemplate(fx, templateOf(fx, site.clean()), document("Clean", "<p>clean v2</p>"), "{displayNameSlug}.{ext}");
        GenerationRun second = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(second.getPlanSummary().path("incremental").asBoolean()).as("summary: %s", second.getPlanSummary())
                .isTrue();
        assertThat(q.findings(fx, second))
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::carried)
                .containsExactly(
                        tuple("flagged.html", QualityTestRules.FLAG, true),
                        tuple("home.html", QualityTestRules.MISSING, false));
        QualitySidecar sidecar = q.sidecar(fx, target, second).orElseThrow();
        assertThat(sidecar.outputs()).containsOnlyKeys("home.html", "flagged.html", "clean.html");
        assertThat(sidecar.entry("flagged.html").orElseThrow().findings()).hasSize(1);

        // The clean page goes away: carried home now links a missing page — found by the site rule, fresh.
        assetService.softDelete(site.clean().uuid(), true, fx.ctx());
        GenerationRun third = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(third.getPlanSummary().path("incremental").asBoolean()).isTrue();
        assertThat(q.findings(fx, third, QualityTestRules.MISSING))
                .extracting(StoredFinding::outputPath, StoredFinding::message, StoredFinding::carried)
                .containsExactlyInAnyOrder(
                        tuple("home.html", "Missing: gone.html", false),
                        tuple("home.html", "Missing: clean.html", false));

        // A base build without its sidecar can't vouch for carried outputs.
        Files.delete(q.buildsDir(fx, target).resolve(third.getId() + ".quality.json"));
        GenerationRun withoutFacts = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(withoutFacts.getPlanSummary().path("fallbackCause").asText()).isEqualTo("BASE_BUILD_WITHOUT_QUALITY_FACTS");
        assertThat(q.sidecar(fx, target, withoutFacts)).isPresent();

        // Neither can one checked under another configuration.
        q.configure(fx, Map.of(QualityTestRules.MISSING, QualitySeverity.OFF));
        GenerationRun rulesChanged = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(rulesChanged.getPlanSummary().path("fallbackCause").asText()).isEqualTo("QUALITY_RULES_CHANGED");
        assertThat(q.findings(fx, rulesChanged, QualityTestRules.MISSING)).isEmpty();
        GenerationRun settled = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(settled.getPlanSummary().path("incremental").asBoolean()).isTrue();
    }

    @Test
    void aRunCancelledWhileCheckingStoresNoFindingsAndPublishesNothing() throws InterruptedException {
        Site site = site("qccancel");
        Fixture fx = site.fx();
        GenerationTarget target = q.target(fx, "t");
        releaseFixtures.releaseAll(fx.projectId());
        RunLatches.Gate gate = latches.arm(fx.projectId(), GenerationRunProbe.CHECK_OUTPUT);
        GenerationRun started;
        try {
            started = generationService.start(fx.project().getKey(), new GenerationRequest(
                    GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null), fx.user().getId());
            long held = gate.awaitArrival();
            assertThat(held).isEqualTo(started.getId());
            generationService.cancel(fx.project().getKey(), held, fx.user().getId());
        } finally {
            latches.disarm(fx.projectId(), GenerationRunProbe.CHECK_OUTPUT);
        }

        GenerationRun run = q.build.await(fx, started.getId());

        assertThat(run.getStatus()).isEqualTo(RunStatus.CANCELLED);
        assertThat(q.findings(fx, run)).isEmpty();
        assertThat(run.getFindingCounts()).isNull();
        assertThat(q.manifest(fx, target, run)).isEmpty();
        assertThat(q.sidecar(fx, target, run)).isEmpty();
    }

    /**
     * Epic decision 5 in a localized build: an {@code ERROR} on the English outputs of a paginated page holds back every
     * English page number of it and nothing else — the German listing and the pages it lists are published, and one
     * {@code SF-GEN-0125} names the page and the language.
     */
    @Test
    void anErrorHoldsBackEveryPageNumberOfThePageInThatLanguageOnly() {
        Fixture fx = project("qclocale");
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de", Map.of(), false),
                true, fx.ctx());
        String pattern = "{locale}/{displayNameSlug}.{ext}";
        TemplateView post = q.build.pageTemplate(fx, "Post", "", document("Post", "<p>post</p>"));
        q.build.updateTemplate(fx, post.uuid(), document("Post", "<p>post</p>"), pattern);
        UUID navRoot = q.build.navigationRoot(fx);
        for (int i = 1; i <= 3; i++) {
            AssetVersionView page = q.build.page(fx, "Post " + i, post.uuid());
            q.build.pageReference(fx, "0" + i + " post", navRoot, page.uuid());
        }
        String listing = document("News", "<main>$CMS_VALUE(body | raw)$<ul>$CMS_FOR(item : CMS_PAGINATION.items)$"
                + "<li><a href=\"$CMS_VALUE(item.href)$\">$CMS_VALUE(item.label)$</a></li>$CMS_END_FOR$</ul></main>");
        TemplateView news = q.build.pageTemplate(fx, "News", """
                content {
                  editor text body { label "Body" localizable }
                  editor pagination posts { label "Posts" sources ["nav"] pageSize 1 maxPageSize 20 sort ["navigation"] }
                }
                """, listing);
        q.build.updateTemplate(fx, news.uuid(), listing, pattern);
        AssetVersionView newsPage = q.build.page(fx, "News", news.uuid(), payload -> {
            ObjectNode body = L10nValues.empty();
            body.withObject("values").put("de", "<p>gut</p>").put("en", "<p data-sf-flag=\"bad\">bad</p>");
            payload.withObject("content").set("body", body);
            ObjectNode posts = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
            posts.putObject("source").put("kind", "NAV").put("uuid", navRoot.toString());
            posts.put("pageSize", 1);
            posts.putObject("sort").put("key", "navigation").put("direction", "ASC");
        });
        q.configure(fx, Map.of(QualityTestRules.FLAG, QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().path("errors")).singleElement().satisfies(error -> {
            assertThat(error.path("code").asText()).isEqualTo(QualityCodes.GEN_QUALITY_CHECK_FAILED);
            assertThat(error.path("messages").get(0).asText()).contains(newsPage.uid(), "en", QualityTestRules.FLAG);
        });
        Map<String, String> files = q.files(fx, target, run);
        assertThat(files).containsKeys("de/news.html", "de/news-2.html", "de/news-3.html", "en/post-1.html",
                "en/post-3.html");
        assertThat(files).doesNotContainKeys("en/news.html", "en/news-2.html", "en/news-3.html");
        assertThat(files.get("sitemap.xml")).contains("de/news-3.html").doesNotContain("en/news");
        assertThat(q.manifest(fx, target, run).orElseThrow().outputs()).extracting(BuildManifest.Output::path)
                .contains("de/news-2.html").doesNotContain("en/news.html", "en/news-2.html", "en/news-3.html");
        assertThat(q.findings(fx, run, QualityTestRules.FLAG))
                .extracting(StoredFinding::outputPath, StoredFinding::locale, StoredFinding::severity)
                .containsExactlyInAnyOrder(
                        tuple("en/news.html", "en", QualitySeverity.ERROR),
                        tuple("en/news-2.html", "en", QualitySeverity.ERROR),
                        tuple("en/news-3.html", "en", QualitySeverity.ERROR));
    }

    /** The {@code CHECK} stage on the run's event stream (epic decision 10): "Checking output", then its counts. */
    @Test
    void theCheckStageIsReportedOnTheEventStream() throws InterruptedException {
        Site site = site("qcsse");
        Fixture fx = site.fx();
        q.configure(fx, Map.of(QualityTestRules.FLAG, QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");
        releaseFixtures.releaseAll(fx.projectId());
        RecordingEmitter events = new RecordingEmitter();
        // Held where the stage starts, before its first event: the stream is listening when the stage runs.
        RunLatches.Gate gate = latches.arm(fx.projectId(), "CHECK");
        GenerationRun started;
        try {
            started = generationService.start(fx.project().getKey(), new GenerationRequest(
                    GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, null), fx.user().getId());
            assertThat(gate.awaitArrival()).isEqualTo(started.getId());
            generationService.registerEmitter(started.getId(), events);
        } finally {
            latches.disarm(fx.projectId(), "CHECK");
        }

        GenerationRun run = q.build.await(fx, started.getId());

        assertThat(run.getStatus()).isEqualTo(RunStatus.PARTIAL);
        assertThat(events.stage("CHECK")).containsExactly(
                "Checking output", "Checked 3 outputs: 1 error, 2 warnings; 1 held back");
        List<String> stages = events.stages();
        assertThat(stages.indexOf("CHECK")).as("stages %s", stages)
                .isGreaterThan(stages.indexOf("ASSETS")).isLessThan(stages.indexOf("POST"));
    }

    /** An event stream that records what the service sends. */
    private static final class RecordingEmitter extends SseEmitter {

        private final List<JsonNode> events = new CopyOnWriteArrayList<>();

        RecordingEmitter() {
            super(60_000L);
        }

        @Override
        public void send(SseEventBuilder builder) {
            for (var part : builder.build()) {
                if (part.getData() instanceof JsonNode json) {
                    events.add(json);
                }
            }
        }

        @Override
        public void complete() {}

        List<String> stage(String stage) {
            return events.stream().filter(e -> stage.equals(e.path("stage").asText()))
                    .map(e -> e.path("message").asText()).toList();
        }

        List<String> stages() {
            return events.stream().map(e -> e.path("stage").asText()).distinct().toList();
        }
    }

    private UUID templateOf(Fixture fx, AssetVersionView page) {
        return UUID.fromString(q.build.current(fx, page.uuid()).payload().path("templateRef").asText());
    }
}
