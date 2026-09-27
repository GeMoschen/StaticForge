package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.generate.quality.rules.OutputNotCheckedRule;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** The rule set is checked when the registry is created, i.e. at application start-up (M30.1.1). */
class QualityRuleRegistryTest {

    private static PageRule page(String code, QualityCategory category) {
        return TestRules.page(code, category, (output, context) -> List.of());
    }

    @Test
    void duplicateCodesFailTheApplicationContextAtStartUp() {
        new ApplicationContextRunner()
                .withBean(QualityRuleRegistry.class)
                .withBean("first", QualityRule.class, () -> page("SF-CHK-0201", QualityCategory.SEO))
                .withBean("second", QualityRule.class, () -> page("SF-CHK-0201", QualityCategory.SEO))
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).rootCause()
                            .isInstanceOf(IllegalStateException.class)
                            .hasMessageContaining("Duplicate quality rule code SF-CHK-0201");
                });
    }

    @Test
    void aValidRuleSetStartsAndIsSortedByCode() {
        new ApplicationContextRunner()
                .withBean(QualityRuleRegistry.class)
                .withBean(OutputNotCheckedRule.class)
                .withBean("seo", QualityRule.class, () -> page("SF-CHK-0201", QualityCategory.SEO))
                .withBean("links", QualityRule.class, () -> TestRules.site(
                        "SF-CHK-0101", QualityCategory.LINKS, false, (site, context) -> List.of()))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    QualityRuleRegistry registry = context.getBean(QualityRuleRegistry.class);
                    assertThat(registry.all()).extracting(QualityRule::code)
                            .containsExactly("SF-CHK-0001", "SF-CHK-0101", "SF-CHK-0201");
                    assertThat(registry.pageRules()).extracting(QualityRule::code).containsExactly("SF-CHK-0001", "SF-CHK-0201");
                    assertThat(registry.siteRules()).extracting(QualityRule::code).containsExactly("SF-CHK-0101");
                    assertThat(registry.find("SF-CHK-0201")).isPresent();
                    assertThat(registry.find("SF-CHK-0999")).isEmpty();
                });
    }

    @Test
    void codesMustBeWellFormedAndInTheirCategorysRange() {
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(page("SF-CHK-201", QualityCategory.SEO))))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("invalid code");
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(page("SF-GEN-0201", QualityCategory.SEO))))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("invalid code");
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(page("SF-CHK-0301", QualityCategory.SEO))))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("ACCESSIBILITY range");
    }

    @Test
    void aRuleIsExactlyOneShapeAndDefaultsWithinItsMaximum() {
        QualityRule neither = new QualityRule() {
            @Override
            public String code() {
                return "SF-CHK-0102";
            }

            @Override
            public QualityCategory category() {
                return QualityCategory.LINKS;
            }

            @Override
            public String name() {
                return "Neither";
            }

            @Override
            public String description() {
                return "";
            }
        };
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(neither)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("exactly one of PageRule and SiteRule");

        SiteRule afterHoldBack = new SiteRule() {
            @Override
            public String code() {
                return "SF-CHK-0103";
            }

            @Override
            public QualityCategory category() {
                return QualityCategory.LINKS;
            }

            @Override
            public String name() {
                return "Capped";
            }

            @Override
            public String description() {
                return "";
            }

            @Override
            public boolean afterHoldBack() {
                return true;
            }

            @Override
            public QualitySeverity defaultSeverity() {
                return QualitySeverity.ERROR;
            }

            @Override
            public List<Finding> check(SiteIndex site, RuleContext context) {
                return List.of();
            }
        };
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(afterHoldBack)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("above its maximum");
    }

    @Test
    void parameterNamesAreUniquePerRule() {
        PageRule twice = TestRules.page("SF-CHK-0202", QualityCategory.SEO, (output, context) -> List.of(),
                RuleParam.integer("min", 10, 0, 100, ""), RuleParam.integer("min", 5, 0, 100, ""));
        assertThatThrownBy(() -> new QualityRuleRegistry(List.of(twice)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("parameter 'min' twice");
    }

    @Test
    void aParameterDefaultMustBeWithinItsBounds() {
        assertThatThrownBy(() -> RuleParam.integer("max", 500, 0, 100, ""))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("must be at most 100");
        assertThat(RuleParam.integer("max", 60, 1, 200, "").problemWith(0)).isEqualTo("must be at least 1");
        assertThat(RuleParam.integer("max", 60, 1, 200, "").problemWith("60")).isEqualTo("must be an integer");
        assertThat(RuleParam.bool("required", false, "").problemWith(1)).isEqualTo("must be true or false");
        assertThat(RuleParam.bool("required", false, "").problemWith(true)).isNull();
    }
}
