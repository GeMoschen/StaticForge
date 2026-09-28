package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.jsoup.nodes.Element;
import org.jsoup.select.Evaluator;
import org.jsoup.select.Selector;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0302} "Link without accessible text" (M30.2.3): an {@code a[href]} whose accessible name is empty — no
 * text, no {@code aria-labelledby} resolving to text, no {@code aria-label}, no image with non-empty {@code alt}, no
 * {@code title} ({@link AccessibleNames}). A link containing only an {@code alt=""} image fails. Links hidden from
 * assistive technology, and links with {@code role=button} ({@code SF-CHK-0303} checks those), are skipped.
 */
@Component
public class LinkWithoutTextRule implements PageRule {

    public static final String CODE = "SF-CHK-0302";

    /** Parsed once: selecting by a query string would parse it for every document. */
    private static final Evaluator LINKS = Selector.evaluatorOf("a[href]");

    private static final Evaluator IMAGES = Selector.evaluatorOf("img, svg");

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
        return "Link without accessible text";
    }

    @Override
    public String description() {
        return "A link has no text a screen reader can announce: no link text, aria-label, aria-labelledby, image alt "
                + "text or title. Fix in content when the link is in a rich-text field or its only image is a media "
                + "asset without alt text. Fix in the template when the link is hard-coded there, such as an icon "
                + "link: add an aria-label or visually hidden text.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.document().select(LINKS).stream()
                .filter(link -> !link.attr("role").strip().equalsIgnoreCase("button"))
                .filter(link -> !AccessibleNames.hidden(link) && !AccessibleNames.hasName(link))
                .map(link -> context.finding(link, message(link)))
                .toList();
    }

    private static String message(Element link) {
        String target = "Link to " + link.attr("href").strip();
        return link.selectFirst(IMAGES) != null
                ? target + " has no accessible text: its image has no alt text."
                : target + " has no accessible text.";
    }
}
