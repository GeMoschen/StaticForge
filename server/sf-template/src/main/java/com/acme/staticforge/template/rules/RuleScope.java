package com.acme.staticforge.template.rules;

import java.util.Locale;

/**
 * When a rule runs (M33, user decision 2): {@code EDIT} while the form is open (evaluated on the server for every
 * change), {@code SAVE} on every save including autosave, {@code RELEASE} when a language is released,
 * {@code GENERATION} in a build's VALIDATE stage. A rule runs in exactly the scopes it names.
 */
public enum RuleScope {
    EDIT,
    SAVE,
    RELEASE,
    GENERATION;

    /** The CDL keyword ({@code edit}, {@code save}, {@code release}, {@code generation}). */
    public String keyword() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The scope named by a CDL keyword, or {@code null}. */
    public static RuleScope fromKeyword(String keyword) {
        for (RuleScope scope : values()) {
            if (scope.keyword().equals(keyword)) {
                return scope;
            }
        }
        return null;
    }
}
