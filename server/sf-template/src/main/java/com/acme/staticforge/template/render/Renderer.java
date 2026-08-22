package com.acme.staticforge.template.render;

import com.acme.staticforge.template.octl.CompiledTemplate;

/**
 * Renders a {@link CompiledTemplate} against a {@link RenderContext} (spec §21.3, §16.10).
 * Implementations must be thread-safe and side-effect-free so templates may render in
 * parallel on virtual threads.
 */
public interface Renderer {

    /**
     * Renders the template producing its output plus the touched asset UUIDs.
     *
     * @throws RenderLimitException when a guard rail is exceeded
     */
    RenderResult render(CompiledTemplate template, RenderContext context);
}
