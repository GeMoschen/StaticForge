package com.acme.staticforge.asset.content;

import com.acme.staticforge.project.LocaleConfig;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the content validator needs to know about a project's locales (M24.2.1), without
 * dragging the whole {@link LocaleConfig} through the pure validation code.
 *
 * <p>{@link #NONE} is a single-language project: {@code localizable} is inactive, values stay
 * bare, and an L10N wrapper in a payload is an error.
 *
 * @param chains each declared locale's fallback chain (M33: the rule engine resolves values per language like
 *     rendering does); a locale without an entry falls back to itself, then the default locale
 */
public record LocalizationContext(
        boolean localized, String defaultLocale, List<String> declaredLocales, Map<String, List<String>> chains) {

    /** A project with no locales configured — pre-M24 behaviour. */
    public static final LocalizationContext NONE = new LocalizationContext(false, null, List.of());

    public LocalizationContext {
        declaredLocales = declaredLocales == null ? List.of() : List.copyOf(declaredLocales);
        chains = chains == null ? Map.of() : Map.copyOf(chains);
    }

    public LocalizationContext(boolean localized, String defaultLocale, List<String> declaredLocales) {
        this(localized, defaultLocale, declaredLocales, Map.of());
    }

    /** Projects the configuration onto what validation needs. */
    public static LocalizationContext of(LocaleConfig config) {
        if (config == null || !config.isLocalized()) {
            return NONE;
        }
        Map<String, List<String>> chains = new LinkedHashMap<>();
        for (String code : config.codes()) {
            chains.put(code, config.effectiveChain(code));
        }
        return new LocalizationContext(true, config.defaultLocale(), config.codes(), chains);
    }

    /** {@code true} when {@code locale} is one of the project's declared locales. */
    public boolean declares(String locale) {
        return locale != null && declaredLocales.stream().anyMatch(c -> c.equalsIgnoreCase(locale));
    }

    /** The fallback chain of {@code locale}: the configured one, else the locale and then the default locale. */
    public List<String> chain(String locale) {
        if (locale == null) {
            return defaultLocale == null ? List.of() : List.of(defaultLocale);
        }
        List<String> configured = chains.get(locale);
        if (configured != null) {
            return configured;
        }
        List<String> chain = new ArrayList<>();
        chain.add(locale);
        if (defaultLocale != null && !defaultLocale.equals(locale)) {
            chain.add(defaultLocale);
        }
        return chain;
    }
}
