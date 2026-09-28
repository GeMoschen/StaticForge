package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.jsoup.nodes.Element;
import org.jsoup.select.Evaluator;
import org.jsoup.select.Selector;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0307} "iframe without title" (M30.2.3): an {@code iframe} without a non-empty {@code title}. Frames
 * hidden from assistive technology ({@code aria-hidden="true"}, {@code hidden}) are skipped.
 */
@Component
public class IframeWithoutTitleRule implements PageRule {

    public static final String CODE = "SF-CHK-0307";

    /** Parsed once: selecting by a query string would parse it for every document. */
    private static final Evaluator IFRAMES = Selector.evaluatorOf("iframe");

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
        return "iframe without title";
    }

    @Override
    public String description() {
        return "An embedded frame (a map, a video player) has no title, so screen reader users can't tell what it "
                + "contains before entering it. Fix in the template that writes the iframe: add a title describing "
                + "the content.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.document().select(IFRAMES).stream()
                .filter(frame -> !AccessibleNames.hidden(frame) && AccessibleNames.isBlank(frame.attr("title")))
                .map(frame -> context.finding(frame, message(frame)))
                .toList();
    }

    private static String message(Element frame) {
        String src = frame.attr("src").strip();
        return src.isEmpty() ? "iframe without title." : "iframe without title: " + src + ".";
    }
}
