package com.acme.staticforge.search;

import java.util.Map;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.analysis.LowerCaseFilter;
import org.apache.lucene.analysis.TokenStream;
import org.apache.lucene.analysis.Tokenizer;
import org.apache.lucene.analysis.de.GermanAnalyzer;
import org.apache.lucene.analysis.de.GermanNormalizationFilter;
import org.apache.lucene.analysis.en.EnglishAnalyzer;
import org.apache.lucene.analysis.miscellaneous.ASCIIFoldingFilter;
import org.apache.lucene.analysis.miscellaneous.PerFieldAnalyzerWrapper;
import org.apache.lucene.analysis.standard.StandardTokenizer;

/**
 * The analyzers of the search index (M23.1.1). One {@link PerFieldAnalyzerWrapper} is used for indexing, query
 * construction and highlighting, so a term is always produced the same way on both sides.
 *
 * <p>The neutral analyzer folds umlauts and diacritics so {@code Häuser}, {@code haeuser} and {@code hauser} meet:
 * lowercase, then German normalization ({@code ä}→{@code a}, {@code ae}→{@code a}, {@code ß}→{@code ss}), then
 * ASCII folding for every other accent. {@code text_de} and {@code text_en} add stemming, so inflected forms match.
 */
public final class SearchAnalyzers {

    private SearchAnalyzers() {}

    /** The per-field analyzer: German and English analyzers on their fields, the neutral analyzer everywhere else. */
    public static Analyzer create() {
        return new PerFieldAnalyzerWrapper(
                neutral(),
                Map.of(SearchFields.TEXT_DE, new GermanAnalyzer(), SearchFields.TEXT_EN, new EnglishAnalyzer()));
    }

    /** Standard tokenizer, lowercase, German normalization, ASCII folding. */
    public static Analyzer neutral() {
        return new Analyzer() {
            @Override
            protected TokenStreamComponents createComponents(String fieldName) {
                Tokenizer tokenizer = new StandardTokenizer();
                TokenStream stream = new LowerCaseFilter(tokenizer);
                stream = new GermanNormalizationFilter(stream);
                stream = new ASCIIFoldingFilter(stream);
                return new TokenStreamComponents(tokenizer, stream);
            }

            @Override
            protected TokenStream normalize(String fieldName, TokenStream in) {
                return new ASCIIFoldingFilter(new GermanNormalizationFilter(new LowerCaseFilter(in)));
            }
        };
    }
}
