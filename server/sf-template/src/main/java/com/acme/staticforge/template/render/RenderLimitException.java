package com.acme.staticforge.template.render;

import com.acme.staticforge.template.diagnostic.Diagnostic;

/**
 * Thrown when rendering exceeds a guard rail (spec §16.10): max include depth, max loop
 * iterations, max output size, or the wall-clock budget. Carries the diagnostic so a caller
 * can fail the affected file without aborting the whole build.
 */
public class RenderLimitException extends RuntimeException {

    private final Diagnostic diagnostic;

    public RenderLimitException(Diagnostic diagnostic) {
        super(diagnostic == null ? "render limit exceeded" : diagnostic.message());
        this.diagnostic = diagnostic;
    }

    /** The diagnostic describing which limit was exceeded. */
    public Diagnostic diagnostic() {
        return diagnostic;
    }
}
