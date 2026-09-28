package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.project.LocaleConfig;
import java.util.List;
import java.util.Locale;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0209} "{@code lang} doesn't match the render locale" (M30.2.2): the primary subtag of
 * {@code <html lang>} must be the language of the locale the output was rendered in — {@code lang="de"} and
 * {@code lang="de-CH"} both fit a {@code de-CH} output, {@code lang="en"} doesn't. Only in a localized project; a
 * missing {@code lang} is {@code SF-CHK-0308}'s finding, not this one's.
 */
@Component
public class LangMismatchRule implements PageRule {

    @Override
    public String code() {
        return "SF-CHK-0209";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Language attribute doesn't match the page's language";
    }

    @Override
    public String description() {
        return "In a project with languages, the <html lang> of an output names another language than the one it "
                + "was rendered in. Write lang=\"$CMS_META(language)$\" in the page template instead of a fixed value.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        String locale = output.key().locale();
        String lang = output.facts().lang();
        if (!context.environment().localized() || locale == null || lang == null || lang.isBlank()) {
            return List.of();
        }
        String expected = LocaleConfig.language(locale);
        String primary = lang.strip().split("[-_]", 2)[0];
        if (expected == null || primary.equalsIgnoreCase(expected)) {
            return List.of();
        }
        String message = "<html lang=\"" + lang.strip() + "\"> doesn't match the page's language " + locale
                + ": expected \"" + expected.toLowerCase(Locale.ROOT) + "\" or a tag starting with it.";
        Element html = output.document().selectFirst("html");
        return List.of(html == null ? context.finding(message) : context.finding(html, message));
    }
}
