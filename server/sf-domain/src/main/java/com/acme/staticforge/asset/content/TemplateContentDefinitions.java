package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Obtains a page/section template's {@link ContentDefinition} for save-time content validation. It
 * compiles the template payload's CDL sections ({@code contentCdl}, {@code bodiesCdl}, {@code rulesCdl}) (the compiler returns a
 * best-effort definition even for CDL with errors). Generation's publish check uses the build's
 * {@code TemplateCompileMemo} instead, so a build compiles each CDL once.
 */
public final class TemplateContentDefinitions {

    private static final CdlCompiler CDL_COMPILER = new CdlCompiler();

    private TemplateContentDefinitions() {}

    /** The compiled definition of the template whose payload is {@code templatePayload}. */
    public static ContentDefinition of(JsonNode templatePayload) {
        return CDL_COMPILER.compile(CdlSources.of(templatePayload)).definition();
    }
}
