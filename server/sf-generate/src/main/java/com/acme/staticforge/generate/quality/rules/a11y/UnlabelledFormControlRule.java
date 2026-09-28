package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import java.util.Set;
import org.jsoup.nodes.Element;
import org.jsoup.select.Evaluator;
import org.jsoup.select.Selector;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0306} "Form control without label" (M30.2.3): an {@code input} (other than {@code hidden}, {@code
 * submit}, {@code button}, {@code reset} and {@code image}), {@code select} or {@code textarea} without a label: a
 * {@code label[for]} naming its id, a wrapping {@code label} (each with text besides the control), a resolving
 * {@code aria-labelledby}, an {@code aria-label} or a {@code title}. A {@code placeholder} is not a label. Controls
 * hidden from assistive technology are skipped.
 */
@Component
public class UnlabelledFormControlRule implements PageRule {

    public static final String CODE = "SF-CHK-0306";

    /** Input types that are labelled by their value or {@code alt}, or not shown at all. */
    private static final Set<String> SELF_LABELLED = Set.of("hidden", "submit", "button", "reset", "image");

    /** Parsed once: selecting by a query string would parse it for every document. */
    private static final Evaluator CONTROLS = Selector.evaluatorOf("input, select, textarea");

    private static final Evaluator LABELS_FOR = Selector.evaluatorOf("label[for]");

    private static final Evaluator LABEL = Selector.evaluatorOf("label");

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
        return "Form control without label";
    }

    @Override
    public String description() {
        return "A form field (input, select or textarea) has no label: no label element pointing at it or around it, "
                + "no aria-label, aria-labelledby or title. A placeholder is not a label. Fix in the template, which "
                + "writes the form.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return output.document().select(CONTROLS).stream()
                .filter(control -> !control.normalName().equals("input")
                        || !SELF_LABELLED.contains(AccessibleNames.type(control)))
                .filter(control -> !AccessibleNames.hidden(control) && !labelled(control))
                .map(control -> context.finding(control, describe(control) + " has no label."))
                .toList();
    }

    private static boolean labelled(Element control) {
        if (!AccessibleNames.isBlank(AccessibleNames.labelledBy(control))
                || !AccessibleNames.isBlank(control.attr("aria-label"))
                || !AccessibleNames.isBlank(control.attr("title"))) {
            return true;
        }
        Element wrapping = control.closest(LABEL);
        if (wrapping != null && !AccessibleNames.isBlank(AccessibleNames.content(wrapping))) {
            return true;
        }
        String id = control.id();
        return !id.isEmpty() && control.root().select(LABELS_FOR).stream()
                .anyMatch(label -> label.attr("for").equals(id)
                        && !AccessibleNames.isBlank(AccessibleNames.content(label)));
    }

    /** {@code <input type="email" name="mail">}: what the editor recognizes the control by. */
    private static String describe(Element control) {
        StringBuilder text = new StringBuilder("Form control <").append(control.normalName());
        if (control.normalName().equals("input")) {
            text.append(" type=\"").append(AccessibleNames.type(control)).append('"');
        }
        String name = control.attr("name").strip();
        if (!name.isEmpty()) {
            text.append(" name=\"").append(name).append('"');
        } else if (!control.id().isEmpty()) {
            text.append(" id=\"").append(control.id()).append('"');
        }
        return text.append('>').toString();
    }
}
