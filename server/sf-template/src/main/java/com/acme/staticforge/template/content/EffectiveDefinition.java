package com.acme.staticforge.template.content;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.rules.RuleResolution;
import com.acme.staticforge.template.rules.RuleSet;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A page template's <em>effective</em> content definition (M20): the union of its own definition and
 * those of every ancestor along its inheritance chain, root first. The one implementation of the union
 * and its collision rule, shared by the OCTL chain compiler and the domain's effective-definition
 * lookup, so editor-name checks, the page editor form and content validation always agree.
 *
 * <p>Editors (groups are transparent, so a grouped editor's name counts) and bodies are separate
 * namespaces, exactly as within one CDL source. A name a layer declares that an earlier (less derived)
 * layer already declares is an {@code SF-CDL-0109} error naming the ancestor, and the later
 * declaration is left out: the inherited one wins, so a descendant can never silently change what its
 * ancestor's pages store.
 *
 * <p>Rules (M33) merge differently: a layer's rule of the same name, state or fill of the same path replaces the
 * ancestor's, and {@code rule "x" off} removes an inherited rule ({@code SF-CDL-0118} when no ancestor has it). The
 * template's own rules are checked against the effective editors, so they may target inherited ones
 * ({@code SF-CDL-0115} for names that resolve nowhere).
 *
 * @param definition the merged definition
 * @param editorsInheritedFrom top-level editor name → uid of the ancestor declaring it (own editors absent)
 * @param bodiesInheritedFrom body name → uid of the ancestor declaring it (own bodies absent)
 * @param diagnostics {@code SF-CDL-0109} collisions of the template's own names; collisions between two
 *     ancestors are the ancestors' own problem and are not repeated
 */
public record EffectiveDefinition(
        ContentDefinition definition,
        Map<String, String> editorsInheritedFrom,
        Map<String, String> bodiesInheritedFrom,
        List<Diagnostic> diagnostics) {

    private static final String SYNTHETIC_GROUP_PREFIX = "_group_";

    public EffectiveDefinition {
        editorsInheritedFrom = Collections.unmodifiableMap(new LinkedHashMap<>(editorsInheritedFrom));
        bodiesInheritedFrom = Collections.unmodifiableMap(new LinkedHashMap<>(bodiesInheritedFrom));
        diagnostics = List.copyOf(diagnostics);
    }

    /** One template's own definition in a chain; {@code uid} names it in collision messages. */
    public record Layer(String uid, ContentDefinition own) {}

    /** A template without ancestors: its own definition, nothing inherited. */
    public static EffectiveDefinition standalone(ContentDefinition own) {
        return new EffectiveDefinition(own == null ? empty() : own, Map.of(), Map.of(), List.of());
    }

    /**
     * Merges {@code rootFirst}: the root layout first, the template itself last. Synthetic group wrapper
     * names ({@code _group_N}) of ancestors are made unique per layer, since every CDL source numbers them
     * from 1.
     */
    public static EffectiveDefinition merge(List<Layer> rootFirst) {
        if (rootFirst.isEmpty()) {
            return standalone(null);
        }
        List<EditorDefinition> editors = new ArrayList<>();
        List<BodyDefinition> bodies = new ArrayList<>();
        Map<String, String> editorOwners = new LinkedHashMap<>();
        Map<String, String> bodyOwners = new LinkedHashMap<>();
        Map<String, String> editorsInheritedFrom = new LinkedHashMap<>();
        Map<String, String> bodiesInheritedFrom = new LinkedHashMap<>();
        List<Diagnostic> diagnostics = new ArrayList<>();
        String paginationOwner = null;
        List<RuleSet> ruleLayers = new ArrayList<>();

        int last = rootFirst.size() - 1;
        for (int index = 0; index <= last; index++) {
            Layer layer = rootFirst.get(index);
            boolean own = index == last;
            ContentDefinition definition = layer.own() == null ? empty() : layer.own();
            ruleLayers.add(definition.rules());
            for (EditorDefinition editor : definition.editors()) {
                List<String> names = new ArrayList<>();
                collectNames(editor, names);
                String collision = names.stream().filter(editorOwners::containsKey).findFirst().orElse(null);
                if (collision != null) {
                    if (own) {
                        diagnostics.add(Diagnostic.error(
                                DiagnosticCodes.CDL_INHERITED_NAME_COLLISION,
                                "Editor '" + collision + "' is already declared by ancestor template '"
                                        + editorOwners.get(collision) + "'; rename it, or use the inherited editor",
                                0, 0));
                    }
                    continue;
                }
                if (editor.isPagination()) {
                    if (paginationOwner != null) {
                        // At most one per page (M21.1.1): the inherited one wins, like a colliding name.
                        if (own) {
                            diagnostics.add(Diagnostic.error(
                                    DiagnosticCodes.CDL_PAGINATION_DUPLICATE,
                                    "Pagination editor '" + editor.name() + "' is a second one: ancestor template '"
                                            + paginationOwner + "' already declares a pagination editor",
                                    0, 0));
                        }
                        continue;
                    }
                    paginationOwner = layer.uid();
                }
                names.forEach(name -> editorOwners.put(name, layer.uid()));
                EditorDefinition added = own ? editor : uniqueGroupNames(editor, layer.uid());
                editors.add(added);
                if (!own) {
                    editorsInheritedFrom.put(added.name(), layer.uid());
                }
            }
            for (BodyDefinition body : definition.bodies()) {
                if (bodyOwners.containsKey(body.name())) {
                    if (own) {
                        diagnostics.add(Diagnostic.error(
                                DiagnosticCodes.CDL_INHERITED_NAME_COLLISION,
                                "Body '" + body.name() + "' is already declared by ancestor template '"
                                        + bodyOwners.get(body.name()) + "'; rename it, or use the inherited body",
                                0, 0));
                    }
                    continue;
                }
                bodyOwners.put(body.name(), layer.uid());
                bodies.add(body);
                if (!own) {
                    bodiesInheritedFrom.put(body.name(), layer.uid());
                }
            }
        }
        List<String> unknownOverrides = new ArrayList<>();
        RuleSet rules = RuleSet.merge(ruleLayers, unknownOverrides);
        for (String name : unknownOverrides) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.CDL_RULE_UNKNOWN_OVERRIDE,
                    "rule \"" + name + "\" off: no ancestor template defines a rule of that name", 0, 0));
        }
        ContentDefinition merged = new ContentDefinition(List.copyOf(editors), List.copyOf(bodies), rules);
        diagnostics.addAll(RuleResolution.check(ruleLayers.get(ruleLayers.size() - 1), merged, rules));
        return new EffectiveDefinition(merged, editorsInheritedFrom, bodiesInheritedFrom, diagnostics);
    }

    /** The editor names an editor occupies: its own (unless a synthetic group wrapper) and its group items'. */
    private static void collectNames(EditorDefinition editor, List<String> names) {
        if (!editor.name().startsWith(SYNTHETIC_GROUP_PREFIX)) {
            names.add(editor.name());
        }
        if (editor.isGroup()) {
            editor.items().forEach(item -> collectNames(item, names));
        }
    }

    private static EditorDefinition uniqueGroupNames(EditorDefinition editor, String layerUid) {
        if (!editor.isGroup()) {
            return editor;
        }
        String name = editor.name().startsWith(SYNTHETIC_GROUP_PREFIX)
                ? SYNTHETIC_GROUP_PREFIX + layerUid + "_" + editor.name().substring(SYNTHETIC_GROUP_PREFIX.length())
                : editor.name();
        List<EditorDefinition> items = editor.items().stream().map(item -> uniqueGroupNames(item, layerUid)).toList();
        return new EditorDefinition(
                name, editor.type(), editor.label(), editor.help(), editor.required(), editor.readOnly(), editor.hidden(),
                editor.defaultValue(), editor.min(), editor.max(), editor.maxLength(), editor.maxChars(), editor.pattern(),
                editor.patternMessage(), editor.mimeTypes(), editor.assetTypes(), editor.options(), editor.features(),
                editor.allow(), editor.visibleWhen(), editor.renamedFrom(), editor.localizable(), items,
                editor.dataset(), editor.pagination(), editor.builtinRules(), editor.width());
    }

    private static ContentDefinition empty() {
        return new ContentDefinition(List.of(), List.of());
    }
}
