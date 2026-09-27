package com.acme.staticforge.generate.quality;

import java.util.List;
import java.util.function.BiFunction;

/** Small rules for the framework's own tests. */
final class TestRules {

    private TestRules() {}

    /** A page rule with {@code code} whose check is {@code check}. */
    static PageRule page(String code, QualityCategory category, BiFunction<ParsedOutput, RuleContext, List<Finding>> check,
            RuleParam... params) {
        return new PageRule() {
            @Override
            public String code() {
                return code;
            }

            @Override
            public QualityCategory category() {
                return category;
            }

            @Override
            public String name() {
                return "Test rule " + code;
            }

            @Override
            public String description() {
                return "A rule of the framework tests.";
            }

            @Override
            public List<RuleParam> params() {
                return List.of(params);
            }

            @Override
            public List<Finding> check(ParsedOutput output, RuleContext context) {
                return check.apply(output, context);
            }
        };
    }

    /** A site rule with {@code code} whose check is {@code check}. */
    static SiteRule site(String code, QualityCategory category, boolean afterHoldBack,
            BiFunction<SiteIndex, RuleContext, List<Finding>> check) {
        return new SiteRule() {
            @Override
            public String code() {
                return code;
            }

            @Override
            public QualityCategory category() {
                return category;
            }

            @Override
            public String name() {
                return "Test site rule " + code;
            }

            @Override
            public String description() {
                return "A site rule of the framework tests.";
            }

            @Override
            public boolean afterHoldBack() {
                return afterHoldBack;
            }

            @Override
            public List<Finding> check(SiteIndex site, RuleContext context) {
                return check.apply(site, context);
            }
        };
    }
}
