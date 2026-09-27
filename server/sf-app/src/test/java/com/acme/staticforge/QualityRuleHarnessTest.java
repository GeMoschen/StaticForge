package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The rule harness runs rules in the build's order over fixture HTML (M30.1.1). */
class QualityRuleHarnessTest {

    /** Reports every image without {@code alt}. */
    static final class NoAlt implements PageRule {
        @Override
        public String code() {
            return "SF-CHK-0301";
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.ACCESSIBILITY;
        }

        @Override
        public String name() {
            return "Test: image without alt";
        }

        @Override
        public String description() {
            return "";
        }

        @Override
        public List<Finding> check(ParsedOutput output, RuleContext context) {
            return output.document().select("img:not([alt])").stream().map(img -> context.finding(img, "no alt")).toList();
        }
    }

    /** Reports every internal link to a path the build doesn't have. */
    static final class Missing implements SiteRule {
        @Override
        public String code() {
            return "SF-CHK-0101";
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.LINKS;
        }

        @Override
        public String name() {
            return "Test: missing target";
        }

        @Override
        public String description() {
            return "";
        }

        @Override
        public List<Finding> check(SiteIndex site, RuleContext context) {
            return site.facts().entrySet().stream()
                    .flatMap(entry -> entry.getValue().links().stream()
                            .filter(link -> link.internal() && site.output(link.resolvedPath()).isEmpty())
                            .map(link -> context.finding(site.output(entry.getKey()).orElseThrow().key(), link.selector(),
                                    "missing " + link.resolvedPath())))
                    .toList();
        }
    }

    /** Reports every internal link to a held-back page. */
    static final class ToHeldBack implements SiteRule {
        @Override
        public String code() {
            return "SF-CHK-0103";
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.LINKS;
        }

        @Override
        public String name() {
            return "Test: link to held-back page";
        }

        @Override
        public String description() {
            return "";
        }

        @Override
        public boolean afterHoldBack() {
            return true;
        }

        @Override
        public List<Finding> check(SiteIndex site, RuleContext context) {
            return site.facts().entrySet().stream()
                    .flatMap(entry -> entry.getValue().links().stream()
                            .filter(link -> site.isHeldBack(link.resolvedPath()))
                            .map(link -> context.finding(site.output(entry.getKey()).orElseThrow().key(), link.selector(),
                                    "held back " + link.resolvedPath())))
                    .toList();
        }
    }

    @Test
    void theCleanFixturePassesAndItsLinksResolve() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(new NoAlt(), new Missing())
                .pageFromFixture("index.html", "framework/clean-page.html")
                .page("about.html", "<html><body><h1 id=\"team\">Team</h1></body></html>")
                .media("assets/media/logo.png")
                .run();

        assertThat(result.findings()).isEmpty();
        assertThat(result.facts().get("index.html").links()).extracting(link -> link.resolvedPath()).contains(
                "index.html", "assets/media/logo.png", "about.html");
    }

    @Test
    void anErrorHoldsBackEveryOutputOfThePageAndTheSecondPhaseSeesIt() {
        UUID blog = UUID.randomUUID();
        QualityRuleHarness.Result result = QualityRuleHarness.of(new NoAlt(), new Missing(), new ToHeldBack())
                .configure("SF-CHK-0301", QualitySeverity.ERROR)
                .configure("SF-CHK-0103", QualitySeverity.ERROR)
                .page("index.html", "<body><a href=\"blog.html\">blog</a> <a href=\"gone.html\">gone</a></body>")
                .page(new OutputKey("blog.html", blog, "html", null, null), "<body><img src=\"x.png\"></body>")
                .page(new OutputKey("blog-2.html", blog, "html", null, 2), "<body>page 2</body>")
                .media("x.png")
                .run();

        assertThat(result.heldBack()).containsExactlyInAnyOrder("blog.html", "blog-2.html");
        assertThat(result.findings())
                .extracting(f -> f.output().path(), Finding::code, Finding::severity, Finding::message)
                .containsExactly(
                        tuple("blog.html", "SF-CHK-0301", QualitySeverity.ERROR, "no alt"),
                        tuple("index.html", "SF-CHK-0101", QualitySeverity.WARNING, "missing gone.html"),
                        tuple("index.html", "SF-CHK-0103", QualitySeverity.WARNING, "held back blog.html"));
        assertThat(result.of("SF-CHK-0103")).singleElement()
                .satisfies(finding -> assertThat(finding.selector()).isEqualTo("body > a:nth-of-type(1)"));
    }
}
