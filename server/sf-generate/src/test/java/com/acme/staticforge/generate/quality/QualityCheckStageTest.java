package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.pipeline.RunCheckpoint;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.quality.EffectiveQualityConfig.RuleSetting;
import com.acme.staticforge.generate.quality.rules.OutputNotCheckedRule;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The {@code CHECK} stage's decisions (M30.1.3): what it parses, what an {@code ERROR} holds back (every output of the
 * page in that channel and language, carried ones too, never a carried page's own), what carried outputs bring from the
 * base sidecar, and what the build publishes afterwards.
 */
class QualityCheckStageTest {

    private static final UUID BLOG = UUID.randomUUID();
    private static final UUID ABOUT = UUID.randomUUID();
    private static final UUID LOGO = UUID.randomUUID();

    private final PageRule flag = TestRules.page("SF-CHK-0390", QualityCategory.ACCESSIBILITY, (output, context) ->
            output.document().select("[data-flag]").stream().map(e -> context.finding(e, "flagged")).toList());
    private final SiteRule missing = TestRules.site("SF-CHK-0190", QualityCategory.LINKS, false, (site, context) ->
            site.facts().entrySet().stream()
                    .flatMap(entry -> entry.getValue().links().stream()
                            .filter(link -> link.internal() && site.output(link.resolvedPath()).isEmpty())
                            .map(link -> context.finding(site.output(entry.getKey()).orElseThrow().key(), link.selector(),
                                    "missing " + link.resolvedPath())))
                    .toList());
    private final QualityRuleRegistry registry = new QualityRuleRegistry(List.of(new OutputNotCheckedRule(), flag, missing));
    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final QualityCheckStage stage = new QualityCheckStage(
            new PageRuleRunner(registry), new SiteRuleRunner(registry), new GenerationProperties(), meters);

    private static Snapshot snapshot() {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        long id = 1;
        for (Map.Entry<UUID, String> asset : Map.of(BLOG, "blog", ABOUT, "about").entrySet()) {
            SnapshotAsset page = new SnapshotAsset(asset.getKey(), id++, AssetType.PAGE, asset.getValue(),
                    asset.getValue(), "/", null, false, null, null, false);
            byUuid.put(page.uuid(), page);
            byId.put(page.assetId(), page);
        }
        return new Snapshot(1L, 5L, byUuid, byId);
    }

    private static RenderedFile file(String path, String body) {
        return new RenderedFile(path, ("<html><body>" + body + "</body></html>").getBytes(StandardCharsets.UTF_8), Set.of(),
                List.of());
    }

    private QualityCheckStage.CheckInput input(QualitySeverity flagSeverity, QualitySidecar base) {
        EffectiveQualityConfig config = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0390", new RuleSetting(flagSeverity, Map.of())));
        return new QualityCheckStage.CheckInput(
                config,
                "https://example.com",
                null,
                channel -> channel.equals("markdown")
                        ? ChannelOutputSettings.of("markdown", "md", null)
                        : ChannelOutputSettings.defaults(channel),
                snapshot(),
                List.of(
                        new PlanEntry(BLOG, "html", "blog.html"),
                        new PlanEntry(BLOG, "html", "blog-2.html"),
                        new PlanEntry(BLOG, "markdown", "blog.md")),
                List.of(
                        file("blog.html", "<a href=\"about.html\">about</a> <a href=\"assets/logo.png\">logo</a>"),
                        file("blog-2.html", "<p data-flag>x</p><a href=\"gone.html\">gone</a>"),
                        file("blog.md", "<p data-flag>not html, never parsed</p>")),
                Set.of("draft.html"),
                List.of(
                        new BuildManifest.Output("blog-3.html", BuildManifest.Kind.PAGE, BLOG, "html", 3, Set.of()),
                        new BuildManifest.Output("about.html", BuildManifest.Kind.PAGE, ABOUT, "html", null, Set.of())),
                Map.of("assets/logo.png", new MediaOutputs.Key(LOGO, null)),
                Set.of("sitemap.xml"),
                base,
                RunCheckpoint.NONE);
    }

