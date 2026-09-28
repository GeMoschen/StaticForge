package com.acme.staticforge.generate.quality;

import java.util.Map;
import java.util.Objects;
import org.jsoup.nodes.Element;

/**
 * What one rule invocation gets besides its input (M30.1.1): the rule's effective severity and typed parameter values,
 * the {@link CheckEnvironment}, and the finding factory, which fills in the code, category, severity, output, selector
 * and section instance so a rule only writes the message.
 *
 * <p>A page rule's context is bound to the output it checks ({@link #output()}); a site rule's isn't, and names the
 * output of each finding.
 */
public final class RuleContext {

    private final QualityRule rule;
    private final QualitySeverity severity;
    private final Map<String, Object> params;
    private final CheckEnvironment environment;
    private final ParsedOutput output;

    private RuleContext(
            QualityRule rule,
            QualitySeverity severity,
            Map<String, Object> params,
            CheckEnvironment environment,
            ParsedOutput output) {
        this.rule = Objects.requireNonNull(rule, "rule");
        this.severity = Objects.requireNonNull(severity, "severity");
        this.params = params == null ? Map.of() : params;
        this.environment = Objects.requireNonNull(environment, "environment");
        this.output = output;
    }

    /** The context of {@code rule} checking {@code output} under {@code config}. */
    public static RuleContext forPage(
            PageRule rule, EffectiveQualityConfig config, CheckEnvironment environment, ParsedOutput output) {
        return new RuleContext(rule, config.severity(rule), config.params(rule), environment, Objects.requireNonNull(output));
    }

    /** The context of {@code rule} checking a whole build under {@code config}. */
    public static RuleContext forSite(SiteRule rule, EffectiveQualityConfig config, CheckEnvironment environment) {
        return new RuleContext(rule, config.severity(rule), config.params(rule), environment, null);
    }

    /** The rule being run. */
    public QualityRule rule() {
        return rule;
    }

    public String code() {
        return rule.code();
    }

    /** The severity this rule's findings get: {@code WARNING} or {@code ERROR}. */
    public QualitySeverity severity() {
        return severity;
    }

    public CheckEnvironment environment() {
        return environment;
    }

    /** The output a page rule checks; {@code null} for a site rule. */
    public ParsedOutput output() {
        return output;
    }

    /**
     * The value of integer parameter {@code name}.
     *
     * @throws IllegalArgumentException when the rule declares no such integer parameter
     */
    public int intParam(String name) {
        if (params.get(name) instanceof Integer value) {
            return value;
        }
        throw new IllegalArgumentException(rule.code() + " has no integer parameter '" + name + "'.");
    }

    /**
     * The value of boolean parameter {@code name}.
     *
     * @throws IllegalArgumentException when the rule declares no such boolean parameter
     */
    public boolean boolParam(String name) {
        if (params.get(name) instanceof Boolean value) {
            return value;
        }
        throw new IllegalArgumentException(rule.code() + " has no boolean parameter '" + name + "'.");
    }

    /** A page rule's finding on {@code element} of the bound output: its selector and section are filled in. */
    public Finding finding(Element element, String message) {
        requirePage();
        return new Finding(output.key(), rule.code(), rule.category(), severity, message, output.selector(element),
                output.sectionOf(element), false);
    }

    /** A page rule's finding on the bound output as a whole (a missing {@code <title>}): no selector. */
    public Finding finding(String message) {
        requirePage();
        return new Finding(output.key(), rule.code(), rule.category(), severity, message, null, null, false);
    }

    /**
     * A finding on {@code target}, e.g. a site rule's, at {@code selector} ({@code null} for the whole output). Site
     * rules take the selector from the facts ({@link LinkRef#selector()}).
     */
    public Finding finding(OutputKey target, String selector, String message) {
        return new Finding(target, rule.code(), rule.category(), severity, message, selector, null, false);
    }

    private void requirePage() {
        if (output == null) {
            throw new IllegalStateException(rule.code() + ": a site rule names the output of each finding.");
        }
    }
}
