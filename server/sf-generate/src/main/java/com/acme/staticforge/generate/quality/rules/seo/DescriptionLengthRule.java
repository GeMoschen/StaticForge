package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityFixHint;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/** {@code SF-CHK-0204} "Meta description length" (M30.2.2): between {@code min} (50) and {@code max} (160) characters. */
@Component
public class DescriptionLengthRule extends TextLengthRule {

    public DescriptionLengthRule() {
        super("Meta description", 50, 160);
    }

    @Override
    public String code() {
        return "SF-CHK-0204";
    }

    @Override
    public String name() {
        return "Meta description length";
    }

    @Override
    public String description() {
        return "The meta description is shorter or longer than the configured range (50 to 160 characters by "
                + "default). Search engines cut long descriptions; short ones get replaced by text from the page. "
                + "Adjust the page's description field.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT;
    }

    @Override
    String text(ParsedOutput output) {
        return output.facts().metaDescription();
    }

    @Override
    Element element(ParsedOutput output) {
        return SeoText.meta(output.document(), "description");
    }
}