    private static QualitySidecar baseSidecar() {
        return new QualitySidecar(QualitySidecar.VERSION, "old", Map.of(
                "about.html", new QualitySidecar.Entry(
                        new HtmlFacts("About", null, 1, "en", null, List.of(), null, List.of(), List.of(), List.of(
                                new LinkRef("a", "href", "nowhere.html", "nowhere.html", null, "body > a")), false, false),
                        List.of(new QualitySidecar.PageFinding("SF-CHK-0390", QualityCategory.ACCESSIBILITY,
                                QualitySeverity.WARNING, "flagged", "body > p", null)))));
    }

    @Test
    void anErrorHoldsBackEveryOutputOfThePageInThatChannelButNeverACarriedPage() {
        QualityCheckStage.CheckResult result = stage.check(input(QualitySeverity.ERROR, baseSidecar()));

        assertThat(result.heldBack()).containsExactlyInAnyOrder("blog.html", "blog-2.html", "blog-3.html");
        assertThat(result.pageErrors()).extracting(Diagnostic::code, Diagnostic::message).containsExactly(
                tuple("SF-GEN-0125", "Quality check failed for page 'blog' (html): SF-CHK-0390"));
        assertThat(result.finalOutputs()).containsOnlyKeys("blog.md", "about.html", "assets/logo.png", "sitemap.xml");
        assertThat(result.published(input(QualitySeverity.ERROR, null).rendered()))
                .extracting(RenderedFile::outputPath).containsExactly("blog.md");
        assertThat(result.sidecar().outputs()).as("held-back outputs leave the sidecar").containsOnlyKeys("about.html");
        assertThat(result.sidecar().configFingerprint()).isEqualTo(input(QualitySeverity.ERROR, null).config().fingerprint());

        assertThat(result.findings())
                .extracting(f -> f.output().path(), Finding::code, Finding::severity, Finding::carried)
                .containsExactlyInAnyOrder(
                        tuple("blog-2.html", "SF-CHK-0390", QualitySeverity.ERROR, false),
                        tuple("about.html", "SF-CHK-0390", QualitySeverity.ERROR, true),
                        tuple("blog-2.html", "SF-CHK-0190", QualitySeverity.WARNING, false),
                        tuple("about.html", "SF-CHK-0190", QualitySeverity.WARNING, false));
        assertThat(result.checkedOutputs()).as("blog.html, blog-2.html, carried about.html").isEqualTo(3);

        assertThat(meters.timer("sf.quality.check.duration").count()).isEqualTo(1);
        assertThat(meters.counter("sf.quality.findings", "severity", "ERROR", "category", "accessibility").count())
                .isEqualTo(2);
        assertThat(meters.counter("sf.quality.findings", "severity", "WARNING", "category", "links").count()).isEqualTo(2);
    }

    @Test
    void warningsHoldNothingBackAndCarriedFindingsFollowTheCurrentConfiguration() {
        QualityCheckStage.CheckResult warnings = stage.check(input(QualitySeverity.WARNING, baseSidecar()));
        assertThat(warnings.heldBack()).isEmpty();
        assertThat(warnings.pageErrors()).isEmpty();
        assertThat(warnings.finalOutputs()).containsKeys("blog.html", "blog-2.html", "blog-3.html");
        assertThat(warnings.sidecar().outputs()).containsOnlyKeys("blog.html", "blog-2.html", "about.html");

        QualityCheckStage.CheckResult off = stage.check(input(QualitySeverity.OFF, baseSidecar()));
        assertThat(off.findings()).extracting(Finding::code).containsOnly("SF-CHK-0190");
    }

    @Test
    void withoutABaseSidecarCarriedOutputsAreIndexedButNotChecked() {
        QualityCheckStage.CheckResult result = stage.check(input(QualitySeverity.WARNING, null));

        assertThat(result.outputs().get("about.html").carried()).isTrue();
        assertThat(result.findings()).extracting(f -> f.output().path()).doesNotContain("about.html");
        assertThat(result.findings()).filteredOn(f -> f.code().equals("SF-CHK-0190"))
                .extracting(Finding::message).containsExactly("missing gone.html");
    }
}
