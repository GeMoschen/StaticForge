package com.acme.staticforge.template.diagnostic;

import java.util.UUID;

/**
 * A page a finding is about, as data: {@code uuid} for a link to its editor, {@code uid}, {@code displayName} and
 * {@code path} ({@code <folder>/<uid>} below the pages root) to name it. See {@link Diagnostic#pages()}.
 */
public record DiagnosticPage(UUID uuid, String uid, String displayName, String path) {}
