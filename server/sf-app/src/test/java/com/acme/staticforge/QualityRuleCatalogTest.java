package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleRegistry;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.SiteRule;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The production rule set is exactly the M30 rule catalogue ({@code tasks/30-…/02-rules/README.md}): every code, its
 * kind (page or site rule), the default severity and the fix hint the UI shows. A rule added, dropped or left on the
 * {@code TEMPLATE} default hint by accident fails here, and so does one the specification's catalogue
 * ({@code cms-specification.md} §18.8) doesn't describe as registered.
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

    /** The columns of the specification's catalogue: code, name, category, kind, fix hint, parameters, maximum severity. */
    private static final int SPEC_COLUMNS = 7;

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
     * The rule catalogue of {@code cms-specification.md} §18.8 has one row per registered rule, and each row says what
     * {@code GET /quality-rules} serves: name, category, kind, fix hint, parameters with their defaults and the maximum
     * severity. A rule added, renamed or retuned without its doc row fails here.
     */
    @Test
    void theSpecificationCataloguesEveryRuleAsRegistered() throws IOException {
        Map<String, List<String>> rows = specificationCatalogue();

        assertThat(rows.keySet())
                .containsExactlyInAnyOrderElementsOf(registry.all().stream().map(QualityRule::code).toList());
        assertThat(registry.all()).allSatisfy(rule -> {
            List<String> cells = rows.get(rule.code());
            assertThat(cells).as(rule.code()).hasSize(SPEC_COLUMNS);
            assertThat(cells.get(1)).as(rule.code() + " name").isEqualTo(rule.name());
            assertThat(cells.get(2)).as(rule.code() + " category").isEqualTo(rule.category().name());
            assertThat(cells.get(3)).as(rule.code() + " kind").isEqualTo(rule instanceof SiteRule ? "site" : "page");
            assertThat(cells.get(4)).as(rule.code() + " fix hint").isEqualTo(rule.fixHint().name());
            if (rule.params().isEmpty()) {
                assertThat(cells.get(5)).as(rule.code() + " params").isEqualTo("—");
            } else {
                rule.params().forEach(param -> assertThat(cells.get(5))
                        .as(rule.code() + " param " + param.name())
                        .contains(param.name() + " " + param.defaultValue()));
            }
            assertThat(cells.get(6)).as(rule.code() + " max severity").isEqualTo(rule.maxSeverity().name());
        });
    }

    /** The rows of the §18.8 catalogue table by code, each cell trimmed and without backticks. */
    private static Map<String, List<String>> specificationCatalogue() throws IOException {
        List<String> lines = Files.readAllLines(specification(), StandardCharsets.UTF_8);
        Map<String, List<String>> rows = new LinkedHashMap<>();
        boolean inSection = false;
        for (String line : lines) {
            if (line.startsWith("### ")) {
                inSection = line.startsWith("### 18.8 ");
                continue;
            }
            if (inSection && line.startsWith("| `SF-CHK-")) {
                String[] cells = line.substring(1, line.lastIndexOf('|')).split("\\|");
                List<String> row = Arrays.stream(cells).map(cell -> cell.replace("`", "").trim()).toList();
                assertThat(rows.put(row.get(0), row)).as("duplicate row " + row.get(0)).isNull();
            }
        }
        assertThat(rows).as("rule catalogue rows in §18.8 of " + specification()).isNotEmpty();
        return rows;
    }

    /** {@code cms-specification.md} at the repository root, found from the test's working directory upwards. */
    private static Path specification() {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("cms-specification.md");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("cms-specification.md not found above " + Path.of("").toAbsolutePath());
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
