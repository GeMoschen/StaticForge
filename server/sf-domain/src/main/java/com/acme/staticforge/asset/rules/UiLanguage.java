package com.acme.staticforge.asset.rules;

import java.util.Locale;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;

/**
 * The UI language rule messages resolve for (M33, user decision 16): the request's {@code Accept-Language} as Spring
 * exposes it, else {@code null} — the first message of a map.
 */
public final class UiLanguage {

    private UiLanguage() {}

    /** The current request's language tag ({@code de}, {@code de-CH}), or {@code null} outside a request. */
    public static String current() {
        LocaleContext context = LocaleContextHolder.getLocaleContext();
        Locale locale = context == null ? null : context.getLocale();
        return locale == null || locale.getLanguage().isEmpty() ? null : locale.toLanguageTag();
    }
}
