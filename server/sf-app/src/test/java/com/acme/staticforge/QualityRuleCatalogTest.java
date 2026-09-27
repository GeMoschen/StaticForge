package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleRegistry;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The production rule set is exactly the M30 rule catalogue ({@code tasks/30-…/02-rules/README.md}): every code, its
 * kind (page or site rule), the default severity and the fix hint the UI shows. A rule added, dropped or left on the
 * {@code TEMPLATE} default hint by accident fails here.
 */
@SpringBootTest
@ActiveProfiles("test")
class QualityRuleCatalogTest {

    private record Entry(Kind kind, QualityFixHint hint) {}

    private enum Kind {
        PAGE,
        SITE
    }

    private static final Map<String, Entry> CATALOGUE = new LinkedHashMap<>();

    static {
        page("SF-CHK-0001", QualityFixHint.TEMPLATE);
        site("SF-CHK-0101", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0102", QualityFixHint.TEMPLATE);
        site("SF-CHK-0103", QualityFixHint.CONTENT);
        site("SF-CHK-0104", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0105", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0106", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0107", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0108", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0109", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0201", QualityFixHint.TEMPLATE);
        page("SF-CHK-0202", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0203", QualityFixHint.TEMPLATE);
        page("SF-CHK-0204", QualityFixHint.CONTENT);
        site("SF-CHK-0205", QualityFixHint.CONTENT_OR_TEMPLATE);
        site("SF-CHK-0206", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0207", QualityFixHint.TEMPLATE);
        page("SF-CHK-0208", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0209", QualityFixHint.TEMPLATE);
        site("SF-CHK-0210", QualityFixHint.TEMPLATE);
        site("SF-CHK-0211", QualityFixHint.TEMPLATE);
        page("SF-CHK-0212", QualityFixHint.TEMPLATE);
        page("SF-CHK-0301", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0302", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0303", QualityFixHint.TEMPLATE);
        page("SF-CHK-0304", QualityFixHint.CONTENT_OR_TEMPLATE);
        page("SF-CHK-0305", QualityFixHint.TEMPLATE);
        page("SF-CHK-0306", QualityFixHint.TEMPLATE);
        page("SF-CHK-0307", QualityFixHint.TEMPLATE);
        page("SF-CHK-0308", QualityFixHint.TEMPLATE);
    }

    private static void page(String code, QualityFixHint hint) {
        CATALOGUE.put(code, new Entry(Kind.PAGE, hint));
    }

    private static void site(String code, QualityFixHint hint) {
        CATALOGUE.put(code, new Entry(Kind.SITE, hint));
    }

    @Autowired QualityRuleRegistry registry;

    @Test
    void theProductionRulesAreExactlyTheCatalogue() {
        Map<String, Entry> actual = registry.all().stream()
                .collect(Collectors.toMap(QualityRule::code, QualityRuleCatalogTest::entry, (a, b) -> a,
                        LinkedHashMap::new));

        assertThat(actual).containsExactlyInAnyOrderEntriesOf(CATALOGUE);
    }

    @Test
    void everyRuleDefaultsToWarningAndDescribesItself() {
        assertThat(registry.all()).allSatisfy(rule -> {
            assertThat(rule.defaultSeverity()).as(rule.code()).isEqualTo(QualitySeverity.WARNING);
            assertThat(rule.name()).as(rule.code()).isNotBlank();
            assertThat(rule.description()).as(rule.code()).isNotBlank();
        });
    }

    /**
     * The rules that can never hold a page back, which the Quality tab shows with their Error option disabled
     * ({@code maxSeverity} in {@code GET /quality-rules}): the checker's own problem and the two rules that run after
     * the hold-back (epic decision 6). Every other rule can be an error.
     */
    @Test
    void onlyTheCheckerAndTheRulesAfterTheHoldBackAreCappedAtWarning() {
        Map<String, QualitySeverity> capped = registry.all().stream()
                .filter(rule -> rule.maxSeverity() != QualitySeverity.ERROR)
                .collect(Collectors.toMap(QualityRule::code, QualityRule::maxSeverity));

        assertThat(capped).containsOnly(
                Map.entry("SF-CHK-0001", QualitySeverity.WARNING),
                Map.entry("SF-CHK-0103", QualitySeverity.WARNING),
                Map.entry("SF-CHK-0210", QualitySeverity.WARNING));
    }

    private static Entry entry(QualityRule rule) {
        Kind kind = rule instanceof SiteRule ? Kind.SITE : rule instanceof PageRule ? Kind.PAGE : null;
        return new Entry(kind, rule.fixHint());
    }
}
