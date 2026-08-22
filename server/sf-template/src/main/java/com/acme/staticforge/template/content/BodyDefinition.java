package com.acme.staticforge.template.content;

import java.util.List;

/** A declared page-template body with its allow-list and cardinality (spec §14.6). */
public record BodyDefinition(String name, String label, List<String> allow, Integer min, Integer max) {

    public BodyDefinition {
        allow = allow == null ? List.of() : allow;
    }
}
