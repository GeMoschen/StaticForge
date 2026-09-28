package com.acme.staticforge;

import static com.acme.staticforge.QualityRuleHarness.assetOf;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.generate.quality.AssetLabel;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.rules.a11y.ButtonWithoutTextRule;
import com.acme.staticforge.generate.quality.rules.a11y.DuplicateIdRule;
import com.acme.staticforge.generate.quality.rules.a11y.IframeWithoutTitleRule;
import com.acme.staticforge.generate.quality.rules.a11y.LinkWithoutTextRule;
import com.acme.staticforge.generate.quality.rules.a11y.MissingAltRule;
import com.acme.staticforge.generate.quality.rules.a11y.MissingDocumentLangRule;
import com.acme.staticforge.generate.quality.rules.a11y.SkippedHeadingLevelRule;
import com.acme.staticforge.generate.quality.rules.a11y.UnlabelledFormControlRule;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The accessibility rules {@code SF-CHK-0301}–{@code 0308} (M30.2.3) over their fixtures in {@code quality/a11y/}. Every
 * fixture runs through all eight rules, and the test asserts every finding (code, selector, message): a {@code fail}
 * fixture fires only its own rule, a {@code pass} fixture fires nothing.
 */
class AccessibilityRulesTest {

    private static final String LOGO = "assets/media/logo.png";

    private static final List<QualityRule> RULES = List.of(
            new MissingAltRule(),
            new LinkWithoutTextRule(),
            new ButtonWithoutTextRule(),
            new SkippedHeadingLevelRule(),
            new DuplicateIdRule(),
            new UnlabelledFormControlRule(),
            new IframeWithoutTitleRule(),
            new MissingDocumentLangRule());

    /** Runs every accessibility rule over fixture {@code a11y/<name>.html}, published as {@code index.html}. */
    private static List<Finding> run(String name) {
        return QualityRuleHarness.of(RULES.toArray(QualityRule[]::new))
                .pageFromFixture("index.html", "a11y/" + name + ".html")
                .media(LOGO)
                .media("assets/media/go.png")
                .asset(new AssetLabel(assetOf(LOGO), "logo_png", "Company logo", "MEDIA"))
                .findings();
    }

    private static List<Tuple> findings(String name) {
        return run(name).stream().map(f -> tuple(f.code(), f.selector(), f.message())).toList();
    }

    // ------------------------------------------------------------------
    // The catalogue
    // ------------------------------------------------------------------

    @Test
    void theRulesArePageRulesWithTheirCatalogueCodesNamesAndFixHints() {
        assertThat(RULES).allSatisfy(rule -> {
            assertThat(rule).isInstanceOf(PageRule.class);
            assertThat(rule.category()).isEqualTo(QualityCategory.ACCESSIBILITY);
            assertThat(rule.defaultSeverity()).isEqualTo(QualitySeverity.WARNING);
            assertThat(rule.maxSeverity()).isEqualTo(QualitySeverity.ERROR);
            assertThat(rule.params()).isEmpty();
        });
        assertThat(RULES).extracting(QualityRule::code, QualityRule::name, QualityRule::fixHint).containsExactly(
                tuple("SF-CHK-0301", "Image without alt attribute", QualityFixHint.CONTENT_OR_TEMPLATE),
                tuple("SF-CHK-0302", "Link without accessible text", QualityFixHint.CONTENT_OR_TEMPLATE),
                tuple("SF-CHK-0303", "Button without accessible text", QualityFixHint.TEMPLATE),
                tuple("SF-CHK-0304", "Heading level skipped", QualityFixHint.CONTENT_OR_TEMPLATE),
                tuple("SF-CHK-0305", "Duplicate id", QualityFixHint.TEMPLATE),
                tuple("SF-CHK-0306", "Form control without label", QualityFixHint.TEMPLATE),
                tuple("SF-CHK-0307", "iframe without title", QualityFixHint.TEMPLATE),
                tuple("SF-CHK-0308", "<html> without lang", QualityFixHint.TEMPLATE));
    }

    /** The description tells the UI's reader where to fix it, matching the hint. */
    @Test
    void everyDescriptionSaysWhereToFix() {
        Map<QualityFixHint, List<QualityRule>> byHint =
                RULES.stream().collect(Collectors.groupingBy(QualityRule::fixHint));
        assertThat(byHint.get(QualityFixHint.CONTENT_OR_TEMPLATE)).allSatisfy(rule -> assertThat(rule.description())
                .contains("Fix in content").containsIgnoringCase("fix in the template"));
        assertThat(byHint.get(QualityFixHint.TEMPLATE)).allSatisfy(rule -> assertThat(rule.description())
                .contains("Fix in the template").doesNotContain("Fix in content"));
    }

