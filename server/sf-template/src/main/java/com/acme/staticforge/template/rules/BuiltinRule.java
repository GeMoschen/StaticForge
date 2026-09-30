package com.acme.staticforge.template.rules;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.List;
import java.util.Set;

/**
 * The inline overrides of a built-in check on its attribute (M33, epic decision 2): {@code required level warning
 * scope [release]}, {@code maxLength 160 level info scope [edit]}, {@code validate pattern "…" message { en "…" }}.
 * Every field is {@code null} when not written; the rule engine fills the built-in's defaults (today's behavior:
 * {@code error} in {@code [edit, release, generation]}, {@code holdBack}).
 *
 * @param name the built-in: one of {@link #NAMES}
 */
public record BuiltinRule(
        String name, RuleLevel level, Set<RuleScope> scopes, OnGeneration onGeneration, RuleMessages messages) {

    /** The attributes that are built-in rules; also reserved as custom rule names. */
    public static final List<String> NAMES =
            List.of("required", "maxLength", "maxChars", "pattern", "min", "max", "mimeTypes");

    public BuiltinRule {
        scopes = scopes == null ? null : Set.copyOf(scopes);
        messages = messages == null ? RuleMessages.NONE : messages;
    }

    /** No override: the built-in's defaults. */
    public static BuiltinRule defaults(String name) {
        return new BuiltinRule(name, null, null, null, RuleMessages.NONE);
    }

    @JsonIgnore
    public boolean isDefault() {
        return level == null && scopes == null && onGeneration == null && messages.isEmpty();
    }
}
