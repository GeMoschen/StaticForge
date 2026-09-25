package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.analysis.TokenStream;
import org.apache.lucene.analysis.tokenattributes.CharTermAttribute;
import org.apache.lucene.document.Document;
import org.apache.lucene.index.LeafReaderContext;
import org.apache.lucene.index.ReaderUtil;
import org.apache.lucene.index.Term;
import org.apache.lucene.search.BooleanClause.Occur;
import org.apache.lucene.search.BooleanQuery;
import org.apache.lucene.search.BoostQuery;
import org.apache.lucene.search.FuzzyQuery;
import org.apache.lucene.search.IndexSearcher;
import org.apache.lucene.search.Matches;
import org.apache.lucene.search.PhraseQuery;
import org.apache.lucene.search.PrefixQuery;
import org.apache.lucene.search.Query;
import org.apache.lucene.search.ScoreDoc;
import org.apache.lucene.search.ScoreMode;
import org.apache.lucene.search.TermQuery;
import org.apache.lucene.search.TopDocs;
import org.apache.lucene.search.TopScoreDocCollectorManager;
import org.apache.lucene.search.Weight;

/**
 * Runs a {@link SearchQuery} against one project's searcher (M23.3.1).
 *
 * <p>The query is built programmatically from {@link SearchInput}; user input never reaches a query parser, so it
 * can't ask for wildcards, field syntax or unbounded expansions. A hit must match one of:
 *
 * <ul>
 *   <li>the whole input as the exact uid (boost 10), or the single word as a uid prefix (boost 6);
 *   <li>every word as a phrase in the title (boost 5), or every word in the title, the last one as a prefix while
 *       typing (boost 4);
 *   <li>every word and phrase in the prose or code fields (German, English and neutral analysis; boost 1).
 * </ul>
 *
 * Type and folder filters don't score. When nothing matches, a second pass allows one edit on words of five or more
 * characters. Facet counts are taken over the query without its type filter, so counts of unselected types stay
 * visible; types are single-valued, so the total is exact.
 */
final class SearchQueryExecutor {

    private static final int UID_EXACT_BOOST = 10;
    private static final int UID_PREFIX_BOOST = 6;
    private static final int TITLE_PHRASE_BOOST = 5;
    private static final int TITLE_TERMS_BOOST = 4;
    private static final int MIN_PREFIX_CHARS = 2;
    private static final int MIN_TEXT_PREFIX_CHARS = 3;
    private static final int MIN_FUZZY_CHARS = 5;

    private static final List<String> BODY_FIELDS =
            List.of(SearchFields.TEXT, SearchFields.TEXT_DE, SearchFields.TEXT_EN, SearchFields.SOURCE);

    /**
     * The prose fields a query reads. Without a language, every field — the pre-M24 behaviour, and
     * still what an editor searching "everything" wants. With one, that language's field plus the
     * code field, so an English query does not match a German-only value through German stemming
     * (M24.3.3). The neutral {@code text} field is part of the language field's own content, so it
     * needs no separate clause.
     */
    private static List<String> bodyFields(SearchQuery query) {
        if (query.locale() == null) {
            return BODY_FIELDS;
        }
        return List.of(SearchFields.proseFor(query.locale()), SearchFields.SOURCE);
    }

    private final Analyzer analyzer;
    private final SnippetBuilder snippets;

    SearchQueryExecutor(Analyzer analyzer) {
        this.analyzer = analyzer;
        this.snippets = new SnippetBuilder(analyzer);
    }

    SearchHits execute(IndexSearcher searcher, SearchQuery query) {
        try {
            SearchInput input = SearchInput.parse(query.text());
            if (input.isEmpty()) {
                return new SearchHits(List.of(), 0, Map.of());
            }
            List<String> bodyFields = bodyFields(query);
            Query match = build(input, false, bodyFields);
            Map<AssetType, Long> counts = match == null
                    ? Map.of()
                    : counts(searcher, filtered(match, Set.of(), query.folder(), query.releaseStatuses()));
            if (total(counts, Set.of()) == 0 && hasFuzzyWords(input)) {
                match = build(input, true, bodyFields);
                counts = counts(searcher, filtered(match, Set.of(), query.folder(), query.releaseStatuses()));
            }
            long total = total(counts, query.types());
            int from = Math.multiplyExact(query.page(), query.size());
            if (match == null || total == 0 || from >= total) {
                return new SearchHits(List.of(), total, counts);
            }
            Query hitsQuery = filtered(match, query.types(), query.folder(), query.releaseStatuses());
            int wanted = (int) Math.min(total, (long) from + query.size());
            TopDocs top = searcher.search(hitsQuery, new TopScoreDocCollectorManager(wanted, null, wanted));
            Weight weight = searcher.createWeight(searcher.rewrite(match), ScoreMode.COMPLETE_NO_SCORES, 1f);
            List<SearchHit> hits = new ArrayList<>();
            for (int i = from; i < top.scoreDocs.length; i++) {
                hits.add(hit(searcher, weight, match, top.scoreDocs[i]));
            }
            return new SearchHits(hits, total, counts);
        } catch (IOException e) {
            throw new UncheckedIOException("Search failed", e);
        }
    }

