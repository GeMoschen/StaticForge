package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.diagnostic.Severity;
import java.util.Set;

/**
 * A single content-validation finding (spec §14.4). {@code path} is the editor name (or a
 * dotted/indexed path into a {@code list} item, a catalog card or a body section, e.g.
 * {@code bodies.main[2].content.links[0].target}); {@code code} is a stable machine-readable
 * code; {@link Severity#ERROR} findings block publish, {@link Severity#WARNING} findings are
 * advisory only. {@code kind} tells a save apart from a publish (spec §10.5): a
 * {@link Kind#STRUCTURAL} finding makes the value unsavable, a {@link Kind#COMPLETENESS} finding
 * only blocks publish.
 */
public record ContentIssue(String path, String code, Severity severity, String message, Kind kind) {

    /** Creates a finding whose {@link Kind} is derived from {@code code} (see {@link Kind#of}). */
    public ContentIssue(String path, String code, Severity severity, String message) {
        this(path, code, severity, message, Kind.of(code));
    }

    /** Whether a finding rejects the save or only blocks publish (spec §10.5). */
    public enum Kind {
        /** The stored value has the wrong shape for its editor/template: saving it is rejected. */
        STRUCTURAL,
        /** The value is well-formed but unfinished or out of bounds: it saves, but blocks publish. */
        COMPLETENESS;

        /**
         * Codes that describe a malformed value: {@code type} (wrong JSON type or ref/link/catalog
         * shape), {@code option} (a value outside the declared options), {@code allow} (a section
         * or catalog card whose template is not allowed there), {@code template} (a card whose
         * template does not resolve), {@code dataset} (a reference outside its dataset, M19.3.2) and {@code pagination} (a
         * pagination value with an unknown or disallowed source, page size or sort key, M21.1.1). Every other code ({@code required}, {@code min},
         * {@code max}, {@code maxLength}, {@code maxChars}, {@code pattern}, {@code mimeType},
         * {@code visibleWhen}) is a completeness finding.
         */
        private static final Set<String> STRUCTURAL_CODES = Set.of(
                "type", "option", "allow", "template", "dataset", "pagination");

        public static Kind of(String code) {
            return STRUCTURAL_CODES.contains(code) ? STRUCTURAL : COMPLETENESS;
        }
    }
}
