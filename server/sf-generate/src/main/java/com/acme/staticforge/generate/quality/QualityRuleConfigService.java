package com.acme.staticforge.generate.quality;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.Map;

/**
 * A project's quality rule configuration (M30.1.2, epic decision 4): each rule off, warning or error, with its
 * parameters. Read by every build and by the settings API; written by developers (the templates own the markup).
 */
public interface QualityRuleConfigService {

    /** The effective configuration of project {@code projectId}: the registry's defaults overlaid with what it stored. */
    EffectiveQualityConfig effective(long projectId);

    /** The effective configuration of project {@code projectKey}. */
    EffectiveQualityConfig effective(String projectKey);

    /**
     * Replaces the project's configuration with {@code entries} (a rule missing from it is at its default) and stores
     * only what differs from the defaults. A change is one revision (a {@code PROJECT} summary entry naming
     * {@code qualityRules}) and one audit entry {@code QUALITY_RULES_UPDATED} listing the changed codes; a request that
     * changes nothing writes neither.
     *
     * @throws InvalidQualityConfigException with one message per invalid entry (unknown code, bad severity, parameter
     *     unknown or out of bounds); nothing is stored
     * @throws com.acme.staticforge.common.SfException {@code 409 SF-DOM-0141} for an archived project
     */
    EffectiveQualityConfig update(String projectKey, Map<String, QualityRuleConfig.Entry> entries, RevisionContext ctx);

    /** Whether the project's quality rule configuration changed in a revision after {@code revision}. */
    boolean qualityRulesChangedSince(long projectId, long revision);

    /** A configuration that doesn't validate: one message per invalid entry. */
    final class InvalidQualityConfigException extends RuntimeException {

        private final List<String> errors;

        public InvalidQualityConfigException(List<String> errors) {
            super("Invalid quality rule configuration: " + String.join(" ", errors));
            this.errors = List.copyOf(errors);
        }

        public List<String> errors() {
            return errors;
        }
    }
}
