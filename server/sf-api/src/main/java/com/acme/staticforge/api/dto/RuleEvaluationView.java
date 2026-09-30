package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.rules.FieldState;
import com.acme.staticforge.asset.rules.RuleFill;
import java.util.List;

/**
 * The {@code edit} outcome of an unsaved value (M33.5): {@code findings} of every level (built-ins and rules, messages
 * in the {@code Accept-Language} UI language), the {@code fills} an {@code edit}-scope fill computed, and the
 * {@code fieldStates} ({@code required} / {@code readOnly}) the form applies.
 */
public record RuleEvaluationView(List<ContentIssue> findings, List<RuleFill> fills, List<FieldState> fieldStates) {}
