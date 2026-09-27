package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0201} "Missing or empty {@code <title>}" (M30.2.2). */
@Component
public class MissingTitleRule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0201";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Missing or empty title";
    }

    @Override
    public String description() {
        return "The page has no <title>, or an empty one. Search engines show the title as the result's headline, "
                + "browsers as the tab name. Write it in the page template, usually from a page field or the "
                + "display name ($CMS_META(displayName)$).";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        String title = output.facts().title();
        if (title == null) {
            return List.of(context.finding("The page has no <title>."));
        }
        if (title.isBlank()) {
            Element element = SeoText.title(output.document());
            String message = "The <title> is empty.";
            return List.of(element == null ? context.finding(message) : context.finding(element, message));
        }
        return List.of();
    }
}
