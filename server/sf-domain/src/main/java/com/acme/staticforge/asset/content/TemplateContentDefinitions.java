package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Obtains a page/section template's {@link ContentDefinition} for content validation, on save and
 * on publish alike. It compiles the template payload's {@code contentDefinition} CDL source (the
 * compiler returns a best-effort definition even for CDL with errors). This is the single seam to
 * switch to the compiled-template cache (spec §21.5, {@code M16.1.1}).
 */
public final class TemplateContentDefinitions {

    private static final CdlCompiler CDL_COMPILER = new CdlCompiler();

    private TemplateContentDefinitions() {}

    /** The compiled definition of the template whose payload is {@code templatePayload}. */
    public static ContentDefinition of(JsonNode templatePayload) {
        String source = templatePayload == null ? "" : templatePayload.path("contentDefinition").asText("");
        return CDL_COMPILER.compile(source).definition();
    }
}
