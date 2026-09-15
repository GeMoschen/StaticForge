package com.acme.staticforge.template.octl;

/**
 * How a template uses an {@code assetType:uid} reference (spec §16.4), so persisted reference
 * edges can say what a template does with its target.
 */
public enum ReferenceUse {
    /**
     * Reads a value of the target: {@code $CMS_VALUE(type:uid…)$} and asset accessors in
     * {@code $CMS_IF} conditions, {@code $CMS_SET} expressions and non-navigation {@code $CMS_FOR} sources.
     */
    VALUE,
    /**
     * Links to or walks the target: {@code $CMS_REF(type:uid)$}, {@code $CMS_NAVIGATION(nav:uid)$}
     * and {@code $CMS_FOR(x : nav:uid)$}.
     */
    REF,
    /** Renders the target inline: {@code $CMS_INCLUDE(section_template:uid)$}. */
    INCLUDE
}
