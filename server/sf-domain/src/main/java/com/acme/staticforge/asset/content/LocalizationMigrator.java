package com.acme.staticforge.asset.content;

import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

/**
 * Brings a stored content object into the shape its definition declares (M24.2.2): every
 * {@code localizable} leaf holds an L10N wrapper, every other leaf holds a bare value.
 *
 * <p>Deliberately <em>normalizing</em> rather than diffing two definitions. One pass covers all
 * four triggers — an editor gaining {@code localizable}, an editor losing it, a project gaining
 * locales, a project losing them — and it is idempotent: running it on already-normal content
 * changes nothing, so a retried request after a timeout can't double-wrap.
 *
 * <p>Pure: the caller decides which assets to rewrite and in which revision, exactly as with
 * {@link ContentRenameMigrator}.
 */
public final class LocalizationMigrator {

    private LocalizationMigrator() {}

    /**
     * What a migration would do to one content object.
     *
     * @param changed whether anything in the object was rewritten
     * @param discards values that would lose translations by being unwrapped — never applied
     *     without an explicit confirmation
     */
    public record Plan(boolean changed, List<Discard> discards) {

        public static final Plan UNCHANGED = new Plan(false, List.of());

        public Plan {
            discards = discards == null ? List.of() : List.copyOf(discards);
        }

        public boolean requiresConfirmation() {
            return !discards.isEmpty();
        }
    }

    /**
     * One value that loses translations when its editor stops being language-dependent.
     *
     * @param path the value's path inside the content object, e.g. {@code links[0].caption}
     * @param locales the locales whose values are dropped (the kept one is not listed)
     */
    public record Discard(String path, List<String> locales) {

        public Discard {
            locales = locales == null ? List.of() : List.copyOf(locales);
        }
    }

    /**
     * Rewrites {@code content} in place to match {@code definition} under {@code localization}.
     *
     * <p>Catalog cards are skipped: a card's fields come from its own section template's CDL, so
     * that template's migration owns them — this is the same rule the renderer and validator use.
     *
     * @param apply {@code false} performs a dry run and reports what would change without
     *     touching {@code content}
     */
    public static Plan normalize(
            ObjectNode content, ContentDefinition definition, LocalizationContext localization, boolean apply) {
        if (content == null || definition == null) {
            return Plan.UNCHANGED;
        }
        Accumulator acc = new Accumulator(localization, apply);
        acc.walk(definition.editors(), content, "");
        return new Plan(acc.changed, acc.discards);
    }

    /** A dry run: what {@link #normalize} would change, without changing it. */
    public static Plan preview(
            ObjectNode content, ContentDefinition definition, LocalizationContext localization) {
        return normalize(content, definition, localization, false);
    }

    /**
     * The dotted paths of the leaf editors {@code definition} declares {@code localizable}
     * (groups transparent, list items namespaced by their list). Comparing two definitions'
     * sets is how a template save detects that the language-dependence of a value changed.
     */
    public static java.util.Set<String> localizableLeaves(ContentDefinition definition) {
        java.util.Set<String> names = new java.util.LinkedHashSet<>();
        if (definition != null) {
            collectLocalizable(definition.editors(), "", names);
        }
        return names;
    }

    private static void collectLocalizable(
            List<EditorDefinition> editors, String prefix, java.util.Set<String> names) {
        for (EditorDefinition editor : editors) {
            if (editor.isGroup()) {
                collectLocalizable(editor.items(), prefix, names);
                continue;
            }
            String path = prefix.isEmpty() ? editor.name() : prefix + "." + editor.name();
            if (editor.isList()) {
                collectLocalizable(editor.items(), path + "[]", names);
            } else if (editor.localizable()) {
                names.add(path);
            }
        }
    }

    private static final class Accumulator {

        private final LocalizationContext localization;
        private final boolean apply;
        private final List<Discard> discards = new ArrayList<>();
        private boolean changed;

        Accumulator(LocalizationContext localization, boolean apply) {
            this.localization = localization == null ? LocalizationContext.NONE : localization;
            this.apply = apply;
        }

        void walk(List<EditorDefinition> editors, ObjectNode node, String prefix) {
            for (EditorDefinition editor : editors) {
                String path = prefix.isEmpty() ? editor.name() : prefix + "." + editor.name();
                if (editor.isGroup()) {
                    // A group is transparent: its children live in the enclosing namespace.
                    walk(editor.items(), node, prefix);
                } else if (editor.isList()) {
                    JsonNode list = node.get(editor.name());
                    if (list != null && list.isArray()) {
                        for (int i = 0; i < list.size(); i++) {
                            if (list.get(i) instanceof ObjectNode item) {
                                walk(editor.items(), item, path + "[" + i + "]");
                            }
                        }
                    }
                } else if (!editor.isCatalog() && !editor.isPagination()) {
                    leaf(editor, node, path);
                }
            }
        }

        private void leaf(EditorDefinition editor, ObjectNode node, String path) {
            JsonNode value = node.get(editor.name());
            boolean shouldBeWrapped = editor.localizable() && localization.localized();

            if (shouldBeWrapped) {
                if (L10nValues.isL10n(value)) {
                    return;
                }
                if (value == null || value.isNull()) {
                    // Nothing stored: leave the key absent rather than writing an empty wrapper,
                    // so an untouched page is not rewritten just to gain empty scaffolding.
                    return;
                }
                changed = true;
                if (apply) {
                    node.set(editor.name(), L10nValues.wrap(value, localization.defaultLocale()));
                }
                return;
            }

            if (!L10nValues.isL10n(value)) {
                return;
            }
            // Unwrapping: the default locale's value survives, everything else is dropped.
            List<String> stored = L10nValues.locales(value);
            List<String> chain = localization.defaultLocale() == null
                    ? stored
                    : java.util.stream.Stream.concat(
                                    java.util.stream.Stream.of(localization.defaultLocale()), stored.stream())
                            .distinct()
                            .toList();
            JsonNode kept = L10nValues.resolve(value, chain);
            String keptLocale = L10nValues.resolvedLocale(value, chain);
            List<String> lost = stored.stream().filter(l -> !l.equals(keptLocale)).toList();
            if (!lost.isEmpty()) {
                discards.add(new Discard(path, lost));
            }
            changed = true;
            if (apply) {
                if (kept == null) {
                    node.remove(editor.name());
                } else {
                    node.set(editor.name(), kept);
                }
            }
        }
    }
}
