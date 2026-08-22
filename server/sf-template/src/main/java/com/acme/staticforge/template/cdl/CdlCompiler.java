package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlLexer.LexResult;
import com.acme.staticforge.template.cdl.CdlParser.ParseResult;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayList;
import java.util.List;

/**
 * CDL compiler pipeline (spec §14.7): {@code source → lex → parse → validate →}
 * {@code (ContentDefinition, Diagnostics[])}. Dependency-free (no Spring); a new instance is
 * cheap and safe to reuse across compilations.
 */
public final class CdlCompiler {

    /** Creates a compiler. Stateless; a single instance may compile any number of documents. */
    public CdlCompiler() {}

    /**
     * Compiles CDL source into a best-effort {@link ContentDefinition} and a complete list of
     * diagnostics. Never throws for malformed input.
     */
    public CdlResult compile(String source) {
        String text = source == null ? "" : source;
        LexResult lexed = new CdlLexer().lex(text);
        ParseResult parsed = new CdlParser(lexed.tokens()).parse();
        CdlValidator.Result validated = new CdlValidator().validate(parsed.content());

        List<Diagnostic> diagnostics = new ArrayList<>();
        diagnostics.addAll(lexed.diagnostics());
        diagnostics.addAll(parsed.diagnostics());
        diagnostics.addAll(validated.diagnostics());
        return new CdlResult(validated.definition(), diagnostics);
    }
}
