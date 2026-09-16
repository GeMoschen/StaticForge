package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The single-source rules of template inheritance (M20) and the block-table helpers the chain compiler
 * builds on. Pure functions over a parsed AST; diagnostics are appended to the caller's list.
 */
final class InheritanceRules {

    /** The {@code assetType} an {@code $CMS_EXTENDS} target must have. */
    static final String PAGE_TEMPLATE_PREFIX = "page_template";

    /** Block names follow the CDL editor naming rule (§14.5). */
    private static final Pattern BLOCK_NAME = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]{0,63}");

    private InheritanceRules() {}

    /**
     * Checks {@code $CMS_EXTENDS} placement and target, content outside blocks in an extending template,
     * block names and {@code $CMS_PARENT$} placement ({@code SF-TPL-0150}–{@code 0153}, {@code 0156}).
     *
     * @return the template's {@code $CMS_EXTENDS} when it is correctly placed and names a
     *     {@code page_template:uid}, otherwise {@code null}; a template with a misplaced or mistargeted
     *     extends is still treated as extending for the content and {@code $CMS_PARENT$} rules
     */
    static OctlNode.Extends check(List<OctlNode> nodes, List<Diagnostic> diagnostics) {
        OctlNode.Extends first = null;
        boolean extending = false;
        boolean contentSeen = false;
        for (OctlNode node : nodes) {
            if (node instanceof OctlNode.Comment || isBlankText(node)) {
                continue;
            }
            if (node instanceof OctlNode.Extends extendsNode) {
                extending = true;
                if (first == null && !contentSeen) {
                    first = extendsNode;
                } else {
                    diagnostics.add(Diagnostic.error(
                            DiagnosticCodes.OCTL_EXTENDS_POSITION,
                            first == null
                                    ? "$CMS_EXTENDS must be the template's first instruction"
                                    : "$CMS_EXTENDS may appear only once",
                            extendsNode.line(), extendsNode.col()));
                }
                continue;
            }
            contentSeen = true;
        }
        forEachNested(nodes, node -> {
            if (node instanceof OctlNode.Extends nested) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_EXTENDS_POSITION,
                        "$CMS_EXTENDS must be the template's first instruction, not nested in another instruction",
                        nested.line(), nested.col()));
            }
        });

        if (first != null && !targetsPageTemplate(first.accessor())) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_EXTENDS_TARGET,
                    "$CMS_EXTENDS needs a page template, e.g. $CMS_EXTENDS(page_template:base)$; got "
                            + describe(first.accessor()),
                    first.line(), first.col()));
            first = null;
        }

        if (extending) {
            checkTopLevelContent(nodes, diagnostics);
        }
        checkBlockNames(nodes, diagnostics);
        checkParents(nodes, false, extending, diagnostics);
        return first;
    }

    /** Every block of the template by name, nested ones included; the first declaration of a duplicate wins. */
    static Map<String, List<OctlNode>> blocks(List<OctlNode> nodes) {
        Map<String, List<OctlNode>> blocks = new LinkedHashMap<>();
        forEach(nodes, node -> {
            if (node instanceof OctlNode.Block block) {
                blocks.putIfAbsent(block.name(), block.body());
            }
        });
        return blocks;
    }

    /** The template's top-level blocks: the overrides of a template that extends. */
    static List<OctlNode.Block> topLevelBlocks(List<OctlNode> nodes) {
        return nodes.stream().filter(OctlNode.Block.class::isInstance).map(OctlNode.Block.class::cast).toList();
    }

    /** The template's top-level {@code $CMS_SET}s: an extending template's child-level variables. */
    static List<OctlNode> topLevelSets(List<OctlNode> nodes) {
        return nodes.stream().filter(OctlNode.Set.class::isInstance).toList();
    }

    /**
     * {@code SF-TPL-0162} when a block contains itself: through blocks nested in any of its definitions
     * along the chain ({@code $CMS_PARENT$} renders another definition of the same block, so the union of
     * a name's definitions is what it can render). Rendering such a table would never end.
     */
    static void checkRecursion(Map<String, List<List<OctlNode>>> table, List<Diagnostic> diagnostics, int line, int col) {
        Map<String, Set<String>> contains = new HashMap<>();
        table.forEach((name, definitions) -> {
            Set<String> inner = new LinkedHashSet<>();
            definitions.forEach(body -> directBlocks(body, inner));
            contains.put(name, inner);
        });
        Set<String> reported = new HashSet<>();
        for (String start : table.keySet()) {
            List<String> cycle = findCycle(start, contains, new ArrayList<>(), new HashSet<>());
            if (cycle != null && reported.add(new java.util.TreeSet<>(cycle).toString())) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_BLOCK_RECURSION,
                        "Block '" + start + "' contains itself: " + String.join(" → ", cycle),
                        line, col));
            }
        }
    }

    /** The closest of {@code candidates} to {@code name} when it is a plausible typo, else {@code null}. */
    static String suggestion(String name, Collection<String> candidates) {
        String best = null;
        int bestDistance = Integer.MAX_VALUE;
        for (String candidate : candidates) {
            int distance = distance(name.toLowerCase(), candidate.toLowerCase());
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
        return best != null && bestDistance <= Math.max(2, name.length() / 3) ? best : null;
    }

    // ------------------------------------------------------------------

    private static void checkTopLevelContent(List<OctlNode> nodes, List<Diagnostic> diagnostics) {
        for (OctlNode node : nodes) {
            switch (node) {
                case OctlNode.Extends e -> { /* checked above */ }
                case OctlNode.Block b -> { /* an override */ }
                case OctlNode.Set s -> { /* a child-level variable */ }
                case OctlNode.Comment c -> { /* no output */ }
                case OctlNode.Text t -> {
                    if (!t.value().isBlank()) {
                        diagnostics.add(Diagnostic.error(
                                DiagnosticCodes.OCTL_CONTENT_OUTSIDE_BLOCK,
                                "Text outside a $CMS_BLOCK in a template that extends has no place in the layout: \""
                                        + snippet(t.value()) + "\"; move it into a block",
                                0, 0));
                    }
                }
                default -> diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_CONTENT_OUTSIDE_BLOCK,
                        "Only $CMS_BLOCK, $CMS_SET and $CMS_COMMENT may appear outside blocks in a template that extends;"
                                + " move this instruction into a block",
                        line(node), col(node)));
            }
        }
    }

    private static void checkBlockNames(List<OctlNode> nodes, List<Diagnostic> diagnostics) {
        Set<String> seen = new HashSet<>();
        forEach(nodes, node -> {
            if (!(node instanceof OctlNode.Block block)) {
                return;
            }
            if (!BLOCK_NAME.matcher(block.name()).matches()) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_BLOCK_NAME,
                        "Invalid block name: '" + block.name() + "' (letters, digits and _, starting with a letter)",
                        block.line(), block.col()));
            } else if (!seen.add(block.name())) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_BLOCK_NAME,
                        "Duplicate block name: " + block.name(), block.line(), block.col()));
            }
        });
    }

    private static void checkParents(List<OctlNode> nodes, boolean inBlock, boolean extending, List<Diagnostic> diagnostics) {
        for (OctlNode node : nodes) {
            if (node instanceof OctlNode.Parent parent) {
                String problem = parent.hasArguments()
                        ? "$CMS_PARENT$ takes no arguments"
                        : !inBlock
                                ? "$CMS_PARENT$ is only valid inside a $CMS_BLOCK"
                                : !extending ? "$CMS_PARENT$ is only valid in a template that extends another" : null;
                if (problem != null) {
                    diagnostics.add(Diagnostic.error(
                            DiagnosticCodes.OCTL_PARENT_MISUSE, problem, parent.line(), parent.col()));
                }
            }
            boolean inner = inBlock || node instanceof OctlNode.Block;
            children(node).forEach(child -> checkParents(child, inner, extending, diagnostics));
        }
    }

    private static boolean targetsPageTemplate(Accessor accessor) {
        return accessor.isAssetReference()
                && PAGE_TEMPLATE_PREFIX.equals(accessor.assetType())
                && accessor.uid() != null
                && !accessor.uid().isBlank()
                && accessor.path().isEmpty();
    }

    private static String describe(Accessor accessor) {
        if (accessor.isAssetReference()) {
            return accessor.referenceKey() + (accessor.path().isEmpty() ? "" : "." + String.join(".", accessor.path()));
        }
        String path = String.join(".", accessor.path());
        return path.isBlank() ? "nothing" : path;
    }

    private static void directBlocks(List<OctlNode> nodes, Set<String> out) {
        for (OctlNode node : nodes) {
            if (node instanceof OctlNode.Block block) {
                out.add(block.name());
            } else {
                children(node).forEach(child -> directBlocks(child, out));
            }
        }
    }

    private static List<String> findCycle(String name, Map<String, Set<String>> contains, List<String> path, Set<String> done) {
        int index = path.indexOf(name);
        if (index >= 0) {
            List<String> cycle = new ArrayList<>(path.subList(index, path.size()));
            cycle.add(name);
            return cycle;
        }
        if (!done.add(name)) {
            return null;
        }
        path.add(name);
        for (String inner : contains.getOrDefault(name, Set.of())) {
            List<String> cycle = findCycle(inner, contains, path, done);
            if (cycle != null) {
                return cycle;
            }
        }
        path.remove(path.size() - 1);
        return null;
    }

    private static boolean isBlankText(OctlNode node) {
        return node instanceof OctlNode.Text text && text.value().isBlank();
    }

    private static String snippet(String text) {
        String trimmed = text.strip().replaceAll("\\s+", " ");
        return trimmed.length() <= 40 ? trimmed : trimmed.substring(0, 40) + "…";
    }

    /** Visits every node, depth first. */
    private static void forEach(List<OctlNode> nodes, java.util.function.Consumer<OctlNode> visitor) {
        for (OctlNode node : nodes) {
            visitor.accept(node);
            children(node).forEach(child -> forEach(child, visitor));
        }
    }

    /** Visits every node below the top level. */
    private static void forEachNested(List<OctlNode> nodes, java.util.function.Consumer<OctlNode> visitor) {
        for (OctlNode node : nodes) {
            children(node).forEach(child -> forEach(child, visitor));
        }
    }

    /** The node lists directly inside {@code node}. */
    static List<List<OctlNode>> children(OctlNode node) {
        return switch (node) {
            case OctlNode.If f -> {
                List<List<OctlNode>> lists = new ArrayList<>();
                f.branches().forEach(branch -> lists.add(branch.body()));
                lists.add(f.elseBody());
                yield lists;
            }
            case OctlNode.For f -> List.of(f.body());
            case OctlNode.Navigation nav -> List.of(nav.body());
            case OctlNode.Block block -> List.of(block.body());
            default -> List.of();
        };
    }

    private static int line(OctlNode node) {
        return switch (node) {
            case OctlNode.Value v -> v.line();
            case OctlNode.Ref r -> r.line();
            case OctlNode.Body b -> b.line();
            case OctlNode.Include i -> i.line();
            case OctlNode.Navigation n -> n.line();
            case OctlNode.NavigationRecurse n -> n.line();
            case OctlNode.If f -> f.line();
            case OctlNode.For f -> f.line();
            case OctlNode.Set s -> s.line();
            case OctlNode.Meta m -> m.line();
            case OctlNode.Comment c -> c.line();
            case OctlNode.Extends e -> e.line();
            case OctlNode.Block b -> b.line();
            case OctlNode.Parent p -> p.line();
            case OctlNode.Text t -> 0;
        };
    }

    private static int col(OctlNode node) {
        return switch (node) {
            case OctlNode.Value v -> v.col();
            case OctlNode.Ref r -> r.col();
            case OctlNode.Body b -> b.col();
            case OctlNode.Include i -> i.col();
            case OctlNode.Navigation n -> n.col();
            case OctlNode.NavigationRecurse n -> n.col();
            case OctlNode.If f -> f.col();
            case OctlNode.For f -> f.col();
            case OctlNode.Set s -> s.col();
            case OctlNode.Meta m -> m.col();
            case OctlNode.Comment c -> c.col();
            case OctlNode.Extends e -> e.col();
            case OctlNode.Block b -> b.col();
            case OctlNode.Parent p -> p.col();
            case OctlNode.Text t -> 0;
        };
    }

    private static int distance(String a, String b) {
        int[] previous = new int[b.length() + 1];
        int[] current = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            previous[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            current[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(Math.min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[b.length()];
    }
}
