package com.acme.staticforge.generate.quality;

import java.util.Objects;

/**
 * One typed, bounded parameter of a quality rule (M30, epic decision 3), e.g. the title length's {@code min} and
 * {@code max}. A project may override the value within the bounds; the rule reads the effective value from its
 * {@link RuleContext}.
 *
 * @param name the parameter's name, unique per rule
 * @param type what values it takes
 * @param defaultValue the value when the project sets none: an {@link Integer} or a {@link Boolean}
 * @param min the smallest allowed integer; {@code null} for a boolean or an unbounded minimum
 * @param max the largest allowed integer; {@code null} for a boolean or an unbounded maximum
 * @param description what the parameter changes, for the settings UI
 */
public record RuleParam(String name, Type type, Object defaultValue, Integer min, Integer max, String description) {

    /** The value kinds a parameter can have. */
    public enum Type {
        INTEGER,
        BOOLEAN
    }

    public RuleParam {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(type, "type");
        description = description == null ? "" : description;
        if (type == Type.BOOLEAN && (min != null || max != null)) {
            throw new IllegalArgumentException("A boolean parameter has no bounds: " + name);
        }
        String problem = problemWith(type, min, max, defaultValue);
        if (problem != null) {
            throw new IllegalArgumentException("Default of parameter '" + name + "' " + problem);
        }
    }

    /** An integer parameter within {@code [min, max]}. */
    public static RuleParam integer(String name, int defaultValue, int min, int max, String description) {
        return new RuleParam(name, Type.INTEGER, defaultValue, min, max, description);
    }

    /** A boolean parameter. */
    public static RuleParam bool(String name, boolean defaultValue, String description) {
        return new RuleParam(name, Type.BOOLEAN, defaultValue, null, null, description);
    }

    /**
     * Why {@code value} is not a valid value of this parameter, as a message fragment ({@code "must be an integer"}),
     * or {@code null} when it is.
     */
    public String problemWith(Object value) {
        return problemWith(type, min, max, value);
    }

    private static String problemWith(Type type, Integer min, Integer max, Object value) {
        if (type == Type.BOOLEAN) {
            return value instanceof Boolean ? null : "must be true or false";
        }
        if (!(value instanceof Integer number)) {
            return "must be an integer";
        }
        if (min != null && number < min) {
            return "must be at least " + min;
        }
        if (max != null && number > max) {
            return "must be at most " + max;
        }
        return null;
    }
}
