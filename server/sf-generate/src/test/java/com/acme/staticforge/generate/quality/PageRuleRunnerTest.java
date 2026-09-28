package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.generate.quality.EffectiveQualityConfig.RuleSetting;
import com.acme.staticforge.generate.quality.rules.OutputNotCheckedRule;
import com.acme.staticforge.generate.target.BuildManifest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Running page rules over one output, standalone (M30.1.1): the effective configuration decides what runs and at which
 * severity, findings carry the output, selector and section, and a failing rule is an {@code SF-CHK-0001} warning.
 */
class PageRuleRunnerTest {

    private static final UUID PAGE = UUID.randomUUID();
    private static final OutputKey KEY = new OutputKey("de/a.html", PAGE, "html", "de", null);

    private final PageRule images = TestRules.page("SF-CHK-0301", QualityCategory.ACCESSIBILITY, (output, context) ->
            output.document().select("img:not([alt])").stream()
                    .map(img -> context.finding(img, "Image without alt: " + img.attr("src")))
                    .toList());
    private final PageRule title = TestRules.page("SF-CHK-0202", QualityCategory.SEO, (output, context) -> {
        String text = output.facts().title() == null ? "" : output.facts().title();
        return text.length() > context.intParam("max")
                ? List.of(context.finding("Title longer than " + context.intParam("max")))
                : List.of();
    }, RuleParam.integer("max", 60, 1, 200, "longest title"));
    private final PageRule broken = TestRules.page("SF-CHK-0207", QualityCategory.SEO, (output, context) -> {
        throw new IllegalStateException("boom");
    });

    private final QualityRuleRegistry registry =
            new QualityRuleRegistry(List.of(new OutputNotCheckedRule(), images, title, broken));
    private final PageRuleRunner runner = new PageRuleRunner(registry);
    private final CheckEnvironment environment = new CheckEnvironment("https://example.com", null, Map.of(
            "de/a.html", new IndexedOutput(KEY, BuildManifest.Kind.PAGE, false)), null, null);

    private static byte[] html(String body) {
        return ("<html><head><title>A title that is rather long for its page</title></head><body>" + body + "</body></html>")
                .getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void findingsCarryTheOutputSelectorSeverityAndSection() {
        EffectiveQualityConfig config = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0301", new RuleSetting(QualitySeverity.ERROR, Map.of()),
                "SF-CHK-0202", new RuleSetting(QualitySeverity.WARNING, Map.of("max", 20)),
                "SF-CHK-0207", new RuleSetting(QualitySeverity.OFF, Map.of())));

        PageRuleRunner.PageCheck check = runner.check(KEY, html("<main id=\"m\"><img src=\"x.png\" alt=\"\">"
                + SectionMarkers.open("sec-2") + "<p><img src=\"y.png\"></p>" + SectionMarkers.close() + "</main>"),
                config, environment);

        assertThat(check.facts()).isNotNull();
        assertThat(check.findings())
                .extracting(Finding::code, Finding::severity, Finding::category, Finding::selector,
                        Finding::sectionInstanceId, Finding::message)
                .containsExactly(
                        tuple("SF-CHK-0202", QualitySeverity.WARNING, QualityCategory.SEO, null, null,
                                "Title longer than 20"),
                        tuple("SF-CHK-0301", QualitySeverity.ERROR, QualityCategory.ACCESSIBILITY,
                                "main#m > p > img", "sec-2", "Image without alt: y.png"));
        assertThat(check.findings()).allSatisfy(finding -> {
            assertThat(finding.output()).isEqualTo(KEY);
            assertThat(finding.carried()).isFalse();
        });
    }

    @Test
    void defaultsApplyWhenTheProjectConfiguresNothing() {
        PageRuleRunner.PageCheck check = runner.check(KEY, html("<img src=\"y.png\">"),
                EffectiveQualityConfig.defaults(registry), environment);

        assertThat(check.findings()).extracting(Finding::code, Finding::severity).containsExactly(
                tuple("SF-CHK-0001", QualitySeverity.WARNING),
                tuple("SF-CHK-0301", QualitySeverity.WARNING));
        assertThat(check.findings().get(0).message()).contains("SF-CHK-0207").contains("boom");
    }

    @Test
    void aFailingRuleIsSilentWhenTheProjectSwitchedSfChk0001Off() {
        EffectiveQualityConfig config = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0001", new RuleSetting(QualitySeverity.OFF, Map.of())));

        assertThat(runner.check(KEY, html(""), config, environment).findings()).isEmpty();
    }

    @Test
    void sfChk0001NeverBecomesAnError() {
        EffectiveQualityConfig config = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0001", new RuleSetting(QualitySeverity.ERROR, Map.of())));

        assertThat(runner.check(KEY, html(""), config, environment).findings())
                .extracting(Finding::severity)
                .containsExactly(QualitySeverity.WARNING);
    }

    @Test
    void checksNeverChangeTheBytes() {
        byte[] bytes = html("<p>Unclosed <b>markup<img src=x>");
        byte[] copy = bytes.clone();

        runner.check(KEY, bytes, EffectiveQualityConfig.defaults(registry), environment);

        assertThat(bytes).isEqualTo(copy);
    }

    @Test
    void theConfigurationFingerprintChangesWithAnyEffectiveSetting() {
        EffectiveQualityConfig defaults = EffectiveQualityConfig.defaults(registry);
        EffectiveQualityConfig same = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0202", new RuleSetting(QualitySeverity.WARNING, Map.of("max", 60)),
                "SF-CHK-9999", new RuleSetting(QualitySeverity.ERROR, Map.of())));
        EffectiveQualityConfig param = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0202", new RuleSetting(QualitySeverity.WARNING, Map.of("max", 61))));
        EffectiveQualityConfig off = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0301", new RuleSetting(QualitySeverity.OFF, Map.of())));

        assertThat(same.fingerprint()).as("defaults written out and unknown codes change nothing")
                .isEqualTo(defaults.fingerprint());
        assertThat(param.fingerprint()).isNotEqualTo(defaults.fingerprint());
        assertThat(off.fingerprint()).isNotEqualTo(defaults.fingerprint());
        assertThat(same.setting("SF-CHK-9999")).isNull();
        EffectiveQualityConfig outOfBounds = EffectiveQualityConfig.of(registry, Map.of(
                "SF-CHK-0202", new RuleSetting(QualitySeverity.WARNING, Map.of("max", 5_000))));
        assertThat(outOfBounds.params(title)).as("an invalid stored value keeps the default").containsEntry("max", 60);
    }
}
