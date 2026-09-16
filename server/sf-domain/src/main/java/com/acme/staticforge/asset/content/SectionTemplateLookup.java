package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.content.ContentDefinition;
import java.util.List;
import java.util.Optional;

/**
 * Resolves the section template a body section or catalog card instance points at through its
 * {@code templateRef} (spec §10.3, §14.6), so content validation can check allow lists and
 * recurse into the instance's own content. Save resolves live templates, generation resolves
 * snapshot templates.
 */
@FunctionalInterface
public interface SectionTemplateLookup {

    /** The section template for {@code templateRef} (a UUID string), or empty when it doesn't resolve. */
    Optional<SectionTemplate> find(String templateRef);

    /** A resolved section template: its UID (what {@code allow} lists name) and compiled definition. */
    record SectionTemplate(String uid, ContentDefinition definition) {

        /**
         * Whether an {@code allow} list admits this template: an empty list or {@code "*"} allows
         * any section template, otherwise the list must name this template's UID (spec §14.6).
         */
        public boolean allowedBy(List<String> allow) {
            return allow.isEmpty() || allow.contains("*") || (uid != null && allow.contains(uid));
        }
    }
}