    // ------------------------------------------------------------------ query construction

    /** The scoring part of the query over every language. */
    Query build(SearchInput input, boolean fuzzy) {
        return build(input, fuzzy, BODY_FIELDS);
    }

    /**
     * The scoring part of the query, or {@code null} when the input yields no clause at all.
     *
     * @param bodyFields the prose/code fields to match words in — one language's, or all of them
     */
    Query build(SearchInput input, boolean fuzzy, List<String> bodyFields) {
        BooleanQuery.Builder any = new BooleanQuery.Builder();
        int clauses = 0;
        boolean single = input.words().size() == 1 && input.phrases().isEmpty();
        if (input.uidCandidate() != null) {
            any.add(new BoostQuery(new TermQuery(new Term(SearchFields.UID_LOWER, input.uidCandidate())), UID_EXACT_BOOST), Occur.SHOULD);
            clauses++;
            if (input.uidCandidate().length() >= MIN_PREFIX_CHARS) {
                any.add(new BoostQuery(new PrefixQuery(new Term(SearchFields.UID_LOWER, input.uidCandidate())), UID_PREFIX_BOOST),
                        Occur.SHOULD);
                clauses++;
            }
        }
        Query titlePhrase = single ? null : titlePhrase(input);
        if (titlePhrase != null) {
            any.add(new BoostQuery(titlePhrase, TITLE_PHRASE_BOOST), Occur.SHOULD);
            clauses++;
        }
        Query titleTerms = allWords(input, fuzzy, List.of(SearchFields.TITLE), MIN_PREFIX_CHARS);
        if (titleTerms != null) {
            any.add(new BoostQuery(titleTerms, TITLE_TERMS_BOOST), Occur.SHOULD);
            clauses++;
        }
        Query body = allWords(input, fuzzy, bodyFields, MIN_TEXT_PREFIX_CHARS);
        if (body != null) {
            any.add(body, Occur.SHOULD);
            clauses++;
        }
        if (clauses == 0) {
            return null;
        }
        return any.setMinimumNumberShouldMatch(1).build();
    }

    /** Every word and phrase must match in one of {@code fields}; {@code null} when some word yields no terms at all. */
    private Query allWords(SearchInput input, boolean fuzzy, List<String> fields, int minPrefixChars) {
        BooleanQuery.Builder all = new BooleanQuery.Builder();
        int required = 0;
        for (int i = 0; i < input.words().size(); i++) {
            boolean prefix = input.prefixLast() && i == input.words().size() - 1;
            Query word = anyField(input.words().get(i), fields, prefix, fuzzy, minPrefixChars);
            if (word == null) {
                continue;
            }
            all.add(word, Occur.MUST);
            required++;
        }
        for (List<String> phrase : input.phrases()) {
            Query words = anyField(String.join(" ", phrase), fields, false, false, minPrefixChars);
            if (words != null) {
                all.add(words, Occur.MUST);
                required++;
            }
        }
        return required == 0 ? null : all.build();
    }

    /** One word (or phrase) in any of {@code fields}, each field analyzing it its own way. */
    private Query anyField(String surface, List<String> fields, boolean prefix, boolean fuzzy, int minPrefixChars) {
        BooleanQuery.Builder any = new BooleanQuery.Builder();
        int clauses = 0;
        for (String field : fields) {
            List<String> terms = analyze(field, surface);
            if (terms.isEmpty()) {
                continue;
            }
            any.add(termsQuery(field, terms), Occur.SHOULD);
            clauses++;
            boolean neutral = !SearchFields.TEXT_DE.equals(field) && !SearchFields.TEXT_EN.equals(field);
            if (neutral && terms.size() == 1) {
                String term = terms.get(0);
                if (prefix && term.length() >= minPrefixChars) {
                    any.add(new PrefixQuery(new Term(field, term)), Occur.SHOULD);
                    clauses++;
                }
                if (fuzzy && term.length() >= MIN_FUZZY_CHARS) {
                    any.add(new FuzzyQuery(new Term(field, term), 1), Occur.SHOULD);
                    clauses++;
                }
            }
        }
        return clauses == 0 ? null : any.build();
    }

    private Query titlePhrase(SearchInput input) {
        List<String> surfaces = new ArrayList<>(input.words());
        input.phrases().forEach(surfaces::addAll);
        List<String> terms = analyze(SearchFields.TITLE, String.join(" ", surfaces));
        return terms.size() < 2 ? null : termsQuery(SearchFields.TITLE, terms);
    }

    private static Query termsQuery(String field, List<String> terms) {
        if (terms.size() == 1) {
            return new TermQuery(new Term(field, terms.get(0)));
        }
        PhraseQuery.Builder phrase = new PhraseQuery.Builder();
        terms.forEach(term -> phrase.add(new Term(field, term)));
        return phrase.build();
    }

