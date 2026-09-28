package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.ArrayList;
import java.util.List;
import org.jsoup.nodes.Element;
import org.jsoup.select.Evaluator;
import org.jsoup.select.Selector;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0304} "Heading level skipped" (M30.2.3): in document order, a heading ({@code h1}–{@code h6}) must not
 * be more than one level deeper than the heading before it ({@code h2} → {@code h4} fails, {@code h4} → {@code h2}
 * passes). The first heading may be any level. One finding per skipping heading.
 */
@Component
public class SkippedHeadingLevelRule implements PageRule {

    public static final String CODE = "SF-CHK-0304";

    /** Parsed once: selecting by a query string would parse it for every document. */
    private static final Evaluator HEADINGS = Selector.evaluatorOf("h1, h2, h3, h4, h5, h6");

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.ACCESSIBILITY;
    }

    @Override
    public String name() {
        return "Heading level skipped";
    }

    @Override
    public String description() {
        return "A heading is more than one level deeper than the heading before it (h2 followed by h4), so the page "
                + "outline has a gap screen reader users navigate by. Fix in content when the headings come from a "
                + "rich-text field; fix in the template when it hard-codes the heading levels (a section title as h4 "
                + "under the page's h2).";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        int previous = 0;
        for (Element heading : output.document().select(HEADINGS)) {
            int level = heading.normalName().charAt(1) - '0';
            if (previous > 0 && level > previous + 1) {
                findings.add(context.finding(heading, "Heading level skipped: h" + level + " follows h" + previous
                        + " without an h" + (previous + 1) + "."));
            }
            previous = level;
        }
        return findings;
    }
}
