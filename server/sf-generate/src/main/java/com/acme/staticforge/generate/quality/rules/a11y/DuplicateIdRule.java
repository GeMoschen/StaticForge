package com.acme.staticforge.generate.quality.rules.a11y;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0305} "Duplicate id" (M30.2.3): an {@code id} value (as written, case-sensitive) used by more than one
 * element of the document. One finding per duplicated value, on its second element, with the count — labels,
 * {@code aria-labelledby} and {@code #fragment} links all reach only the first.
 */
@Component
public class DuplicateIdRule implements PageRule {

    public static final String CODE = "SF-CHK-0305";

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
        return "Duplicate id";
    }

    @Override
    public String description() {
        return "An id is used by more than one element of the page, so labels, aria-labelledby and #anchor links "
                + "reach only the first. Usually a template, or a section rendered more than once, writes a fixed id. "
                + "Fix in the template: derive the id from the section or item.";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        Map<String, List<Element>> byId = new LinkedHashMap<>();
        for (Element element : output.document().getAllElements()) {
            if (!element.id().isEmpty()) {
                byId.computeIfAbsent(element.id(), id -> new ArrayList<>()).add(element);
            }
        }
        List<Finding> findings = new ArrayList<>();
        byId.forEach((id, elements) -> {
            if (elements.size() > 1) {
                findings.add(context.finding(
                        elements.get(1), "Duplicate id \"" + id + "\": used " + elements.size() + " times."));
            }
        });
        return findings;
    }
}
