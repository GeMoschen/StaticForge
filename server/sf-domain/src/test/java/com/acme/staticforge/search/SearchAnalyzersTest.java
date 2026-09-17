package com.acme.staticforge.search;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Analyzer behavior through the index (M23.1.1): stemming per language, folding, uid matching. */
class SearchAnalyzersTest {

    @TempDir
    Path root;

    private SearchIndexServiceImpl index;
    private final SearchQueryExecutor executor = new SearchQueryExecutor(SearchAnalyzers.create());

    @BeforeEach
    void setUp() {
        index = new SearchIndexServiceImpl(SearchIndexServiceTest.properties(root, SearchProperties.DirectoryType.MEMORY));
    }

    @AfterEach
    void tearDown() {
        index.destroy();
    }

    private void add(String uid, String text) {
        index.upsert(1, new SearchDocument(UUID.randomUUID(), AssetType.PAGE, uid, uid, "/", null, 1, uid, text, ""));
        index.commit(1, 1, "owner");
    }

    private boolean finds(String q) {
        return index.search(1, SearchQuery.of(q, 20)).totalHits() > 0;
    }

    @Test
    void germanFieldMatchesInflectedForms() {
        add("p1", "Das Haus am See");
        assertThat(finds("Häuser")).isTrue();
        assertThat(executor.analyze(SearchFields.TEXT_DE, "Häuser"))
                .isEqualTo(executor.analyze(SearchFields.TEXT_DE, "Haus"));
    }

    @Test
    void englishFieldMatchesInflectedForms() {
        add("p1", "I run every morning");
        assertThat(finds("running")).isTrue();
        assertThat(executor.analyze(SearchFields.TEXT_EN, "running"))
                .isEqualTo(executor.analyze(SearchFields.TEXT_EN, "run"));
    }

    @Test
    void neutralFieldFoldsUmlautsAndTransliterations() {
        assertThat(executor.analyze(SearchFields.TEXT, "Häuser")).containsExactly("hauser");
        assertThat(executor.analyze(SearchFields.TEXT, "hauser")).containsExactly("hauser");
        assertThat(executor.analyze(SearchFields.TEXT, "haeuser")).containsExactly("hauser");
        assertThat(executor.analyze(SearchFields.TEXT, "Crème brûlée")).containsExactly("creme", "brulee");

        add("p1", "Alte Häuser");
        assertThat(finds("hauser")).isTrue();
        assertThat(finds("haeuser")).isTrue();
    }

    @Test
    void codeIsNotStemmed() {
        assertThat(executor.analyze(SearchFields.SOURCE, "running")).containsExactly("running");
    }

    @Test
    void uidExactAndPrefixMatchIgnoreCase() {
        index.upsert(1, new SearchDocument(
                UUID.randomUUID(), AssetType.SECTION_TEMPLATE, "Home_Teaser", "Something else", "/", null, 1,
                "Something else", "", ""));
        index.commit(1, 1, "owner");

        SearchHits exact = index.search(1, SearchQuery.of("home_teaser", 20));
        assertThat(exact.totalHits()).isEqualTo(1);
        assertThat(exact.hits().get(0).matchedIn()).isEqualTo(SearchHit.MatchedIn.UID);
        assertThat(finds("HOME_TEA")).isTrue();
        assertThat(finds("home_x")).isFalse();
    }
}
