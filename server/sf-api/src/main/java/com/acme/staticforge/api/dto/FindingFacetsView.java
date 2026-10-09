package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;

/**
 * Facet counts of a run's findings (M35.24). Each facet counts the findings that pass every filter but its own, so
 * picking a value never zeroes the other values of the same facet while the other facets follow the pick. {@code total}
 * is the size of the list with all filters. {@code severity} (keys {@code WARNING}, {@code ERROR}) and {@code category}
 * (keys {@code LINKS}, {@code SEO}, {@code ACCESSIBILITY}) always carry every key; {@code code} lists the rules that
 * have findings, by code; {@code locale} maps each language with findings to its count.
 */
public record FindingFacetsView(
        long total,
        Map<String, Long> severity,
        Map<String, Long> category,
        List<RuleFacet> code,
        Map<String, Long> locale) {

    /** {@code name} is the rule's name; {@code null} for a code the application no longer knows. */
    public record RuleFacet(String code, String name, long count) {}
}
