package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.QualityFixHint;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0206} "Duplicate meta description" (same channel and locale, M30.2.2). */
@Component
public class DuplicateDescriptionRule extends DuplicateTextRule {

    public DuplicateDescriptionRule() {
        super("Meta description");
    }

    @Override
    public String code() {
        return "SF-CHK-0206";
    }

    @Override
    public String name() {
        return "Duplicate meta description";
    }

    @Override
    public String description() {
        return "Several pages of one channel and language have the same meta description. Each finding names the "
                + "other pages. Describe each page on its own, typically in a page field rather than a fixed text in "
                + "the template.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    String text(HtmlFacts facts) {
        return facts.metaDescription();
    }
}
