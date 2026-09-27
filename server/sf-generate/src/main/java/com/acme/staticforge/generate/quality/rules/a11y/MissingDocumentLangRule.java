package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0308} "{@code <html>} without {@code lang}" (M30.2.3): the document's {@code <html>} has no
 * {@code lang} attribute, or an empty one. One finding on the output as a whole. Whether the value matches the render
 * locale is {@code SF-CHK-0209}'s concern.
 */
@Component
public class MissingDocumentLangRule implements PageRule {

    public static final String CODE = "SF-CHK-0308";

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
        return "<html> without lang";
    }

    @Override
    public String description() {
        return "The page's <html> element has no lang attribute (or an empty one), so screen readers read it with "
                + "the wrong pronunciation. Fix in the template: write lang on <html>, in a localized project from the "
                + "render locale.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        String lang = output.facts().lang();
        return AccessibleNames.isBlank(lang)
                ? List.of(context.finding(lang == null
                        ? "<html> has no lang attribute."
                        : "<html> has an empty lang attribute."))
                : List.of();
    }
}
