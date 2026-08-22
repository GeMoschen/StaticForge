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
}
