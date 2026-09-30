package com.acme.staticforge.template.content;

import com.acme.staticforge.template.rules.RuleSet;
import java.util.List;
import java.util.Optional;

/**
 * The compiled content definition — the normalized JSON AST produced by the CDL
 * compiler (spec §14.1, §14.7). This is the shared contract between the CDL compiler,
 * the content validator and the OCTL renderer's scope resolution. {@code rules} is the compiled {@code rules {}}
 * section (M33); in an effective definition, the merged rules of the whole inheritance chain.
 */
public record ContentDefinition(List<EditorDefinition> editors, List<BodyDefinition> bodies, RuleSet rules) {

    public ContentDefinition {
        editors = editors == null ? List.of() : editors;
        bodies = bodies == null ? List.of() : bodies;
        rules = rules == null ? RuleSet.EMPTY : rules;
    }

    /** A definition without rules. */
    public ContentDefinition(List<EditorDefinition> editors, List<BodyDefinition> bodies) {
        this(editors, bodies, RuleSet.EMPTY);
    }

    /**
     * Finds a named editor in the definition's top-level namespace. Groups are
     * transparent (their names live in the same namespace), but a {@code list}'s item
     * editors open their own namespace and are not resolvable here.
     */
    public Optional<EditorDefinition> findEditor(String name) {
        for (EditorDefinition editor : editors) {
            Optional<EditorDefinition> found = findIn(editor, name);
            if (found.isPresent()) {
                return found;
            }
        }
        return Optional.empty();
    }

    public Optional<BodyDefinition> findBody(String name) {
        return bodies.stream().filter(b -> b.name().equals(name)).findFirst();
    }

    private static Optional<EditorDefinition> findIn(EditorDefinition editor, String name) {
        if (editor.name().equals(name)) {
            return Optional.of(editor);
        }
        if (editor.isGroup()) {
            for (EditorDefinition child : editor.items()) {
                Optional<EditorDefinition> found = findIn(child, name);
                if (found.isPresent()) {
                    return found;
                }
            }
        }
        return Optional.empty();
    }
}
