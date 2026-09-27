package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.ArrayList;
import java.util.List;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0208} "More than one {@code h1}" (M30.2.2): one finding on each {@code h1} after the first, so the
 * editor can jump to the section that renders it.
 */
@Component
public class MultipleH1Rule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0208";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "More than one h1 heading";
    }

    @Override
    public String description() {
        return "The page has several <h1> headings; it should have one main heading. Each heading after the first "
                + "is reported. Often a section template renders its title as <h1>: use <h2> there.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        if (output.facts().h1Count() < 2) {
            return List.of();
        }
        Elements headings = output.document().getElementsByTag("h1");
        List<Finding> findings = new ArrayList<>();
        for (int i = 1; i < headings.size(); i++) {
            findings.add(context.finding(headings.get(i), "h1 heading " + (i + 1) + " of " + headings.size()
                    + ": a page should have one."));
        }
        return findings;
    }
}
