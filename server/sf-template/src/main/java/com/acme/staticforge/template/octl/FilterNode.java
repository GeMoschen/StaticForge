package com.acme.staticforge.template.octl;

import java.util.List;

/**
 * A filter application in an OCTL filter chain (spec §16.3): a name plus an optional
 * argument list, for example {@code truncate(40, "...")}. Arguments are kept as their
 * decoded literal text; numeric arguments are interpreted by the filter that consumes them.
 */
public record FilterNode(String name, List<String> args) {

    public FilterNode {
        args = args == null ? List.of() : List.copyOf(args);
    }

    public static FilterNode of(String name, List<String> args) {
        return new FilterNode(name, args);
    }
}
