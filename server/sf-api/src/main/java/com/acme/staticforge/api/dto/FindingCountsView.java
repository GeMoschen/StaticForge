package com.acme.staticforge.api.dto;

import java.util.Map;

/**
 * A run's quality check findings in numbers (M30.1.2): {@code errors} and {@code warnings} count every finding of the
 * run, {@code byCategory} splits them by category ({@code links}, {@code seo}, {@code accessibility}), {@code truncated}
 * is how many the storage caps didn't store.
 */
public record FindingCountsView(int errors, int warnings, Map<String, Integer> byCategory, int truncated) {}
