package com.acme.staticforge.generate.quality.rules;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityCodes;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0001} "Output could not be checked" (M30, epic decision 19): the framework's own finding when an output
 * can't be parsed or a rule fails on it. It is a rule so that projects can see and silence it like any other; the
 * finding itself is made by {@link com.acme.staticforge.generate.quality.PageRuleRunner}, never by {@link #check}. It
 * is capped at {@code WARNING}: a checker problem never holds a page back and never fails a run.
 */
@Component
public class OutputNotCheckedRule implements PageRule {

    @Override
    public String code() {
        return QualityCodes.OUTPUT_NOT_CHECKED;
    }

    /** Listed with the link rules: nothing on an unchecked output — its links least of all — was checked. */
    @Override
    public QualityCategory category() {
        return QualityCategory.LINKS;
    }

    @Override
    public String name() {
        return "Output could not be checked";
    }

    @Override
    public String description() {
        return "The output could not be parsed, or a check failed on it, so some or all rules did not run for it. "
                + "The message names the cause. Usually a malformed or very large document: fix it in the template.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.TEMPLATE;
    }

    @Override
    public QualitySeverity maxSeverity() {
        return QualitySeverity.WARNING;
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        return List.of();
    }
}
