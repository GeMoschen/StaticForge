package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Validation and reference extraction of a stored {@code PAGINATION} value (M21.1.1). */
class PaginationValueValidationTest {

    private static final UUID FOLDER = UUID.randomUUID();
    private static final UUID DATASET = UUID.randomUUID();

    private final CdlCompiler cdl = new CdlCompiler();
    private final ContentDefinition definition = cdl.compile("""
            content {
              editor pagination posts {
                sources ["nav", "dataset"]
                pageSize 10
                maxPageSize 50
                sort ["navigation", "date", "title", "body"]
              }
            }
            """).definition();

    /** Knows one navigation folder and one dataset with a text {@code title} and a richtext {@code body}. */
    private final PaginationSourceLookup sources = new PaginationSourceLookup() {
        @Override
        public boolean isNavigationFolder(UUID uuid) {
            return FOLDER.equals(uuid);
        }

        @Override
        public Optional<ContentDefinition> datasetSchema(UUID uuid) {
            return DATASET.equals(uuid)
                    ? Optional.of(cdl.compile("content { editor text title { } editor richtext body { } }").definition())
                    : Optional.empty();
        }
    };

    private final ContentValidator validator = new ContentValidator(new ExpressionEvaluator(), null, sources);

    @Test
    void acceptsAValidValueAndAnUnsetOne() {
        assertThat(issues(value("NAV", FOLDER, 10, "{\"key\":\"date\",\"direction\":\"DESC\"}"))).isEmpty();
        assertThat(issues(value("DATASET", DATASET, 50, "{\"key\":\"title\",\"direction\":\"ASC\"}"))).isEmpty();
        assertThat(issues(value("NAV", FOLDER, 5, "null"))).isEmpty();
        assertThat(validator.validate(definition, JsonUtil.parse("{\"posts\":null}"))).isEmpty();
        assertThat(validator.validate(definition, JsonUtil.parse("{}"))).isEmpty();
    }

    @Test
    void rejectsAMalformedValue() {
        assertThat(issues("{\"type\":\"PAGINATION\",\"pageSize\":10}"))
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.path()).isEqualTo("posts");
                    assertThat(issue.code()).isEqualTo("type");
                    assertThat(issue.kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
                });
        assertThat(issues("{\"type\":\"PAGINATION\",\"source\":{\"kind\":\"NAV\",\"uuid\":\"nope\"},\"pageSize\":10}"))
                .extracting(ContentIssue::code)
                .containsExactly("type");
        assertThat(issues(value("NAV", FOLDER, 10, "{\"key\":\"date\",\"direction\":\"UP\"}")))
                .extracting(ContentIssue::code)
                .containsExactly("type");
    }

    @Test
    void rejectsADisallowedKindSizeOrSortKey() {
        ContentDefinition navOnly = cdl.compile("content { editor pagination posts { pageSize 5 } }").definition();
        assertThat(new ContentValidator(new ExpressionEvaluator(), null, sources)
                        .validate(navOnly, JsonUtil.parse("{\"posts\":" + value("DATASET", DATASET, 5, "null") + "}")))
                .extracting(ContentIssue::path, ContentIssue::code)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("posts.source.kind", "pagination"));

        assertThat(issues(value("NAV", FOLDER, 0, "null"))).extracting(ContentIssue::path).containsExactly("posts.pageSize");
        assertThat(issues(value("NAV", FOLDER, 51, "null"))).extracting(ContentIssue::path).containsExactly("posts.pageSize");
        assertThat(issues(value("NAV", FOLDER, 10, "{\"key\":\"position\"}")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.sort.key");
        // Offered, but a navigation source has no "title".
        assertThat(issues(value("NAV", FOLDER, 10, "{\"key\":\"title\"}")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.sort.key");
        assertThat(issues(value("NAV", FOLDER, 10, "null")))
                .allMatch(issue -> issue.kind() == ContentIssue.Kind.STRUCTURAL);
    }

    @Test
    void checksTheSourceAgainstTheProject() {
        assertThat(issues(value("NAV", DATASET, 10, "null")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.source.uuid");
        assertThat(issues(value("DATASET", FOLDER, 10, "null")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.source.uuid");
        // A dataset source sorts by a declared field with a natural order only.
        assertThat(issues(value("DATASET", DATASET, 10, "{\"key\":\"body\"}")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.sort.key");
        assertThat(issues(value("DATASET", DATASET, 10, "{\"key\":\"navigation\"}")))
                .extracting(ContentIssue::path)
                .containsExactly("posts.sort.key");
    }

    @Test
    void withoutALookupOnlyTheValueIsChecked() {
        assertThat(new ContentValidator().validate(definition, JsonUtil.parse("{\"posts\":" + value("NAV", DATASET, 10, "null") + "}")))
                .isEmpty();
    }

    @Test
    void extractsTheSourceAsAContentReference() {
        List<ExtractedReference> references = new ContentReferenceService()
                .extract(JsonUtil.parse("{\"posts\":" + value("NAV", FOLDER, 10, "null") + "}"), "content");

        assertThat(references).containsExactly(new ExtractedReference(ReferenceKind.CONTENT_REF, FOLDER, "content.posts.source"));
    }

    private List<ContentIssue> issues(String postsValue) {
        return validator.validate(definition, JsonUtil.parse("{\"posts\":" + postsValue + "}"));
    }

    private static String value(String kind, UUID uuid, int pageSize, String sort) {
        return "{\"type\":\"PAGINATION\",\"source\":{\"kind\":\"%s\",\"uuid\":\"%s\"},\"pageSize\":%d,\"sort\":%s}"
                .formatted(kind, uuid, pageSize, sort);
    }
}
