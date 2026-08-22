package com.acme.staticforge.structure;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Hand-written parser for the §17.1 structure source grammar (no external parser
 * libraries). Accepts text of the form:
 *
 * <pre>
 * navigation {
 *   source {
 *     root      page:home
 *     depth     3
 *     include   pages where nav.visible == true
 *     exclude   pages where nav.noIndex == true
 *     order by  nav.position asc, displayName asc
 *     expand    activePathOnly
 *   }
 * }
 * </pre>
 *
 * <p>The leading keyword sets {@link StructureKind}; {@code source {…}} holds the root/depth/
 * include/exclude/order-by/expand lines; the optional {@code node {…}} block is tolerated and
 * ignored (node field semantics are fixed by {@link NavNode}). Unknown keywords and omitted
 * lines fall back to {@link StructureSource} defaults, so the parser is deliberately lenient.
 * Only a missing kind, an unparsable {@code root}/{@code depth}, or a malformed
 * {@code include}/{@code exclude} is rejected with a 422. A trailing {@code #} comment is
 * stripped per line.
 */
public final class StructureSourceParser {

    public StructureSource parse(String text) {
        String cleaned = stripComments(text == null ? "" : text);
        String trimmed = cleaned.trim();
        if (trimmed.isEmpty()) {
            throw malformed("Structure source is empty.");
        }

        StructureKind kind = parseKind(trimmed);

        String sourceBlock = blockContent(trimmed, "source");
        StructureRoot root = null;
        int depth = StructureSource.DEFAULT_DEPTH;
        List<String> include = new ArrayList<>();
        List<String> exclude = new ArrayList<>();
        List<OrderClause> orderBy = null;
        ExpandMode expand = null;

        if (sourceBlock != null) {
            for (Clause clause : splitClauses(sourceBlock)) {
                switch (clause.keyword()) {
                    case "root" -> root = parseRoot(clause.rest());
                    case "depth" -> depth = parseDepth(clause.rest());
                    case "include" -> include.add(parseWhere(clause.rest()));
                    case "exclude" -> exclude.add(parseWhere(clause.rest()));
                    case "order" -> orderBy = parseOrder(clause.rest());
                    case "expand" -> expand = parseExpand(clause.rest());
                    default -> { /* unknown clause tolerated */ }
                }
            }
        }

        return new StructureSource(kind, root, depth, include, exclude, orderBy, expand);
    }

    /** Renders the structure source back to canonical text (for the editor round-trip). */
    public String toText(StructureSource source) {
        StringBuilder sb = new StringBuilder();
        sb.append(kindKeyword(source.kind())).append(" {\n");
        sb.append("  source {\n");
        if (source.root() != null) {
            String ref = source.root().kind() == RootKind.PAGE ? "page:" : "folder:";
            sb.append("    root      ").append(ref).append(source.root().ref()).append('\n');
        }
        sb.append("    depth     ").append(source.depth()).append('\n');
        for (String inc : source.include()) {
            sb.append("    include   pages where ").append(inc).append('\n');
        }
        for (String exc : source.exclude()) {
            sb.append("    exclude   pages where ").append(exc).append('\n');
        }
        sb.append("    order by  ");
        List<OrderClause> orderBy = source.orderBy() == null ? StructureSource.DEFAULT_ORDER : source.orderBy();
        for (int i = 0; i < orderBy.size(); i++) {
            if (i > 0) {
                sb.append(", ");
            }
            OrderClause clause = orderBy.get(i);
            sb.append(clause.field()).append(clause.ascending() ? " asc" : " desc");
        }
        sb.append('\n');
        sb.append("    expand    ").append(expandKeyword(source.expand())).append('\n');
        sb.append("  }\n");
        sb.append("}\n");
        return sb.toString();
    }

    // ------------------------------------------------------------------
    // Individual clause parsing
    // ------------------------------------------------------------------

    private static StructureRoot parseRoot(String value) {
        String v = value.trim();
        if (v.startsWith("page:")) {
            return new StructureRoot(RootKind.PAGE, v.substring("page:".length()).trim());
        }
        if (v.startsWith("folder:")) {
            return new StructureRoot(RootKind.FOLDER, v.substring("folder:".length()).trim());
        }
        throw malformed("Malformed 'root'; expected 'page:<uid>' or 'folder:<path>'.");
    }

    private static int parseDepth(String value) {
        String v = value.trim();
        if (v.isEmpty()) {
            return StructureSource.DEFAULT_DEPTH;
        }
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            throw malformed("Malformed 'depth': '" + value.trim() + "' is not an integer.");
        }
    }

    private static String parseWhere(String rest) {
        String lowerRest = lower(rest);
        int where = indexOfWord(lowerRest, "where", 0);
        if (where < 0) {
            throw malformed("Malformed 'include/exclude'; expected 'pages where <expression>'.");
        }
        return rest.substring(where + "where".length()).trim();
    }

    private static List<OrderClause> parseOrder(String value) {
        String v = value.trim();
        if (v.startsWith("by")) {
            v = v.substring("by".length()).trim();
        }
        List<OrderClause> clauses = new ArrayList<>();
        for (String part : v.split(",")) {
            String clauseText = part.trim();
            if (clauseText.isEmpty()) {
                continue;
            }
            String[] words = clauseText.split("\\s+");
            String field = words[0];
            boolean ascending = true;
            if (words.length > 1) {
                ascending = !"desc".equalsIgnoreCase(words[1]);
            }
            clauses.add(new OrderClause(field, ascending));
        }
        return clauses.isEmpty() ? null : clauses;
    }

    private static ExpandMode parseExpand(String value) {
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "all" -> ExpandMode.ALL;
            case "activepathonly", "active_path_only", "active-path-only" -> ExpandMode.ACTIVE_PATH_ONLY;
            case "none" -> ExpandMode.NONE;
            default -> ExpandMode.ACTIVE_PATH_ONLY;
        };
    }

    private static StructureKind parseKind(String text) {
        int i = 0;
        int n = text.length();
        while (i < n && Character.isWhitespace(text.charAt(i))) {
            i++;
        }
        StringBuilder word = new StringBuilder();
        while (i < n && Character.isLetter(text.charAt(i))) {
            word.append(text.charAt(i));
            i++;
        }
        return switch (word.toString().toLowerCase(Locale.ROOT)) {
            case "navigation" -> StructureKind.NAVIGATION;
            case "breadcrumb" -> StructureKind.BREADCRUMB;
            case "list" -> StructureKind.LIST;
            default -> throw malformed("Missing structure kind; expected 'navigation', 'breadcrumb' or 'list'.");
        };
    }

    private static String kindKeyword(StructureKind kind) {
        return switch (kind) {
            case NAVIGATION -> "navigation";
            case BREADCRUMB -> "breadcrumb";
            case LIST -> "list";
        };
    }

    private static String expandKeyword(ExpandMode mode) {
        return switch (mode) {
            case ALL -> "all";
            case ACTIVE_PATH_ONLY -> "activePathOnly";
            case NONE -> "none";
        };
    }

    // ------------------------------------------------------------------
    // Text helpers
    // ------------------------------------------------------------------

    private static SfException malformed(String detail) {
        return new SfException(ProblemFactory.unprocessableEntity(detail));
    }

    /** Extracts the brace-delimited body following a keyword block ({@code source}, {@code node}). */
    private static String blockContent(String text, String keyword) {
        int idx = indexOfWord(text, keyword, 0);
        if (idx < 0) {
            return null;
        }
        int brace = text.indexOf('{', idx + keyword.length());
        if (brace < 0) {
            return null;
        }
        int end = matchingBrace(text, brace);
        if (end < 0) {
            return null;
        }
        return text.substring(brace + 1, end);
    }

    /**
     * Splits the {@code source} block into {@code keyword rest} clauses. Line breaks act as
     * hard clause boundaries; within a single line (the compact form) clauses are further split
     * on the known keywords {@code root}, {@code depth}, {@code include}, {@code exclude},
     * {@code order}, {@code expand}. Each clause's rest runs to the next keyword or the end of
     * the line.
     */
    private static List<Clause> splitClauses(String content) {
        List<Clause> clauses = new ArrayList<>();
        for (String line : content.split("\\r?\\n")) {
            splitLine(line, clauses);
        }
        return clauses;
    }

    private static void splitLine(String line, List<Clause> clauses) {
        int pos = 0;
        int n = line.length();
        while (pos < n) {
            int bestIdx = -1;
            String bestKw = null;
            for (String kw : CLAUSE_KEYWORDS) {
                int idx = indexOfWord(line, kw, pos);
                if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
                    bestIdx = idx;
                    bestKw = kw;
                }
            }
            if (bestKw == null) {
                break;
            }
            int end = nextKeyword(line, bestIdx + bestKw.length());
            clauses.add(new Clause(bestKw, line.substring(bestIdx + bestKw.length(), end).trim()));
            pos = end;
        }
    }

    private static int nextKeyword(String content, int from) {
        int best = content.length();
        for (String kw : CLAUSE_KEYWORDS) {
            int idx = indexOfWord(content, kw, from);
            if (idx >= 0) {
                best = Math.min(best, idx);
            }
        }
        return best;
    }

    private static final List<String> CLAUSE_KEYWORDS =
            List.of("root", "depth", "include", "exclude", "order", "expand");

    private record Clause(String keyword, String rest) {}

    /** Index of {@code word} as a whole word from {@code from}, or {@code -1}. */
    private static int indexOfWord(String text, String word, int from) {
        int i = from;
        while (true) {
            int idx = text.indexOf(word, i);
            if (idx < 0) {
                return -1;
            }
            boolean before = idx == 0 || !isWordChar(text.charAt(idx - 1));
            int afterIdx = idx + word.length();
            boolean after = afterIdx >= text.length() || !isWordChar(text.charAt(afterIdx));
            if (before && after) {
                return idx;
            }
            i = idx + 1;
        }
    }

    private static int matchingBrace(String text, int openIdx) {
        int depth = 0;
        boolean inString = false;
        char quote = 0;
        for (int i = openIdx; i < text.length(); i++) {
            char c = text.charAt(i);
            if (inString) {
                if (c == quote) {
                    inString = false;
                }
                continue;
            }
            if (c == '"' || c == '\'') {
                inString = true;
                quote = c;
            } else if (c == '{') {
                depth++;
            } else if (c == '}') {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    private static String stripComments(String text) {
        StringBuilder sb = new StringBuilder(text.length());
        boolean inString = false;
        char quote = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (inString) {
                sb.append(c);
                if (c == quote) {
                    inString = false;
                }
            } else if (c == '"' || c == '\'') {
                inString = true;
                quote = c;
                sb.append(c);
            } else if (c == '#') {
                while (i < text.length() && text.charAt(i) != '\n') {
                    i++;
                }
                if (i < text.length()) {
                    sb.append('\n');
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static boolean isWordChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '.';
    }

    private static String lower(String s) {
        return s.toLowerCase(Locale.ROOT);
    }
}
