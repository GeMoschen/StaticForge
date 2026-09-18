package com.acme.staticforge.generate.plan;

import com.acme.staticforge.common.L10nValues;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Decides whether two versions of a payload differ <em>only</em> in language-dependent values, and
 * in which languages (M24.3.2).
 *
 * <p>That is what lets an incremental build narrow a changed page to the languages it was actually
 * translated in: editing only the English headline of a page rebuilds its English outputs, not all
 * of them. Anything else — structure, a non-localizable value, the template, the UID, the folder —
 * is a {@linkplain Result#structural() structural} change and rebuilds every language, because the
 * safe answer when in doubt is "rebuild it all".
 */
public final class LocaleValueDiff {

    private LocaleValueDiff() {}

    /**
     * What changed between {@code before} and {@code after}.
     *
     * @param structural {@code true} when anything outside an L10N wrapper differs — the caller must
     *     then rebuild every language
     * @param locales the languages whose translations differ; meaningful only when
     *     {@code structural} is {@code false}
     */
    public record Result(boolean structural, Set<String> locales) {

        /** Nothing differs at all. */
        public static final Result UNCHANGED = new Result(false, Set.of());

        /** Something outside a translation differs. */
        public static final Result STRUCTURAL = new Result(true, Set.of());

        public Result {
            locales = locales == null ? Set.of() : Set.copyOf(locales);
        }

        /** {@code true} when the change is confined to the translations of {@link #locales}. */
        public boolean localeOnly() {
            return !structural && !locales.isEmpty();
        }
    }

    /** Compares two payloads. A {@code null} on either side is a structural change. */
    public static Result compare(JsonNode before, JsonNode after) {
        if (before == null || after == null) {
            return Result.STRUCTURAL;
        }
        Set<String> locales = new LinkedHashSet<>();
        return walk(before, after, locales) ? Result.STRUCTURAL : new Result(false, locales);
    }

    /** @return {@code true} as soon as a structural difference is found */
    private static boolean walk(JsonNode before, JsonNode after, Set<String> locales) {
        if (before.equals(after)) {
            return false;
        }
        if (L10nValues.isL10n(before) && L10nValues.isL10n(after)) {
            collectChangedLocales(before, after, locales);
            return false;
        }
        if (before.isObject() && after.isObject()) {
            Set<String> names = new LinkedHashSet<>();
            before.fieldNames().forEachRemaining(names::add);
            after.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                JsonNode a = before.get(name);
                JsonNode b = after.get(name);
                if (a == null || b == null) {
                    // A key appearing or disappearing is structural: the value went from absent to
                    // present (or back), which changes what every language renders, not just one.
                    return true;
                }
                if (walk(a, b, locales)) {
                    return true;
                }
            }
            return false;
        }
        if (before.isArray() && after.isArray()) {
            if (before.size() != after.size()) {
                return true;
            }
            for (int i = 0; i < before.size(); i++) {
                if (walk(before.get(i), after.get(i), locales)) {
                    return true;
                }
            }
            return false;
        }
        return true;
    }

    /** The languages whose values differ between two wrappers, including one-sided ones. */
    private static void collectChangedLocales(JsonNode before, JsonNode after, Set<String> locales) {
        Set<String> names = new LinkedHashSet<>(L10nValues.locales(before));
        names.addAll(L10nValues.locales(after));
        for (String locale : names) {
            JsonNode a = L10nValues.get(before, locale);
            JsonNode b = L10nValues.get(after, locale);
            if (a == null || b == null || !a.equals(b)) {
                locales.add(locale);
            }
        }
    }

}
