package com.acme.staticforge.project;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A project's content locale configuration (M24): the ordered locale list, the default
 * locale, per-locale fallback chains and the "default locale without URL prefix" output
 * setting.
 *
 * <p>{@link #EMPTY} is the single-language project every project has today — no locale is
 * declared, {@link #isLocalized()} is {@code false}, and everything downstream (CDL
 * validation, rendering, generation, export) behaves exactly as it did before M24.
 *
 * <p>Instances are immutable and always canonical: build them through
 * {@link #of(List, String, Map, boolean)}, which normalizes language tags and rejects an
 * inconsistent configuration with {@link LocaleConfigException}.
 */
public record LocaleConfig(
        List<ProjectLocale> locales,
        String defaultLocale,
        Map<String, List<String>> fallbacks,
        boolean defaultWithoutPrefix) {

    /** A project with no locales configured: single-language, pre-M24 behaviour. */
    public static final LocaleConfig EMPTY = new LocaleConfig(List.of(), null, Map.of(), false);

    public LocaleConfig {
        locales = locales == null ? List.of() : List.copyOf(locales);
        Map<String, List<String>> copy = new LinkedHashMap<>();
        if (fallbacks != null) {
            fallbacks.forEach((k, v) -> copy.put(k, v == null ? List.of() : List.copyOf(v)));
        }
        fallbacks = Map.copyOf(copy);
    }

    /**
     * Normalizes and validates a configuration.
     *
     * @throws LocaleConfigException when a language tag is not well formed, codes repeat,
     *     the default locale is missing or unknown, a fallback references an undeclared
     *     locale, or a fallback chain is cyclic.
     */
    public static LocaleConfig of(
            List<ProjectLocale> locales,
            String defaultLocale,
            Map<String, List<String>> fallbacks,
            boolean defaultWithoutPrefix) {
        List<FieldError> errors = new ArrayList<>();
        List<ProjectLocale> declared = new ArrayList<>();
        Map<String, String> byLowerCode = new LinkedHashMap<>();

        List<ProjectLocale> input = locales == null ? List.of() : locales;
        for (int i = 0; i < input.size(); i++) {
            ProjectLocale raw = input.get(i);
            String field = "locales[" + i + "].code";
            if (raw == null || raw.code() == null || raw.code().isBlank()) {
                errors.add(new FieldError(field, "Locale code must not be blank."));
                continue;
            }
            String canonical = canonicalize(raw.code());
            if (canonical == null) {
                errors.add(new FieldError(field, "'" + raw.code() + "' is not a valid BCP 47 language tag."));
                continue;
            }
            String previous = byLowerCode.putIfAbsent(canonical.toLowerCase(Locale.ROOT), canonical);
            if (previous != null) {
                errors.add(new FieldError(field, "Locale '" + canonical + "' is declared more than once."));
                continue;
            }
            String label = raw.label() == null || raw.label().isBlank() ? canonical : raw.label().trim();
            declared.add(new ProjectLocale(canonical, label));
        }

        Set<String> codes = new LinkedHashSet<>();
        declared.forEach(l -> codes.add(l.code()));

        String normalizedDefault = null;
        if (!declared.isEmpty()) {
            if (defaultLocale == null || defaultLocale.isBlank()) {
                errors.add(new FieldError("defaultLocale", "A default locale is required when locales are declared."));
            } else {
                normalizedDefault = resolveDeclared(defaultLocale, byLowerCode);
                if (normalizedDefault == null) {
                    errors.add(new FieldError(
                            "defaultLocale", "'" + defaultLocale + "' is not one of the declared locales."));
                }
            }
        } else if (defaultLocale != null && !defaultLocale.isBlank()) {
            errors.add(new FieldError("defaultLocale", "A default locale requires at least one declared locale."));
        }

        Map<String, List<String>> normalizedFallbacks = new LinkedHashMap<>();
        Map<String, List<String>> inputFallbacks = fallbacks == null ? Map.of() : fallbacks;
        for (Map.Entry<String, List<String>> entry : inputFallbacks.entrySet()) {
            String field = "fallbacks[" + entry.getKey() + "]";
            String source = resolveDeclared(entry.getKey(), byLowerCode);
            if (source == null) {
                errors.add(new FieldError(field, "'" + entry.getKey() + "' is not one of the declared locales."));
                continue;
            }
            List<String> chain = new ArrayList<>();
            for (String target : entry.getValue() == null ? List.<String>of() : entry.getValue()) {
                String resolved = resolveDeclared(target, byLowerCode);
                if (resolved == null) {
                    errors.add(new FieldError(field, "'" + target + "' is not one of the declared locales."));
                    continue;
                }
                if (resolved.equals(source)) {
                    errors.add(new FieldError(field, "'" + source + "' cannot fall back to itself."));
                    continue;
                }
                if (!chain.contains(resolved)) {
                    chain.add(resolved);
                }
            }
            if (!chain.isEmpty()) {
                normalizedFallbacks.put(source, List.copyOf(chain));
            }
        }

        detectCycles(codes, normalizedFallbacks, errors);

        if (!errors.isEmpty()) {
            throw new LocaleConfigException(List.copyOf(errors));
        }
        if (declared.isEmpty()) {
            return defaultWithoutPrefix ? new LocaleConfig(List.of(), null, Map.of(), true) : EMPTY;
        }
        return new LocaleConfig(
                List.copyOf(declared), normalizedDefault, Map.copyOf(normalizedFallbacks), defaultWithoutPrefix);
    }

    /** {@code config}, or {@link #EMPTY} when it is {@code null} (a test double, a legacy caller). */
    public static LocaleConfig orEmpty(LocaleConfig config) {
        return config == null ? EMPTY : config;
    }

    /** {@code true} when the project declares at least one content locale. */
    public boolean isLocalized() {
        return !locales.isEmpty();
    }

    /** The declared locale codes in order. */
    public List<String> codes() {
        return locales.stream().map(ProjectLocale::code).toList();
    }

    /** {@code true} when {@code code} is one of the declared locales (case-insensitively). */
    public boolean declares(String code) {
        if (code == null) {
            return false;
        }
        return locales.stream().anyMatch(l -> l.code().equalsIgnoreCase(code));
    }

    /**
     * The resolution order for {@code locale}: the locale itself, its declared fallbacks,
     * then the default locale — deduplicated, in that order. An unknown or {@code null}
     * locale yields the default locale alone; a non-localized project yields an empty
     * chain, which {@code L10nValues} treats as "no localization".
     */
    public List<String> effectiveChain(String locale) {
        if (!isLocalized()) {
            return List.of();
        }
        List<String> chain = new ArrayList<>();
        String start = locale == null ? null : canonicalDeclared(locale);
        if (start != null) {
            chain.add(start);
            for (String next : fallbacks.getOrDefault(start, List.of())) {
                if (!chain.contains(next)) {
                    chain.add(next);
                }
            }
        }
        if (!chain.contains(defaultLocale)) {
            chain.add(defaultLocale);
        }
        return List.copyOf(chain);
    }

    /** The declared spelling of {@code code}, or {@code null} when it is not declared. */
    public String canonicalDeclared(String code) {
        if (code == null) {
            return null;
        }
        return locales.stream()
                .map(ProjectLocale::code)
                .filter(c -> c.equalsIgnoreCase(code))
                .findFirst()
                .orElse(null);
    }

    /** The language subtag of {@code locale} (e.g. {@code de} for {@code de-CH}). */
    public static String language(String locale) {
        if (locale == null || locale.isBlank()) {
            return null;
        }
        String tag = canonicalize(locale);
        String source = tag == null ? locale : tag;
        int dash = source.indexOf('-');
        return dash < 0 ? source : source.substring(0, dash);
    }

    /**
     * Canonicalizes a language tag, or returns {@code null} when {@code raw} is not a
     * well-formed BCP 47 tag that round-trips through {@link Locale}.
     */
    public static String canonicalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        if (!trimmed.matches("[A-Za-z0-9]+(-[A-Za-z0-9]+)*")) {
            return null;
        }
        Locale locale = Locale.forLanguageTag(trimmed);
        String tag = locale.toLanguageTag();
        if (tag.isEmpty() || "und".equals(tag)) {
            return null;
        }
        // Locale.forLanguageTag silently drops ill-formed subtags; require a round trip so
        // "de-XYZQ" or "not a tag" is rejected rather than quietly truncated to "de".
        if (!tag.equalsIgnoreCase(trimmed)) {
            return null;
        }
        return tag;
    }

    private static String resolveDeclared(String raw, Map<String, String> byLowerCode) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String canonical = canonicalize(raw);
        if (canonical == null) {
            return null;
        }
        return byLowerCode.get(canonical.toLowerCase(Locale.ROOT));
    }

    /**
     * Reports every locale that can reach itself over fallback edges. A chain may name
     * several targets, so this walks the whole graph rather than only the first hop.
     */
    private static void detectCycles(
            Set<String> codes, Map<String, List<String>> fallbacks, List<FieldError> errors) {
        Set<String> reported = new HashSet<>();
        for (String code : codes) {
            List<String> path = new ArrayList<>();
            if (reachesSelf(code, code, fallbacks, new HashSet<>(), path) && reported.add(code)) {
                path.add(code);
                errors.add(new FieldError(
                        "fallbacks[" + code + "]", "Fallback chain is cyclic: " + String.join(" → ", path) + "."));
            }
        }
    }

    private static boolean reachesSelf(
            String origin,
            String current,
            Map<String, List<String>> fallbacks,
            Set<String> visited,
            List<String> path) {
        if (!visited.add(current)) {
            return false;
        }
        path.add(current);
        for (String next : fallbacks.getOrDefault(current, List.of())) {
            if (next.equals(origin) || reachesSelf(origin, next, fallbacks, visited, path)) {
                return true;
            }
        }
        path.remove(path.size() - 1);
        return false;
    }

    /** One validation finding, reported to the client as a {@code Problem} field error. */
    public record FieldError(String field, String message) {}

    /** Thrown by {@link LocaleConfig#of} when the configuration is inconsistent. */
    public static final class LocaleConfigException extends RuntimeException {

        private final transient List<FieldError> errors;

        public LocaleConfigException(List<FieldError> errors) {
            super(errors.isEmpty() ? "Invalid locale configuration." : errors.get(0).message());
            this.errors = errors;
        }

        public List<FieldError> errors() {
            return errors;
        }
    }
}