    List<String> analyze(String field, String text) {
        List<String> terms = new ArrayList<>();
        try (TokenStream stream = analyzer.tokenStream(field, text)) {
            CharTermAttribute term = stream.addAttribute(CharTermAttribute.class);
            stream.reset();
            while (stream.incrementToken()) {
                terms.add(term.toString());
            }
            stream.end();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return terms;
    }

    private boolean hasFuzzyWords(SearchInput input) {
        return input.words().stream()
                .anyMatch(word -> analyze(SearchFields.TEXT, word).stream().anyMatch(t -> t.length() >= MIN_FUZZY_CHARS));
    }

    private static Query filtered(Query match, Set<AssetType> types, String folder, Set<String> releaseStatuses) {
        if (types.isEmpty() && folder == null && releaseStatuses.isEmpty()) {
            return match;
        }
        BooleanQuery.Builder filtered = new BooleanQuery.Builder().add(match, Occur.MUST);
        if (!types.isEmpty()) {
            BooleanQuery.Builder anyType = new BooleanQuery.Builder();
            types.forEach(type -> anyType.add(new TermQuery(new Term(SearchFields.TYPE, type.name())), Occur.SHOULD));
            filtered.add(anyType.build(), Occur.FILTER);
        }
        if (folder != null) {
            filtered.add(new PrefixQuery(new Term(SearchFields.FOLDER_PATH, folder)), Occur.FILTER);
        }
        if (!releaseStatuses.isEmpty()) {
            BooleanQuery.Builder anyStatus = new BooleanQuery.Builder();
            releaseStatuses.forEach(status ->
                    anyStatus.add(new TermQuery(new Term(SearchFields.RELEASE_STATUS, status)), Occur.SHOULD));
            filtered.add(anyStatus.build(), Occur.FILTER);
        }
        return filtered.build();
    }

    // ------------------------------------------------------------------ results

    private static Map<AssetType, Long> counts(IndexSearcher searcher, Query query) throws IOException {
        return searcher.search(query, new TypeCounts.Manager());
    }

    private static long total(Map<AssetType, Long> counts, Set<AssetType> types) {
        return counts.entrySet().stream()
                .filter(entry -> types.isEmpty() || types.contains(entry.getKey()))
                .mapToLong(Map.Entry::getValue)
                .sum();
    }

    private SearchHit hit(IndexSearcher searcher, Weight weight, Query match, ScoreDoc scoreDoc) throws IOException {
        Document doc = searcher.storedFields().document(scoreDoc.doc);
        AssetType type = AssetType.valueOf(doc.get(SearchFields.TYPE));
        SearchHit.MatchedIn matchedIn = matchedIn(searcher, weight, scoreDoc.doc);
        String snippetSource = doc.get(SearchFields.SNIPPET_SOURCE);
        String templateUuid = doc.get(SearchFields.TEMPLATE_UUID);
        return new SearchHit(
                UUID.fromString(doc.get(SearchFields.UUID)),
                type,
                doc.get(SearchFields.UID),
                doc.get(SearchFields.DISPLAY_NAME),
                doc.get(SearchFields.FOLDER_PATH),
                templateUuid == null ? null : UUID.fromString(templateUuid),
                scoreDoc.score,
                matchedIn,
                snippets.build(match, snippetSource == null ? "" : snippetSource));
    }

    /** Where a hit matched, preferring the most specific: uid, then title, then prose, then code. */
    private static SearchHit.MatchedIn matchedIn(IndexSearcher searcher, Weight weight, int doc) throws IOException {
        List<LeafReaderContext> leaves = searcher.getIndexReader().leaves();
        LeafReaderContext leaf = leaves.get(ReaderUtil.subIndex(doc, leaves));
        Matches matches = weight.matches(leaf, doc - leaf.docBase);
        EnumMap<SearchHit.MatchedIn, Boolean> found = new EnumMap<>(SearchHit.MatchedIn.class);
        if (matches != null) {
            for (String field : matches) {
                switch (field) {
                    case SearchFields.UID_LOWER -> found.put(SearchHit.MatchedIn.UID, true);
                    case SearchFields.TITLE -> found.put(SearchHit.MatchedIn.TITLE, true);
                    case SearchFields.SOURCE -> found.put(SearchHit.MatchedIn.SOURCE, true);
                    default -> found.put(SearchHit.MatchedIn.CONTENT, true);
                }
            }
        }
        for (SearchHit.MatchedIn candidate : List.of(
                SearchHit.MatchedIn.UID, SearchHit.MatchedIn.TITLE, SearchHit.MatchedIn.CONTENT, SearchHit.MatchedIn.SOURCE)) {
            if (found.containsKey(candidate)) {
                return candidate;
            }
        }
        return SearchHit.MatchedIn.CONTENT;
    }
}
