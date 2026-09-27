package com.acme.staticforge.generate.quality;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The fixed list of quality rules (M30, epic decision 3): Spring collects every {@link QualityRule} bean. The list is
 * checked at start-up — a broken rule set fails the application context instead of a build:
 * <ul>
 *   <li>codes match {@code SF-CHK-dddd} and are unique;</li>
 *   <li>the code range matches the category ({@code 01xx} links, {@code 02xx} SEO, {@code 03xx} accessibility);</li>
 *   <li>each rule is exactly one of {@link PageRule} and {@link SiteRule};</li>
 *   <li>the default severity is not above the rule's maximum, and parameter names are unique per rule.</li>
 * </ul>
 */
@Component
public class QualityRuleRegistry {

    private static final Pattern CODE = Pattern.compile("SF-CHK-\\d{4}");

    private final Map<String, QualityRule> byCode;
    private final List<QualityRule> all;
    private final List<PageRule> pageRules;
    private final List<SiteRule> siteRules;

    /**
     * @throws IllegalStateException when the rule set breaks one of the invariants above
     */
    public QualityRuleRegistry(List<QualityRule> rules) {
        Map<String, QualityRule> codes = new TreeMap<>();
        for (QualityRule rule : rules) {
            validate(rule);
            QualityRule previous = codes.putIfAbsent(rule.code(), rule);
            if (previous != null) {
                throw new IllegalStateException("Duplicate quality rule code " + rule.code() + ": "
                        + previous.getClass().getName() + " and " + rule.getClass().getName());
            }
        }
        this.byCode = Map.copyOf(codes);
        this.all = List.copyOf(codes.values());
        List<PageRule> pages = new ArrayList<>();
        List<SiteRule> sites = new ArrayList<>();
        for (QualityRule rule : all) {
            if (rule instanceof PageRule page) {
                pages.add(page);
            } else {
                sites.add((SiteRule) rule);
            }
        }
        pages.sort(Comparator.comparing(QualityRule::code));
        sites.sort(Comparator.comparing(QualityRule::code));
        this.pageRules = List.copyOf(pages);
        this.siteRules = List.copyOf(sites);
    }

    private static void validate(QualityRule rule) {
        String code = rule.code();
        String name = rule.getClass().getName();
        if (code == null || !CODE.matcher(code).matches()) {
            throw new IllegalStateException("Quality rule " + name + " has an invalid code '" + code + "'.");
        }
        if (rule.category() == null || rule.name() == null || rule.name().isBlank()) {
            throw new IllegalStateException("Quality rule " + code + " needs a category and a name.");
        }
        QualityCategory expected = switch (code.substring(7, 9)) {
            case "01" -> QualityCategory.LINKS;
            case "02" -> QualityCategory.SEO;
            case "03" -> QualityCategory.ACCESSIBILITY;
            default -> null;
        };
        if (expected != null && expected != rule.category()) {
            throw new IllegalStateException("Quality rule " + code + " is in the " + expected + " range but declares "
                    + rule.category() + ".");
        }
        boolean page = rule instanceof PageRule;
        boolean site = rule instanceof SiteRule;
        if (page == site) {
            throw new IllegalStateException(
                    "Quality rule " + code + " must be exactly one of PageRule and SiteRule (" + name + ").");
        }
        if (rule.defaultSeverity() == null || rule.maxSeverity() == null
                || rule.defaultSeverity().compareTo(rule.maxSeverity()) > 0) {
            throw new IllegalStateException("Quality rule " + code + " defaults above its maximum severity.");
        }
        Set<String> params = new HashSet<>();
        for (RuleParam param : rule.params()) {
            if (!params.add(param.name())) {
                throw new IllegalStateException("Quality rule " + code + " declares parameter '" + param.name()
                        + "' twice.");
            }
        }
    }

    /** Every rule, in code order. */
    public List<QualityRule> all() {
        return all;
    }

    /** The page-local rules, in code order. */
    public List<PageRule> pageRules() {
        return pageRules;
    }

    /** The site-wide rules, in code order. */
    public List<SiteRule> siteRules() {
        return siteRules;
    }

    /** The rule with {@code code}. */
    public Optional<QualityRule> find(String code) {
        return Optional.ofNullable(code == null ? null : byCode.get(code));
    }

    /** Every registered code. */
    public Set<String> codes() {
        return byCode.keySet();
    }
}
