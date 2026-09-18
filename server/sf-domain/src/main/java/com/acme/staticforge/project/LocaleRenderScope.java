package com.acme.staticforge.project;

import com.acme.staticforge.template.render.RenderContext;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.function.Function;

/**
 * Puts a project's locale configuration into a render (M24.3.1): the render locale and its
 * fallback chain, the {@code $CMS_META(locale)$} / {@code $CMS_META(language)$} values, and the
 * {@code CMS_LOCALES} iterable a template builds a language switcher from.
 *
 * <p>One helper for generation and preview so the two can't drift. A project without locales gets
 * an empty chain, empty meta values and no {@code CMS_LOCALES} items, which is exactly pre-M24
 * behaviour.
 */
public final class LocaleRenderScope {

    private LocaleRenderScope() {}

    /**
     * Applies {@code config} to {@code builder} for the render locale {@code locale}.
     *
     * @param hrefByLocale the current page's URL in a given locale, relative to the page being
     *     rendered; {@code null}, or a {@code null} result, leaves that locale's {@code href} empty
     *     (a preview, or a locale this page has no URL in)
     */
    public static void apply(
            RenderContext.Builder builder,
            LocaleConfig config,
            String locale,
            Function<String, String> hrefByLocale) {
        if (config == null || !config.isLocalized()) {
            builder.meta("locale", TextNode.valueOf(""));
            builder.meta("language", TextNode.valueOf(""));
            return;
        }
        String active = config.canonicalDeclared(locale) != null
                ? config.canonicalDeclared(locale)
                : config.defaultLocale();

        builder.locale(active, config.effectiveChain(active));
        builder.meta("locale", TextNode.valueOf(active));
        builder.meta("language", TextNode.valueOf(emptyIfNull(LocaleConfig.language(active))));
        builder.locales(localesScope(config, active, hrefByLocale));
    }

    /** The {@code CMS_LOCALES} items: one per declared locale, in declaration order. */
    public static ArrayNode localesScope(
            LocaleConfig config, String active, Function<String, String> hrefByLocale) {
        ArrayNode items = JsonNodeFactory.instance.arrayNode(config.locales().size());
        for (ProjectLocale declared : config.locales()) {
            ObjectNode item = items.addObject();
            item.put("code", declared.code());
            item.put("language", emptyIfNull(LocaleConfig.language(declared.code())));
            item.put("label", declared.label());
            item.put("current", declared.code().equals(active));
            String href = hrefByLocale == null ? null : hrefByLocale.apply(declared.code());
            item.put("href", emptyIfNull(href));
        }
        return items;
    }

    private static String emptyIfNull(String value) {
        return value == null ? "" : value;
    }
}
