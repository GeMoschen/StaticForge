package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.ParsedOutput;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0202} "Title length" (M30.2.2): between {@code min} (10) and {@code max} (60) characters. */
@Component
public class TitleLengthRule extends TextLengthRule {

    public TitleLengthRule() {
        super("Title", 10, 60);
    }

    @Override
    public String code() {
        return "SF-CHK-0202";
    }

    @Override
    public String name() {
        return "Title length";
    }

    @Override
    public String description() {
        return "The <title> is shorter or longer than the configured range (10 to 60 characters by default). Search "
                + "engines cut long titles in their results; very short ones say little. Adjust the page's title "
                + "field, or how the template composes the title.";
    }

    @Override
    String text(ParsedOutput output) {
        return output.facts().title();
    }

    @Override
    Element element(ParsedOutput output) {
        return SeoText.title(output.document());
    }
}
