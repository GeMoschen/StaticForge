package com.acme.staticforge.generate.quality;

import java.util.Locale;

/**
 * What a quality rule looks at (M30, epic decision 3). The code range tells the category: {@code SF-CHK-01xx} links,
 * {@code 02xx} SEO, {@code 03xx} accessibility; {@code 00xx} are the framework's own codes and may be any of them.
 */
public enum QualityCategory {
    /** Internal link integrity: missing targets, anchors, held-back or unreleased pages. */
    LINKS,
    /** Search-engine basics: title, description, headings, language, alternates, canonical. */
    SEO,
    /** What static markup can answer about accessibility: text alternatives, names, heading order, ids. */
    ACCESSIBILITY;

    /** The lower-case name used in JSON counts and filters ({@code links}, {@code seo}, {@code accessibility}). */
    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The category named {@code value} by name or key, case-insensitively; {@code null} when there is none. */
    public static QualityCategory parse(String value) {
        if (value == null) {
            return null;
        }
        for (QualityCategory category : values()) {
            if (category.name().equalsIgnoreCase(value.trim())) {
                return category;
            }
        }
        return null;
    }
}
