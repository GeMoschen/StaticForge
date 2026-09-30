package com.acme.staticforge.template.rules;

import com.acme.staticforge.template.expression.CompiledExpression;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The compiled {@code rules {}} section of a CDL source (M33): validation rules, field states and fills, and the
 * inherited rule names this layer switches {@code off}. Immutable. In an effective (merged) definition {@code off} is
 * empty — the switched-off rules are already gone.
 */
public record RuleSet(
        List<RuleDefinition> rules, List<StateDefinition> states, List<FillDefinition> fills, Set<String> off) {

    public static final RuleSet EMPTY = new RuleSet(List.of(), List.of(), List.of(), Set.of());

    public RuleSet {
        rules = rules == null ? List.of() : List.copyOf(rules);
        states = states == null ? List.of() : List.copyOf(states);
        fills = fills == null ? List.of() : List.copyOf(fills);
        off = off == null ? Set.of() : Set.copyOf(off);
    }

    @JsonIgnore
    public boolean isEmpty() {
        return rules.isEmpty() && states.isEmpty() && fills.isEmpty() && off.isEmpty();
    }

    /** A property set a rule, state or fill reads ({@code global:<setUid>…}), and where: {@code rules.<name>} etc. */
    public record GlobalRead(String setUid, String source) {}

    /**
     * The property sets these rules read (M33.7), one entry per set and reader — what makes a set a dependency of the
     * template, dataset or set that declares them.
     */
    @JsonIgnore
    public List<GlobalRead> globalReads() {
        Set<GlobalRead> reads = new LinkedHashSet<>();
        for (RuleDefinition rule : rules) {
            collectGlobals(reads, "rules." + rule.name(), rule.when(), rule.assertion());
        }
        for (StateDefinition state : states) {
            collectGlobals(reads, "states." + state.target().text(), state.requiredWhen(), state.readOnlyWhen());
        }
        for (FillDefinition fill : fills) {
            collectGlobals(reads, "fills." + fill.target().text(), fill.value());
        }
        return List.copyOf(reads);
    }

    private static void collectGlobals(Set<GlobalRead> reads, String source, CompiledExpression... expressions) {
        for (CompiledExpression expression : expressions) {
            if (expression == null) {
                continue;
            }
            for (String id : expression.identifiers()) {
                if (id.startsWith("global:")) {
                    String rest = id.substring("global:".length());
                    int dot = rest.indexOf('.');
                    reads.add(new GlobalRead(dot < 0 ? rest : rest.substring(0, dot), source));
                }
            }
        }
    }

    public Optional<RuleDefinition> rule(String name) {
        return rules.stream().filter(r -> r.name().equals(name)).findFirst();
    }

    /**
     * Merges an inheritance chain, root first (epic decision 3): a later layer's rule of the same name, state of the same
     * path or fill of the same path replaces the earlier one in place; {@code rule "x" off} removes it.
     *
     * @param unknownOverrides receives each {@code off} name no earlier layer defines (the caller reports
     *     {@code SF-CDL-0118} for the last layer)
     */
    public static RuleSet merge(List<RuleSet> rootFirst, List<String> unknownOverrides) {
        Map<String, RuleDefinition> rules = new LinkedHashMap<>();
        Map<String, StateDefinition> states = new LinkedHashMap<>();
        Map<String, FillDefinition> fills = new LinkedHashMap<>();
        for (int i = 0; i < rootFirst.size(); i++) {
            RuleSet layer = rootFirst.get(i) == null ? EMPTY : rootFirst.get(i);
            for (String name : layer.off()) {
                if (rules.remove(name) == null && i == rootFirst.size() - 1 && unknownOverrides != null) {
                    unknownOverrides.add(name);
                }
            }
            layer.rules().forEach(r -> rules.put(r.name(), r));
            layer.states().forEach(s -> states.put(s.target().text(), s));
            layer.fills().forEach(f -> fills.put(f.target().text(), f));
        }
        return new RuleSet(List.copyOf(rules.values()), List.copyOf(states.values()), List.copyOf(fills.values()), Set.of());
    }

    /**
     * The fills in dependency order: a fill that reads a field another fill writes comes after it. Fills in a cycle (a
     * CDL error, see {@link #fillCycle}) keep their declared order.
     */
    @JsonIgnore
    public List<FillDefinition> fillsInOrder() {
        List<FillDefinition> ordered = new ArrayList<>();
        Set<FillDefinition> done = new LinkedHashSet<>();
        Set<FillDefinition> visiting = new LinkedHashSet<>();
        for (FillDefinition fill : fills) {
            visit(fill, ordered, done, visiting);
        }
        return ordered;
    }

    private void visit(FillDefinition fill, List<FillDefinition> ordered, Set<FillDefinition> done, Set<FillDefinition> visiting) {
        if (done.contains(fill) || !visiting.add(fill)) {
            return;
        }
        for (FillDefinition dependency : dependencies(fill)) {
            if (dependency != fill) {
                visit(dependency, ordered, done, visiting);
            }
        }
        visiting.remove(fill);
        if (done.add(fill)) {
            ordered.add(fill);
        }
    }

    /**
     * A cycle among the fills, as the target paths around it ({@code [a, b, a]}), or empty. A fill reading the field it
     * writes by name is a cycle of one; reading it as {@code value} is not.
     */
    @JsonIgnore
    public List<String> fillCycle() {
        Map<FillDefinition, Integer> state = new HashMap<>();
        for (FillDefinition fill : fills) {
            List<FillDefinition> path = new ArrayList<>();
            List<String> cycle = findCycle(fill, state, path);
            if (!cycle.isEmpty()) {
                return cycle;
            }
        }
        return List.of();
    }

    private List<String> findCycle(FillDefinition fill, Map<FillDefinition, Integer> state, List<FillDefinition> path) {
        Integer s = state.get(fill);
        if (s != null && s == 2) {
            return List.of();
        }
        if (s != null && s == 1) {
            List<String> cycle = new ArrayList<>();
            for (int i = path.indexOf(fill); i < path.size(); i++) {
                cycle.add(path.get(i).target().text());
            }
            cycle.add(fill.target().text());
            return cycle;
        }
        state.put(fill, 1);
        path.add(fill);
        for (FillDefinition dependency : dependencies(fill)) {
            List<String> cycle = findCycle(dependency, state, path);
            if (!cycle.isEmpty()) {
                return cycle;
            }
        }
        path.remove(path.size() - 1);
        state.put(fill, 2);
        return List.of();
    }

    /** The fills whose target {@code fill}'s value reads: by root editor name, or a row sibling read as {@code item.x}. */
    private List<FillDefinition> dependencies(FillDefinition fill) {
        List<String> reads = fill.value().identifiers();
        List<FillDefinition> out = new ArrayList<>();
        for (FillDefinition other : fills) {
            if (reads(reads, fill.target(), other.target())) {
                out.add(other);
            }
        }
        return out;
    }

    private static boolean reads(List<String> identifiers, RulePath reader, RulePath written) {
        if (written.isWhole()) {
            return false;
        }
        for (String id : identifiers) {
            String root = id.contains(".") ? id.substring(0, id.indexOf('.')) : id;
            if (!written.hasRows() && root.equals(written.rootName())) {
                return true;
            }
            // A row fill reading a sibling field of the same row: item.<field> against list[].<field>.
            if (written.hasRows() && "item".equals(root) && reader.hasRows() && sameRows(reader, written)) {
                String field = id.contains(".") ? id.substring(id.indexOf('.') + 1) : "";
                String writtenField = written.segments().get(written.segments().size() - 1).name();
                if (field.equals(writtenField) || field.startsWith(writtenField + ".")) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Whether two paths iterate the same rows (same segments up to the last {@code []}). */
    private static boolean sameRows(RulePath a, RulePath b) {
        return rowPrefix(a).equals(rowPrefix(b));
    }

    private static String rowPrefix(RulePath path) {
        String text = path.text();
        int end = text.lastIndexOf("[]");
        return end < 0 ? "" : text.substring(0, end + 2);
    }
}
