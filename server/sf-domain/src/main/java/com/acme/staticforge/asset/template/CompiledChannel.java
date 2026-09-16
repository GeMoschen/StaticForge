package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlResult;

/**
 * One template channel compiled for rendering: the OCTL compile result (template + diagnostics)
 * and the CDL {@link ContentDefinition} it was validated against. Immutable and shareable across
 * threads; produced by {@link CompiledTemplateCache} and {@link TemplateCompileMemo}.
 */
public record CompiledChannel(OctlResult octl, ContentDefinition definition) {

    /** The compiled template to render. */
    public CompiledTemplate template() {
        return octl.template();
    }
}
