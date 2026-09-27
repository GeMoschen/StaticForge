package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0207} "No {@code h1}" (M30.2.2). */
@Component
public class MissingH1Rule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0207";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "No h1 heading";
    }

    @Override
    public String description() {
        return "The page has no <h1>. The main heading tells readers, screen readers and search engines what the "
                + "page is about. Render the page's headline as <h1> in the template.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.facts().h1Count() == 0 ? List.of(context.finding("The page has no h1 heading.")) : List.of();
    }
}
