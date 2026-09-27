package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0203} "Missing meta description" (M30.2.2): none, or an empty one. */
@Component
public class MissingDescriptionRule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0203";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Missing meta description";
    }

    @Override
    public String description() {
        return "The page has no <meta name=\"description\">, or an empty one. Search engines often show it below the "
                + "result's title. Write it in the page template from a page field.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        String description = output.facts().metaDescription();
        if (description == null) {
            return List.of(context.finding("The page has no meta description."));
        }
        if (description.isBlank()) {
            Element element = SeoText.meta(output.document(), "description");
            String message = "The meta description is empty.";
            return List.of(element == null ? context.finding(message) : context.finding(element, message));
        }
        return List.of();
    }
}
