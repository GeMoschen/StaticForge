package com.acme.staticforge.generate.quality;

import java.util.List;
import java.util.Map;

/**
 * A build-time check over rendered HTML (M30, epic decision 3). Every rule is a Spring bean collected by
 * {@link QualityRuleRegistry}; the list is fixed in code — projects configure a rule's severity and parameters, they
 * don't add rules. A rule has exactly one of two shapes:
 * <ul>
 *   <li>{@link PageRule}: looks at one parsed output (its jsoup document and facts) — title, {@code h1}, {@code alt};</li>
 *   <li>{@link SiteRule}: looks at the facts of every output of the build — duplicates, links, anchors, alternates.</li>
 * </ul>
 *
 * <p>Rules only read: they never change the document or the output bytes. They create their findings through the
 * {@link RuleContext} they are handed, which fills in the code, category, effective severity, output, selector and
 * section.
 */
public interface QualityRule {

    /** {@code SF-CHK-0xyz}: links {@code 01xx}, SEO {@code 02xx}, accessibility {@code 03xx}. Unique. */
    String code();

    QualityCategory category();

    /** A short name for lists ("Image without alt attribute"). */
    String name();

    /**
     * What the rule reports and how to fix it — in the content (alt text on the media) or in the template (a hard-coded
     * icon link) — for the settings UI.
     */
    String description();

    /** The severity when the project configures none. */
    default QualitySeverity defaultSeverity() {
        return QualitySeverity.WARNING;
    }

    /**
     * The highest severity the rule's findings ever get, whatever the project configures: {@code WARNING} for a rule
     * that must never hold a page back.
     */
    default QualitySeverity maxSeverity() {
        return QualitySeverity.ERROR;
    }

    /** The rule's parameters with their defaults and bounds; empty for most rules. */
    default List<RuleParam> params() {
        return List.of();
    }

    /**
     * Why the parameter values {@code params} don't fit together (a length range whose {@code min} exceeds its
     * {@code max}), as a message fragment; {@code null} when they do. Each value is already within its own bounds.
     *
     * @param params every parameter's effective value, by name
     */
    default String paramsProblem(Map<String, Object> params) {
        return null;
    }
}
