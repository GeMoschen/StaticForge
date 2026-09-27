package com.acme.staticforge.generate.quality;

import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Runs the enabled page rules over one output (M30.1.1): parse once, extract the facts, run every page rule on that
 * one document. Usable outside a build — a draft check (M30.3.1) hands it a draft render and an environment of planned
 * paths — so it depends on nothing but the registry.
 *
 * <p>A document that can't be parsed, or a rule that fails on it, is an {@code SF-CHK-0001} warning on that output
 * (when the project hasn't switched it off), never an exception.
 */
@Component
public class PageRuleRunner {

    private static final Logger log = LoggerFactory.getLogger(PageRuleRunner.class);

    private final QualityRuleRegistry registry;

    public PageRuleRunner(QualityRuleRegistry registry) {
        this.registry = registry;
    }

    public QualityRuleRegistry registry() {
        return registry;
    }

    /**
     * One output's check.
     *
     * @param parsed the parsed output; {@code null} when it couldn't be parsed
     * @param facts its facts; {@code null} when it couldn't be parsed
     * @param findings the page rules' findings, in rule order
     */
    public record PageCheck(ParsedOutput parsed, HtmlFacts facts, List<Finding> findings) {

        public PageCheck {
            findings = findings == null ? List.of() : List.copyOf(findings);
        }
    }

    /** Parses {@code html} as output {@code key} and runs the enabled page rules on it. */
    public PageCheck check(OutputKey key, byte[] html, EffectiveQualityConfig config, CheckEnvironment environment) {
        ParsedOutput parsed;
        try {
            parsed = ParsedOutput.parse(key, html, environment.resolverFor(key.channel()));
        } catch (RuntimeException | StackOverflowError e) {
            log.warn("Could not parse output '{}' for the quality checks", key.path(), e);
            return new PageCheck(null, null, notChecked(key, config, "the document could not be parsed (" + describe(e) + ")."));
        }
        return new PageCheck(parsed, parsed.facts(), run(parsed, config, environment));
    }

    /** Runs the enabled page rules on an already parsed output. */
    public List<Finding> run(ParsedOutput output, EffectiveQualityConfig config, CheckEnvironment environment) {
        List<Finding> findings = new ArrayList<>();
        for (PageRule rule : registry.pageRules()) {
            if (!config.enabled(rule) || rule.code().equals(QualityCodes.OUTPUT_NOT_CHECKED)) {
                continue;
            }
            try {
                findings.addAll(rule.check(output, RuleContext.forPage(rule, config, environment, output)));
            } catch (RuntimeException | StackOverflowError e) {
                log.warn("Quality rule {} failed on output '{}'", rule.code(), output.path(), e);
                findings.addAll(notChecked(output.key(), config, "rule " + rule.code() + " failed (" + describe(e) + ")."));
            }
        }
        return findings;
    }

    /** The {@code SF-CHK-0001} finding on {@code key}; none when the project switched it off. */
    List<Finding> notChecked(OutputKey key, EffectiveQualityConfig config, String cause) {
        return registry.find(QualityCodes.OUTPUT_NOT_CHECKED)
                .filter(config::enabled)
                .map(rule -> List.of(new Finding(key, rule.code(), rule.category(), config.severity(rule),
                        "Output could not be checked: " + cause, null, null, false)))
                .orElse(List.of());
    }

    private static String describe(Throwable e) {
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }
}
