package com.acme.staticforge.template.rules;

import java.util.List;

/**
 * The languages a rule runs for (M33, user decision 15): {@code locales all} (the default for custom rules),
 * {@code locales [default]} (only the project's default language) or {@code locales [de, en]}.
 */
public record LocaleSelector(boolean all, boolean defaultOnly, List<String> codes) {

    public static final LocaleSelector ALL = new LocaleSelector(true, false, List.of());
    public static final LocaleSelector DEFAULT = new LocaleSelector(false, true, List.of());

    public LocaleSelector {
        codes = codes == null ? List.of() : List.copyOf(codes);
    }

    public static LocaleSelector of(List<String> codes) {
        return new LocaleSelector(false, false, codes);
    }

    /** Whether the rule runs for {@code locale} ({@code null} in a project without languages: always). */
    public boolean includes(String locale, String defaultLocale) {
        if (all || locale == null) {
            return true;
        }
        if (defaultOnly) {
            return locale.equals(defaultLocale);
        }
        return codes.stream().anyMatch(code -> code.equalsIgnoreCase(locale));
    }

    /** The CDL form. */
    public String keyword() {
        if (all) {
            return "all";
        }
        return defaultOnly ? "[default]" : "[" + String.join(", ", codes) + "]";
    }
}
