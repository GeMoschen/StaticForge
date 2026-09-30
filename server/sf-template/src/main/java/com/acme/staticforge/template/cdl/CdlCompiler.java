package com.acme.staticforge.template.cdl;

import com.acme.staticforge.template.cdl.CdlLexer.LexResult;
import com.acme.staticforge.template.cdl.CdlLexer.Token;
import com.acme.staticforge.template.cdl.CdlLexer.TokenType;
import com.acme.staticforge.template.cdl.CdlParser.ParseResult;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
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

    /**
     * Compiles a holder's three CDL sections (M34) as one definition: each section is lexed on its own, its lines
     * encoded with its section ({@link CdlSources#encodeLine}), and wrapped in its keyword and braces. A section's
     * text can't close its own section: an unmatched {@code '}'} is reported and dropped, an unclosed {@code '{'}
     * reported and closed at the end of the section. Every diagnostic names its section in {@code field}. An empty
     * bodies or rules section is left out.
     */
    public CdlResult compile(CdlSources sources) {
        CdlSources s = sources == null ? CdlSources.EMPTY : sources;
        List<Diagnostic> diagnostics = new ArrayList<>();
        List<Token> tokens = new ArrayList<>();
        for (String section : CdlSources.SECTIONS) {
            LexResult lexed = new CdlLexer().lex(s.section(section));
            lexed.diagnostics().forEach(d -> diagnostics.add(d.inField(section)));
            List<Token> body = lexed.tokens().subList(0, lexed.tokens().size() - 1);
            Token eof = lexed.tokens().get(lexed.tokens().size() - 1);
            if (body.isEmpty() && !CdlSources.CONTENT.equals(section)) {
                continue;
            }
            tokens.add(new Token(TokenType.IDENT, section, CdlSources.encodeLine(section, 0), 0));
            tokens.add(new Token(TokenType.LBRACE, "{", CdlSources.encodeLine(section, 0), 0));
            int depth = 0;
            for (Token t : body) {
                if (t.type() == TokenType.LBRACE) {
                    depth++;
                } else if (t.type() == TokenType.RBRACE) {
                    if (depth == 0) {
                        diagnostics.add(new Diagnostic(Severity.ERROR,
                                DiagnosticCodes.CDL_SYNTAX, "Unmatched '}'", t.line(), t.column(), section));
                        continue;
                    }
                    depth--;
                }
                tokens.add(new Token(t.type(), t.text(), CdlSources.encodeLine(section, t.line()), t.column()));
            }
            int endLine = CdlSources.encodeLine(section, eof.line());
            if (depth > 0) {
                diagnostics.add(new Diagnostic(Severity.ERROR,
                        DiagnosticCodes.CDL_SYNTAX, "Missing '}'", eof.line(), eof.column(), section));
                for (int i = 0; i < depth; i++) {
                    tokens.add(new Token(TokenType.RBRACE, "}", endLine, eof.column()));
                }
            }
            tokens.add(new Token(TokenType.RBRACE, "}", endLine, eof.column()));
        }
        tokens.add(new Token(TokenType.EOF, "", 0, 0));

        ParseResult parsed = new CdlParser(tokens).parse();
        CdlValidator.Result validated = new CdlValidator().validate(parsed.content());
        diagnostics.addAll(parsed.diagnostics());
        diagnostics.addAll(validated.diagnostics());
        return new CdlResult(validated.definition(), diagnostics);
    }
}
