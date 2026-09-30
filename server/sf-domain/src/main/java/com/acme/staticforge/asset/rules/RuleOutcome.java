package com.acme.staticforge.asset.rules;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What the rule engine found in one scope (M33.3): the {@code findings} that apply there (structural ones always), the
 * {@code fills} it applied, the {@code fieldStates} it computed, the {@code content} with the fills applied, and the
 * assets {@code ref(...)} resolved ({@code refTargets}, the generation scope's planner edge).
 */
public record RuleOutcome(
        List<ContentIssue> findings,
        List<RuleFill> fills,
        List<FieldState> fieldStates,
        JsonNode content,
        Set<UUID> refTargets) {

    public RuleOutcome {
        findings = List.copyOf(findings);
        fills = List.copyOf(fills);
        fieldStates = List.copyOf(fieldStates);
        refTargets = Set.copyOf(refTargets);
    }

    /** The findings that block {@code scope}'s action. */
    public List<ContentIssue> blocking(RuleScope scope) {
        return findings.stream().filter(f -> f.blocks(scope)).toList();
    }

    public boolean blocks(RuleScope scope) {
        return findings.stream().anyMatch(f -> f.blocks(scope));
    }
}
