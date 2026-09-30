package com.acme.staticforge.template.expression;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.time.Clock;

/**
 * The environment an expression runs in (M33.1): the clock of {@code now()}/{@code today()} and the resolution of
 * {@code ref(value)}, which the rule engine backs with the draft or released view of the referenced asset (M33.3).
 * {@link #NONE} resolves nothing and uses the UTC system clock.
 */
public interface ExpressionHost {

    ExpressionHost NONE = new ExpressionHost() {};

    /** The clock {@code now()} and {@code today()} read; its zone is the zone of {@code today()}. */
    default Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * {@code ref(value)}: a read-only view of the asset a media, link or reference value points at, or {@code null}
     * (JSON null) when it points at nothing or can't be resolved. May throw {@link ExpressionError} for a limit.
     */
    default JsonNode ref(JsonNode value) {
        return NullNode.getInstance();
    }
}
