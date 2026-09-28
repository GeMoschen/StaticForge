package com.acme.staticforge.generate.quality;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Runs the enabled site rules of one phase over a build's {@link SiteIndex} (M30, epic decision 6): first the rules
 * that decide the hold-back, then — over the index with the held-back set — the rules that report on it.
 *
 * <p>A site rule that fails is logged and skipped: a checker problem never fails a run.
 */
@Component
public class SiteRuleRunner {

    private static final Logger log = LoggerFactory.getLogger(SiteRuleRunner.class);

    private final QualityRuleRegistry registry;

    public SiteRuleRunner(QualityRuleRegistry registry) {
        this.registry = registry;
    }

    /**
     * The findings of the enabled site rules of one phase, in rule order.
     *
     * @param afterHoldBack {@code false} for the rules that run before the hold-back, {@code true} for the others
     */
    public List<Finding> run(SiteIndex site, EffectiveQualityConfig config, boolean afterHoldBack) {
        return run(site, config, afterHoldBack, rule -> true);
    }

    /**
     * As {@link #run(SiteIndex, EffectiveQualityConfig, boolean)}, running only the rules {@code include} accepts — a
     * draft check (M30.3.1) leaves out the rules that need the whole build.
     */
    public List<Finding> run(
            SiteIndex site, EffectiveQualityConfig config, boolean afterHoldBack, Predicate<SiteRule> include) {
        List<Finding> findings = new ArrayList<>();
        for (SiteRule rule : registry.siteRules()) {
            if (rule.afterHoldBack() != afterHoldBack || !config.enabled(rule) || !include.test(rule)) {
                continue;
            }
            try {
                findings.addAll(rule.check(site, RuleContext.forSite(rule, config, site.environment())));
            } catch (RuntimeException | StackOverflowError e) {
                log.warn("Quality rule {} failed over the site; its findings are missing from this build", rule.code(), e);
            }
        }
        return findings;
    }
}