    @Test
    void theCleanFrameworkPagePassesEveryRule() {
        assertThat(QualityRuleHarness.of(RULES.toArray(QualityRule[]::new))
                        .pageFromFixture("index.html", "framework/clean-page.html")
                        .media(LOGO)
                        .findings())
                .isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "0301-pass-empty-alt", "0302-pass", "0303-pass", "0304-pass", "0305-pass", "0306-pass", "0307-pass", "0308-pass"
    })
    void passFixturesFireNothing(String fixture) {
        assertThat(run(fixture)).isEmpty();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0301 image without alt
    // ------------------------------------------------------------------

    @Test
    void imagesWithoutAltAreReportedNamingTheMediaAssetWhenTheSrcResolvesToOne() {
        assertThat(findings("0301-fail")).containsExactly(
                tuple("SF-CHK-0301", "main#content > p:nth-of-type(1) > img",
                        "Image without alt attribute: media \"logo_png\" (assets/media/logo.png)."),
                tuple("SF-CHK-0301", "main#content > p:nth-of-type(2) > img",
                        "Image without alt attribute: https://cdn.example.org/banner.jpg."),
                tuple("SF-CHK-0301", "main#content > form > input",
                        "Image button without alt attribute: assets/media/go.png."));
    }

    @Test
    void theMediaIsResolvedRelativeToTheOutputAndAgainstTheBaseUrl() {
        List<String> messages = QualityRuleHarness.of(new MissingAltRule())
                .page("de/about/index.html", """
                        <html lang="de"><body>
                        <img src="../../assets/media/logo.png?v=2">
                        <img src="/assets/media/logo.png">
                        <img src="https://example.com/assets/media/logo.png">
                        <img src="../../assets/media/unknown.png">
                        <img>
                        </body></html>""")
                .media(LOGO)
                .asset(new AssetLabel(assetOf(LOGO), null, "Company logo", "MEDIA"))
                .findings()
                .stream()
                .map(Finding::message)
                .toList();
        assertThat(messages).containsExactly(
                "Image without alt attribute: media \"Company logo\" (../../assets/media/logo.png?v=2).",
                "Image without alt attribute: media \"Company logo\" (/assets/media/logo.png).",
                "Image without alt attribute: media \"Company logo\" (https://example.com/assets/media/logo.png).",
                "Image without alt attribute: ../../assets/media/unknown.png.",
                "Image without alt attribute.");
    }

    @Test
    void aPageOutputAtTheSrcIsNotAMediaAsset() {
        assertThat(QualityRuleHarness.of(new MissingAltRule())
                        .page("index.html", "<html lang=\"en\"><body><img src=\"chart.html\"></body></html>")
                        .page("chart.html", "<html lang=\"en\"><body><p>chart</p></body></html>")
                        .findings())
                .extracting(Finding::message)
                .containsExactly("Image without alt attribute: chart.html.");
    }

    // ------------------------------------------------------------------
    // SF-CHK-0302 link without accessible text
    // ------------------------------------------------------------------

    @Test
    void linksWithoutTextAreReported() {
        assertThat(findings("0302-fail")).containsExactly(
                tuple("SF-CHK-0302", "main#content > nav > a", "Link to index.html has no accessible text."),
                tuple("SF-CHK-0302", "main#content > p > a", "Link to about.html has no accessible text."));
    }

    @Test
    void aLinkAroundOnlyAnEmptyAltImageFailsThoughTheImagePasses0301() {
        assertThat(findings("0302-fail-empty-alt-image")).containsExactly(tuple("SF-CHK-0302", "main#content > p > a",
                "Link to about.html has no accessible text: its image has no alt text."));
    }

    @Test
    void aLinkLabelledByAMissingIdFails() {
        assertThat(findings("0302-fail-missing-labelledby")).containsExactly(
                tuple("SF-CHK-0302", "main#content > p > a", "Link to about.html has no accessible text."));
    }

    @Test
    void aLinkWithRoleButtonIsLeftToTheButtonRule() {
        assertThat(QualityRuleHarness.of(RULES.toArray(QualityRule[]::new))
                        .page("index.html", "<html lang=\"en\"><body><a href=\"#\" role=\"button\"></a></body></html>")
                        .findings())
                .extracting(Finding::code)
                .containsExactly("SF-CHK-0303");
    }

    // ------------------------------------------------------------------
    // SF-CHK-0303 button without accessible text
    // ------------------------------------------------------------------

    @Test
    void buttonsWithoutTextAreReported() {
        assertThat(findings("0303-fail")).containsExactly(
                tuple("SF-CHK-0303", "main#content > p:nth-of-type(1) > button", "Button has no accessible text."),
                tuple("SF-CHK-0303", "main#content > div", "<div role=\"button\"> has no accessible text."),
                tuple("SF-CHK-0303", "main#content > p:nth-of-type(2) > button", "Button has no accessible text."));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0304 heading level skipped
    // ------------------------------------------------------------------

    @Test
    void everyHeadingThatSkipsALevelIsReported() {
        assertThat(findings("0304-fail")).containsExactly(
                tuple("SF-CHK-0304", "main#content > h4", "Heading level skipped: h4 follows h2 without an h3."),
                tuple("SF-CHK-0304", "main#content > h6", "Heading level skipped: h6 follows h2 without an h3."));
    }

    @Test
    void theFirstHeadingMayBeAnyLevel() {
        assertThat(QualityRuleHarness.of(new SkippedHeadingLevelRule())
                        .page("index.html", "<html lang=\"en\"><body><h4>a</h4><h5>b</h5><h2>c</h2></body></html>")
                        .findings())
                .isEmpty();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0305 duplicate id
    // ------------------------------------------------------------------

    @Test
    void oneFindingPerDuplicatedIdOnItsSecondElementWithTheCount() {
        assertThat(findings("0305-fail")).containsExactly(
                tuple("SF-CHK-0305", "main#content > section:nth-of-type(2)", "Duplicate id \"card\": used 3 times."),
                tuple("SF-CHK-0305", "main#content > section:nth-of-type(2) > h2",
                        "Duplicate id \"card-title\": used 2 times."));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0306 form control without label
    // ------------------------------------------------------------------

    @Test
    void formControlsWithoutLabelAreReported() {
        assertThat(findings("0306-fail")).containsExactly(
                tuple("SF-CHK-0306", "main#content > form > input:nth-of-type(1)",
                        "Form control <input type=\"text\" name=\"q\"> has no label."),
                tuple("SF-CHK-0306", "main#content > form > select",
                        "Form control <select name=\"sort\"> has no label."),
                tuple("SF-CHK-0306", "main#content > form > label:nth-of-type(1) > textarea",
                        "Form control <textarea name=\"note\"> has no label."),
                tuple("SF-CHK-0306", "input#mail", "Form control <input type=\"email\" id=\"mail\"> has no label."),
                tuple("SF-CHK-0306", "main#content > form > input:nth-of-type(4)",
                        "Form control <input type=\"checkbox\" name=\"terms\"> has no label."));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0307 iframe without title
    // ------------------------------------------------------------------

    @Test
    void framesWithoutTitleAreReported() {
        assertThat(findings("0307-fail")).containsExactly(
                tuple("SF-CHK-0307", "main#content > iframe:nth-of-type(1)",
                        "iframe without title: https://maps.example.org/embed."),
                tuple("SF-CHK-0307", "main#content > iframe:nth-of-type(2)",
                        "iframe without title: https://video.example.org/embed/1."));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0308 <html> without lang
    // ------------------------------------------------------------------

    @Test
    void aDocumentWithoutLangIsReportedAsAWhole() {
        assertThat(findings("0308-fail")).containsExactly(tuple("SF-CHK-0308", null, "<html> has no lang attribute."));
        assertThat(findings("0308-fail-empty"))
                .containsExactly(tuple("SF-CHK-0308", null, "<html> has an empty lang attribute."));
    }

    // ------------------------------------------------------------------
    // Severity
    // ------------------------------------------------------------------

    @Test
    void anErrorConfiguredRuleHoldsThePageBack() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(RULES.toArray(QualityRule[]::new))
                .pageFromFixture("index.html", "a11y/0307-fail.html")
                .pageFromFixture("clean.html", "a11y/0307-pass.html")
                .configure("SF-CHK-0307", QualitySeverity.ERROR)
                .run();
        assertThat(result.of("SF-CHK-0307")).extracting(Finding::severity).containsOnly(QualitySeverity.ERROR);
        assertThat(result.heldBack()).containsExactly("index.html");
    }
}
