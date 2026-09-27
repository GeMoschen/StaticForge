package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.RuleParam;
import java.util.List;
import java.util.Map;
import org.jsoup.nodes.Element;

/**
 * A length range for one text of the page — the title ({@code SF-CHK-0202}) or the meta description
 * ({@code SF-CHK-0204}), M30.2.2. The length is counted in code points of the whitespace-normalized text (an emoji or
 * an accented letter is one character). A missing or empty text is the business of its own rule, never of this one.
 */
abstract class TextLengthRule implements PageRule {

    static final String MIN = "min";
    static final String MAX = "max";

    /** The bounds of both parameters: anything a project could reasonably want. */
    private static final int LIMIT = 1_000;

    private final String subject;
    private final int defaultMin;
    private final int defaultMax;

    /**
     * @param subject what is measured, capitalized, for messages ("Title")
     */
    TextLengthRule(String subject, int defaultMin, int defaultMax) {
        this.subject = subject;
        this.defaultMin = defaultMin;
        this.defaultMax = defaultMax;
    }

    /** The text as the page states it; {@code null} when it has none. */
    abstract String text(ParsedOutput output);

    /** The element the text is in, for the finding's selector; {@code null} when not found. */
    abstract Element element(ParsedOutput output);

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public List<RuleParam> params() {
        return List.of(
                RuleParam.integer(MIN, defaultMin, 0, LIMIT, "The fewest characters, inclusive."),
                RuleParam.integer(MAX, defaultMax, 1, LIMIT, "The most characters, inclusive."));
    }

    @Override
    public String paramsProblem(Map<String, Object> params) {
        if (params.get(MIN) instanceof Integer min && params.get(MAX) instanceof Integer max && min > max) {
            return "min (" + min + ") must not be greater than max (" + max + ")";
        }
        return null;
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        String text = SeoText.normalize(text(output));
        if (SeoText.blank(text)) {
            return List.of();
        }
        int length = SeoText.length(text);
        int min = context.intParam(MIN);
        int max = context.intParam(MAX);
        String problem;
        if (length < min) {
            problem = "is too short: " + length + " characters, at least " + min + " recommended.";
        } else if (length > max) {
            problem = "is too long: " + length + " characters, at most " + max + " recommended.";
        } else {
            return List.of();
        }
        String message = subject + " \"" + text + "\" " + problem;
        Element element = element(output);
        return List.of(element == null ? context.finding(message) : context.finding(element, message));
    }
}
