package com.acme.staticforge.channel;

import java.util.List;

/** The templates that would be affected by deleting a channel (spec §15.3). */
public record DeletePreview(List<TemplateRef> affectedTemplates) {

    public DeletePreview {
        affectedTemplates = affectedTemplates == null ? List.of() : List.copyOf(affectedTemplates);
    }

    public boolean isEmpty() {
        return affectedTemplates.isEmpty();
    }
}
