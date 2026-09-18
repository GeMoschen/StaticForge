package com.acme.staticforge.asset.content;

import com.acme.staticforge.project.LocaleConfig;
import java.util.List;

/**
 * What the content validator needs to know about a project's locales (M24.2.1), without
 * dragging the whole {@link LocaleConfig} through the pure validation code.
 *
 * <p>{@link #NONE} is a single-language project: {@code localizable} is inactive, values stay
 * bare, and an L10N wrapper in a payload is an error.
 */
public record LocalizationContext(boolean localized, String defaultLocale, List<String> declaredLocales) {

    /** A project with no locales configured — pre-M24 behaviour. */
    public static final LocalizationContext NONE = new LocalizationContext(false, null, List.of());

    public LocalizationContext {
        declaredLocales = declaredLocales == null ? List.of() : List.copyOf(declaredLocales);
    }

    /** Projects the configuration onto what validation needs. */
    public static LocalizationContext of(LocaleConfig config) {
        if (config == null || !config.isLocalized()) {
            return NONE;
        }
        return new LocalizationContext(true, config.defaultLocale(), config.codes());
    }

    /** {@code true} when {@code locale} is one of the project's declared locales. */
    public boolean declares(String locale) {
        return locale != null && declaredLocales.stream().anyMatch(c -> c.equalsIgnoreCase(locale));
    }
}
