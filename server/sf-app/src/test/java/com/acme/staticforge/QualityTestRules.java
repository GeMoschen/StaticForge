package com.acme.staticforge;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkRef;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.RuleParam;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jsoup.nodes.Element;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Quality rules that exist only in tests (M30.1.x): the framework is tested with them, independent of the real rule
 * set. Their codes use the {@code x90}–{@code x99} ends of the ranges, which the rule catalogue leaves free. Import
 * this configuration into a {@code @SpringBootTest} to register them next to the production rules.
 */
@TestConfiguration(proxyBeanMethods = false)
public class QualityTestRules {

    /** The page rule: every element carrying {@code data-sf-flag}. */
    public static final String FLAG = "SF-CHK-0390";

    /** The site rule: every internal {@code a[href]} whose target is not an output of the build. */
    public static final String MISSING = "SF-CHK-0190";

    /** The rule after the hold-back: every internal link to a held-back page output. */
    public static final String TO_HELD_BACK = "SF-CHK-0191";

    @Bean
    FlagRule qualityTestFlagRule() {
        return new FlagRule();
    }

    @Bean
    MissingTargetRule qualityTestMissingTargetRule() {
        return new MissingTargetRule();
    }

    @Bean
    HeldBackTargetRule qualityTestHeldBackTargetRule() {
        return new HeldBackTargetRule();
    }

    /**
     * Reports every element with a {@code data-sf-flag} attribute, naming its value — at most {@code limit} per output;
     * with {@code strict} also every {@code data-sf-soft} element.
     */
    public static final class FlagRule implements PageRule {

        @Override
        public String code() {
            return FLAG;
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.ACCESSIBILITY;
        }

        @Override
        public String name() {
            return "Test: flagged element";
        }

        @Override
        public String description() {
            return "Reports every element carrying data-sf-flag (test rule).";
        }

        @Override
        public List<RuleParam> params() {
            return List.of(
                    RuleParam.integer("limit", 10, 1, 100, "Most findings per output."),
                    RuleParam.bool("strict", false, "Also report data-sf-soft."));
        }

        @Override
        public List<Finding> check(ParsedOutput output, RuleContext context) {
            String query = context.boolParam("strict") ? "[data-sf-flag], [data-sf-soft]" : "[data-sf-flag]";
            List<Finding> findings = new ArrayList<>();
            for (Element element : output.document().select(query)) {
                if (findings.size() >= context.intParam("limit")) {
                    break;
                }
                findings.add(context.finding(element, "Flagged: " + element.attr("data-sf-flag")));
            }
            return findings;
        }
    }

    /** Reports every internal link from a checked output to a path the build has no output at. */
    public static final class MissingTargetRule implements SiteRule {

        @Override
        public String code() {
            return MISSING;
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.LINKS;
        }

        @Override
        public String name() {
            return "Test: link to a missing output";
        }

        @Override
        public String description() {
            return "Reports links to paths the build has no output at (test rule).";
        }

        @Override
        public List<Finding> check(SiteIndex site, RuleContext context) {
            List<Finding> findings = new ArrayList<>();
            for (Map.Entry<String, HtmlFacts> entry : site.facts().entrySet()) {
                IndexedOutput source = site.output(entry.getKey()).orElse(null);
                if (source == null) {
                    continue;
                }
                for (LinkRef link : entry.getValue().links()) {
                    if (link.element().equals("a") && link.internal() && site.output(link.resolvedPath()).isEmpty()
                            && !site.isHeldBack(link.resolvedPath())) {
                        findings.add(context.finding(source.key(), link.selector(), "Missing: " + link.resolvedPath()));
                    }
                }
            }
            return findings;
        }
    }

    /** Reports every internal link to a page output held back in this build (runs after the hold-back). */
    public static final class HeldBackTargetRule implements SiteRule {

        @Override
        public String code() {
            return TO_HELD_BACK;
        }

        @Override
        public QualityCategory category() {
            return QualityCategory.LINKS;
        }

        @Override
        public String name() {
            return "Test: link to a held-back page";
        }

        @Override
        public String description() {
            return "Reports links to pages held back in this build (test rule).";
        }

        @Override
        public boolean afterHoldBack() {
            return true;
        }

        @Override
        public List<Finding> check(SiteIndex site, RuleContext context) {
            List<Finding> findings = new ArrayList<>();
            for (Map.Entry<String, HtmlFacts> entry : site.facts().entrySet()) {
                IndexedOutput source = site.output(entry.getKey()).orElse(null);
                if (source == null) {
                    continue;
                }
                for (LinkRef link : entry.getValue().links()) {
                    if (link.internal() && site.isHeldBack(link.resolvedPath())) {
                        findings.add(context.finding(source.key(), link.selector(), "Held back: " + link.resolvedPath()));
                    }
                }
            }
            return findings;
        }
    }
}
