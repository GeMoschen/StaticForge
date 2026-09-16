package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The {@code renamedFrom} migration step (spec §12.3), shared by every content holder whose CDL
 * can change: a section template's fan-out into every page that uses it
 * ({@code TemplateServiceImpl.migrateRenames}) and a global property set's own values, which
 * migrate inside the very version write that changes the schema (M17.1.2).
 *
 * <p>Pure and dependency-free: it collects the declared renames from a compiled definition and
 * applies them to one content object. The <em>cascade</em> (which assets to rewrite, in which
 * revision) stays with the caller, because that is the only part that genuinely differs.
 */
public final class ContentRenameMigrator {

    private ContentRenameMigrator() {}

    /** One declared {@code renamedFrom} hop, {@code from} being the editor's previous name. */
    public record EditorRename(String from, String to) {}

    /**
     * The renames declared in {@code definition}. Groups are transparent — their children live in
     * the enclosing namespace (see {@link ContentDefinition#findEditor}) — so they are walked
     * through; a {@code list}'s item editors open their own namespace and are not.
     */
    public static List<EditorRename> collect(ContentDefinition definition) {
        List<EditorRename> renames = new ArrayList<>();
        if (definition != null) {
            collectInto(definition.editors(), renames);
        }
        return renames;
    }

    private static void collectInto(List<EditorDefinition> editors, List<EditorRename> renames) {
        for (EditorDefinition editor : editors) {
            String from = editor.renamedFrom();
            if (from != null && !from.isBlank() && !from.equals(editor.name())) {
                renames.add(new EditorRename(from, editor.name()));
            }
            if (editor.isGroup()) {
                collectInto(editor.items(), renames);
            }
        }
    }

    /**
     * Moves each renamed editor's value in place, returning {@code true} when {@code content}
     * actually changed. A rename whose source key is absent is a no-op, so applying the same
     * migration twice is harmless.
     */
    public static boolean apply(ObjectNode content, List<EditorRename> renames) {
        if (content == null) {
            return false;
        }
        boolean changed = false;
        for (EditorRename rename : renames) {
            if (content.has(rename.from())) {
                content.set(rename.to(), content.get(rename.from()));
                content.remove(rename.from());
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Drops values whose editor no longer exists in {@code definition}, returning {@code true}
     * when {@code content} changed. Call this <em>after</em> {@link #apply} so a renamed editor's
     * value has already moved to its new key and survives.
     *
     * <p>Only a content holder that owns its own schema (a global property set) prunes: for a
     * page, an orphan value belongs to a section instance whose template may simply not be the one
     * being edited, so the page cascade deliberately leaves unknown keys alone.
     */
    public static boolean pruneUnknown(ObjectNode content, ContentDefinition definition) {
        if (content == null || definition == null) {
            return false;
        }
        Set<String> declared = new LinkedHashSet<>();
        declareInto(definition.editors(), declared);
        List<String> orphans = new ArrayList<>();
        content.fieldNames().forEachRemaining(name -> {
            if (!declared.contains(name)) {
                orphans.add(name);
            }
        });
        orphans.forEach(content::remove);
        return !orphans.isEmpty();
    }

    private static void declareInto(List<EditorDefinition> editors, Set<String> names) {
        for (EditorDefinition editor : editors) {
            names.add(editor.name());
            if (editor.isGroup()) {
                declareInto(editor.items(), names);
            }
        }
    }
}
