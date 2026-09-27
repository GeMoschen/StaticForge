package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import java.util.Locale;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0212} "{@code noIndex} page without a robots {@code noindex} meta" (M30.2.2, epic decision 12): a page
 * set to "Hide from search engines" is left out of the sitemap, but only {@code <meta name="robots" content="noindex">}
 * (or {@code none}) keeps a search engine that finds it anyway from indexing it.
 */
@Component
public class NoIndexRobotsRule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0212";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Hidden page without robots noindex";
    }

    @Override
    public String description() {
        return "The page is set to \"Hide from search engines\" (nav.noIndex), but its HTML has no <meta "
                + "name=\"robots\" content=\"noindex\">. The sitemap already leaves it out; add "
                + "$CMS_IF(CMS_META.noIndex)$<meta name=\"robots\" content=\"noindex\">$CMS_END_IF$ to the page "
                + "template's <head>.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        if (!context.environment().noIndex(output.key()) || forbidsIndexing(output.facts().robotsMeta())) {
            return List.of();
        }
        Element robots = SeoText.meta(output.document(), "robots");
        if (robots == null) {
            return List.of(context.finding(
                    "The page is hidden from search engines, but has no <meta name=\"robots\" content=\"noindex\">."));
        }
        return List.of(context.finding(robots, "The page is hidden from search engines, but its robots meta (\""
                + output.facts().robotsMeta() + "\") doesn't say noindex."));
    }

    /** Whether the robots directives contain {@code noindex} or {@code none} (= {@code noindex, nofollow}). */
    static boolean forbidsIndexing(String robots) {
        if (robots == null) {
            return false;
        }
        for (String directive : robots.toLowerCase(Locale.ROOT).split("[,\s]+")) {
            if (directive.equals("noindex") || directive.equals("none")) {
                return true;
            }
        }
        return false;
    }
}
