package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.diagnostic.Severity;

/**
 * A single content-validation finding (spec §14.4). {@code path} is the editor name (or a
 * dotted/indexed path into a {@code list} item); {@code code} is a stable machine-readable
 * code; {@link Severity#ERROR} findings block publish, {@link Severity#WARNING} findings are
 * advisory only.
 */
public record ContentIssue(String path, String code, Severity severity, String message) {}
