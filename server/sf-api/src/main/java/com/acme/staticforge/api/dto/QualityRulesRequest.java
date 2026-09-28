package com.acme.staticforge.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

/**
 * The whole quality rule configuration of a project (M30.1.2): a rule missing from {@code rules} is at its default.
 *
 * @param rules by code
 */
public record QualityRulesRequest(Map<String, QualityRuleSetting> rules) {

    /**
     * One rule's setting.
     *
     * @param severity {@code OFF}, {@code WARNING} or {@code ERROR}; {@code null} for the rule's default
     * @param params parameter values by name (integers or booleans); a missing one is at its default
     */
    public record QualityRuleSetting(
            String severity,
            @Schema(type = "object", additionalProperties = Schema.AdditionalPropertiesValue.TRUE)
                    Map<String, Object> params) {}
}
