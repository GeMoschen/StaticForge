package com.acme.staticforge.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

/**
 * Every quality rule with the project's configuration (M30.1.2, epic decision 4).
 *
 * @param rules every rule, in code order
 */
public record QualityRulesView(List<QualityRuleItem> rules) {

    /**
     * One rule.
     *
     * @param kind {@code PAGE} (one output at a time) or {@code SITE} (the whole build)
     * @param defaultSeverity the severity without configuration
     * @param severity the configured severity ({@code OFF}, {@code WARNING}, {@code ERROR})
     * @param maxSeverity the highest severity findings get whatever is configured: {@code WARNING} for rules that never
     *     hold a page back
     * @param channels which outputs the rule checks
     */
    public record QualityRuleItem(
            String code,
            String name,
            String category,
            String kind,
            String description,
            String defaultSeverity,
            String severity,
            String maxSeverity,
            List<QualityRuleParam> params,
            String channels) {}

    /**
     * One parameter: {@code value} is the configured value, {@code defaultValue} the rule's default (an integer or a
     * boolean, per {@code type}); {@code min}/{@code max} bound an integer.
     */
    public record QualityRuleParam(
            String name,
            String type,
            @Schema(oneOf = {Integer.class, Boolean.class}) Object value,
            @Schema(oneOf = {Integer.class, Boolean.class}) Object defaultValue,
            Integer min,
            Integer max,
            String description) {}
}
