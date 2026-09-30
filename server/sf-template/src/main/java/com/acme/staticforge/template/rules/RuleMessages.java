package com.acme.staticforge.template.rules;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A rule message per UI language, {@code message { en "…" de "…" }} (M33, user decision 16): resolved for a requested
 * language, falling back to the first entry. Messages may use the placeholders in {@link #PLACEHOLDERS}.
 */
public record RuleMessages(Map<String, String> byLanguage) {

    /** The placeholders a message may use; others are a CDL error. */
    public static final Set<String> PLACEHOLDERS = Set.of("value", "length", "min", "max", "index", "locale");

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([A-Za-z]+)}");

    public static final RuleMessages NONE = new RuleMessages(Map.of());

    public RuleMessages {
        byLanguage = Collections.unmodifiableMap(new LinkedHashMap<>(byLanguage == null ? Map.of() : byLanguage));
    }

    /** One English message, e.g. a {@code pattern}'s {@code message "…"}. */
    public static RuleMessages english(String text) {
        return text == null || text.isBlank() ? NONE : new RuleMessages(Map.of("en", text));
    }

    @JsonIgnore
    public boolean isEmpty() {
        return byLanguage.isEmpty();
    }

    /**
     * The message for {@code language} (a tag such as {@code de} or {@code de-CH}; its primary subtag counts too), else
     * the first entry, else {@code null}.
     */
    public String resolve(String language) {
        if (byLanguage.isEmpty()) {
            return null;
        }
        if (language != null && !language.isBlank()) {
            String exact = byLanguage.get(language);
            if (exact != null) {
                return exact;
            }
            int dash = language.indexOf('-');
            if (dash > 0) {
                String primary = byLanguage.get(language.substring(0, dash));
                if (primary != null) {
                    return primary;
                }
            }
        }
        return byLanguage.values().iterator().next();
    }

    /** The placeholders used by any language's text that are not in {@link #PLACEHOLDERS}. */
    @JsonIgnore
    public Set<String> unknownPlaceholders() {
        Set<String> unknown = new java.util.LinkedHashSet<>();
        for (String text : byLanguage.values()) {
            Matcher m = PLACEHOLDER.matcher(text);
            while (m.find()) {
                if (!PLACEHOLDERS.contains(m.group(1))) {
                    unknown.add(m.group(1));
                }
            }
        }
        return unknown;
    }

    /** {@code text} with {@code {name}} replaced by {@code values.get(name)}; unknown or absent names stay as written. */
    public static String fill(String text, Map<String, String> values) {
        if (text == null) {
            return null;
        }
        Matcher m = PLACEHOLDER.matcher(text);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String value = values.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(value != null ? value : m.group(0)));
        }
        m.appendTail(out);
        return out.toString();
    }
}
