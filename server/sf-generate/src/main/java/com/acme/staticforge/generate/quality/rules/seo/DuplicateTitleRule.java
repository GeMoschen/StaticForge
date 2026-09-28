package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.QualityFixHint;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0205} "Duplicate title (same channel and locale)" (M30.2.2). */
@Component
public class DuplicateTitleRule extends DuplicateTextRule {

    public DuplicateTitleRule() {
        super("Title");
    }

    @Override
    public String code() {
        return "SF-CHK-0205";
    }

    @Override
    public String name() {
        return "Duplicate title";
    }

    @Override
    public String description() {
        return "Several pages of one channel and language have the same <title>, so search results can't tell them "
                + "apart. Each finding names the other pages. Give each page its own title; on a paginated page add "
                + "the page number ($CMS_META(pageNumber)$).";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    String text(HtmlFacts facts) {
        return facts.title();
    }
}
