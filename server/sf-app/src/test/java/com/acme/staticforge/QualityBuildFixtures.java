package com.acme.staticforge;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.quality.QualityRuleConfig;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.QualitySidecar;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.target.BuildManifest;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.domain.Pageable;

/**
 * Builds small fixture projects and reads back what their builds' quality checks found (M30.1.3) — the base of every
 * integration test that needs the renderer: reference events, the hold-back in a real build, incremental runs and the
 * golden fixture. Wraps {@link BuildInsightFixtures} (projects, templates, pages, targets, runs, published files) and
 * adds the rule configuration, the stored findings of a run and the build's sidecar and manifest.
 *
 * <p>Each page gets its own template whose HTML is the page's whole output ({@link #htmlPage}), written to
 * {@code {displayNameSlug}.html} — so a test writes exactly the markup a rule should see, with links relative to it.
 */
final class QualityBuildFixtures {

    final BuildInsightFixtures build;
    private final QualityRuleConfigService config;
    private final RunFindingStore findings;
    private final Path outputRoot;

    QualityBuildFixtures(
            BuildInsightFixtures build, QualityRuleConfigService config, RunFindingStore findings, Path outputRoot) {
        this.build = build;
        this.config = config;
        this.findings = findings;
        this.outputRoot = outputRoot;
    }

    /** A new project. */
    Fixture project(String prefix) {
        return build.project(prefix);
    }

    /** A filesystem target with {@code baseUrl} {@code https://example.com}. */
    GenerationTarget target(Fixture fx, String name) {
        return build.target(fx, name, TargetType.FILESYSTEM);
    }

    /** A page named {@code name} whose output ({@code {slug}.html}) is exactly {@code html}. */
    AssetVersionView htmlPage(Fixture fx, String name, String html) {
        TemplateView template = build.pageTemplate(fx, name + " template", "", html);
        return build.page(fx, name, template.uuid());
    }

    /** A complete document around {@code body}: {@code lang}, title and one {@code h1}, so only the rule under test fires. */
    static String document(String title, String body) {
        return "<!doctype html><html lang=\"en\"><head><title>" + title + "</title></head><body><h1>" + title + "</h1>"
                + body + "</body></html>";
    }

    /** Sets the severity of the given rules (every other rule keeps its setting). */
    void configure(Fixture fx, Map<String, QualitySeverity> severities) {
        Map<String, QualityRuleConfig.Entry> entries = new java.util.LinkedHashMap<>();
        config.effective(fx.projectId()).settings().forEach((code, setting) -> entries.put(
                code, new QualityRuleConfig.Entry(setting.severity().name(), setting.params())));
        severities.forEach((code, severity) -> entries.put(code, new QualityRuleConfig.Entry(severity.name(), null)));
        config.update(fx.project().getKey(), entries, fx.ctx());
    }

    /**
     * Switches every rule but {@code codes} off (those keep their defaults): a test about the framework or one rule
     * isn't disturbed by the production rules' findings on its fixture pages.
     */
    void only(Fixture fx, java.util.Set<String> codes) {
        Map<String, QualityRuleConfig.Entry> entries = new java.util.LinkedHashMap<>();
        config.effective(fx.projectId()).settings().keySet().stream()
                .filter(code -> !codes.contains(code))
                .forEach(code -> entries.put(code, new QualityRuleConfig.Entry("OFF", null)));
        config.update(fx.project().getKey(), entries, fx.ctx());
    }

    /** Switches every rule off. */
    void allOff(Fixture fx) {
        Map<String, QualityRuleConfig.Entry> entries = new java.util.LinkedHashMap<>();
        config.effective(fx.projectId()).settings().keySet()
                .forEach(code -> entries.put(code, new QualityRuleConfig.Entry("OFF", null)));
        config.update(fx.project().getKey(), entries, fx.ctx());
    }

    /** Releases everything and runs a build of {@code mode} to {@code target}, to its end. */
    GenerationRun generate(Fixture fx, GenerationTarget target, GenerationMode mode) {
        return build.generate(fx, target, mode);
    }

    /** Every stored finding of {@code run}, by output path, then code. */
    List<RunFindingStore.StoredFinding> findings(Fixture fx, GenerationRun run) {
        return findings.page(fx.projectId(), run.getId(), RunFindingStore.Filter.NONE, Pageable.unpaged()).getContent();
    }

    /** The stored findings of {@code run} with {@code code}. */
    List<RunFindingStore.StoredFinding> findings(Fixture fx, GenerationRun run, String code) {
        return findings(fx, run).stream().filter(finding -> finding.code().equals(code)).toList();
    }

    /** The published files of {@code run}, by path, as text. */
    Map<String, String> files(Fixture fx, GenerationTarget target, GenerationRun run) {
        return build.files(fx, target, run);
    }

    Path buildsDir(Fixture fx, GenerationTarget target) {
        return build.targetDir(fx, target).resolve("builds");
    }

    /** The quality sidecar of {@code run}'s build. */
    Optional<QualitySidecar> sidecar(Fixture fx, GenerationTarget target, GenerationRun run) {
        Path file = buildsDir(fx, target).resolve(run.getId() + "." + QualitySidecar.NAME + ".json");
        try {
            return Files.exists(file) ? QualitySidecar.parse(Files.readAllBytes(file)) : Optional.empty();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The manifest of {@code run}'s build. */
    Optional<BuildManifest> manifest(Fixture fx, GenerationTarget target, GenerationRun run) {
        Path file = buildsDir(fx, target).resolve(run.getId() + ".manifest.json");
        try {
            return Files.exists(file) ? BuildManifest.parse(Files.readAllBytes(file)) : Optional.empty();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    Path outputRoot() {
        return outputRoot;
    }
}
