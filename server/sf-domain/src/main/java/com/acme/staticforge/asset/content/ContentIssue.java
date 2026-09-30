package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.rules.OnGeneration;
import com.acme.staticforge.template.rules.RuleScope;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * A single content-validation finding (spec §14.4). {@code path} is the editor name (or a
 * dotted/indexed path into a {@code list} item, a catalog card or a body section, e.g.
 * {@code bodies.main[2].content.links[0].target}); {@code code} is a stable machine-readable
 * code. {@code kind} tells a save apart from a publish (spec §10.5): a {@link Kind#STRUCTURAL}
 * finding makes the value unsavable in every scope; a {@link Kind#COMPLETENESS} finding blocks
 * exactly the actions of its {@code scopes} when it is an {@link Severity#ERROR} ({@link #blocks}).
 *
 * <p>Editor rules (M33) add: {@code rule} — the custom rule's name, or the built-in's code
 * ({@code required}, {@code maxLength}, …); {@code scopes} — where the finding applies;
 * {@code messages} — the author's message per UI language ({@code message} is the one resolved for the
 * request); {@code locale} — the language the finding is about ({@code null} when not
 * language-specific); {@code onGeneration} — what a blocking finding does to a build.
 */
public record ContentIssue(
        String path,
        String code,
        Severity severity,
        String message,
        Kind kind,
        String rule,
        Set<RuleScope> scopes,
        Map<String, String> messages,
        String locale,
        OnGeneration onGeneration) {

    /** The scopes of a finding that doesn't say: every scope for structural ones, edit/release/generation otherwise. */
    public static final Set<RuleScope> DEFAULT_SCOPES = Set.of(RuleScope.EDIT, RuleScope.RELEASE, RuleScope.GENERATION);

    private static final Set<RuleScope> ALL_SCOPES = Set.copyOf(EnumSet.allOf(RuleScope.class));

    public ContentIssue {
        scopes = scopes == null ? (kind == Kind.STRUCTURAL ? ALL_SCOPES : DEFAULT_SCOPES) : Set.copyOf(scopes);
        messages = messages == null ? Map.of() : Map.copyOf(messages);
        onGeneration = onGeneration == null ? OnGeneration.HOLD_BACK : onGeneration;
        rule = rule == null ? code : rule;
    }

    /** Creates a finding whose {@link Kind} is derived from {@code code} (see {@link Kind#of}). */
    public ContentIssue(String path, String code, Severity severity, String message) {
        this(path, code, severity, message, Kind.of(code));
    }

    /** A finding with today's scopes: every scope when structural, edit/release/generation otherwise. */
    public ContentIssue(String path, String code, Severity severity, String message, Kind kind) {
        this(path, code, severity, message, kind, null, null, null, null, null);
    }

    /**
     * Whether this finding blocks the action of {@code scope}: an {@code ERROR} that applies there (M33). Structural
     * findings apply in every scope, so they block every action, as before.
     */
    public boolean blocks(RuleScope scope) {
        return severity == Severity.ERROR && scopes.contains(scope);
    }

    /** Whether the finding applies in {@code scope}. */
    public boolean appliesIn(RuleScope scope) {
        return scopes.contains(scope);
    }

    /** This finding about {@code locale}. */
    public ContentIssue withLocale(String locale) {
        return new ContentIssue(path, code, severity, message, kind, rule, scopes, messages, locale, onGeneration);
    }

    /** This finding under another path (a prefix added by the caller). */
    public ContentIssue withPath(String newPath) {
        return new ContentIssue(newPath, code, severity, message, kind, rule, scopes, messages, locale, onGeneration);
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
         * {@code visibleWhen}, and every editor rule, M33) is a completeness finding.
         */
        private static final Set<String> STRUCTURAL_CODES = Set.of(
                "type", "option", "allow", "template", "dataset", "pagination");

        public static Kind of(String code) {
            return STRUCTURAL_CODES.contains(code) ? STRUCTURAL : COMPLETENESS;
        }
    }
}
