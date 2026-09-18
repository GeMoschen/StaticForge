package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * An OCTL filter (spec §16.3). Takes the pipeline value as a {@link JsonNode} and the
 * decoded argument list, returning the transformed value. {@code null} inputs are normalized
 * to {@link com.fasterxml.jackson.databind.node.NullNode} before dispatch.
 */
@FunctionalInterface
public interface Filter {

    /** Applies this filter to the input value with the given arguments. */
    JsonNode apply(JsonNode input, java.util.List<String> args);

    /**
     * Applies this filter in the render's language (M24.3.1). Most filters are
     * language-independent and ignore it; {@code date}, {@code number}, {@code upper} and
     * {@code lower} override this to format and case-fold per language. {@link java.util.Locale#ROOT}
     * is the language-neutral default a project without locales renders with.
     */
    default JsonNode apply(JsonNode input, java.util.List<String> args, java.util.Locale locale) {
        return apply(input, args);
    }
}
