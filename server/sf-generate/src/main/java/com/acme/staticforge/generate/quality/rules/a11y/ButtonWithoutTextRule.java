package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0303} "Button without accessible text" (M30.2.3): a {@code button} or an element with
 * {@code role=button} whose accessible name is empty, by the same test as {@code SF-CHK-0302} ({@link AccessibleNames}).
 * Buttons hidden from assistive technology are skipped.
 */
@Component
public class ButtonWithoutTextRule implements PageRule {

    public static final String CODE = "SF-CHK-0303";

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
        return "Button without accessible text";
    }

    @Override
    public String description() {
        return "A button (or an element with role=button) has no text a screen reader can announce: no text, "
                + "aria-label, aria-labelledby, image alt text or title — typically an icon-only button. Fix in the "
                + "template: add an aria-label or visually hidden text.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.document().select("button, [role=button]").stream()
                .filter(button -> !AccessibleNames.hidden(button) && !AccessibleNames.hasName(button))
                .map(button -> context.finding(button, message(button)))
                .toList();
    }

    private static String message(Element button) {
        return button.normalName().equals("button")
                ? "Button has no accessible text."
                : "<" + button.normalName() + " role=\"button\"> has no accessible text.";
    }
}
