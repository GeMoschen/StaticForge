package com.acme.staticforge.template.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.octl.Accessor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/** {@code M19.3.1}: query semantics — operators by type, nulls, sort, offset/limit, folders. */
class DatasetQueryEvaluatorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String PHOTO = "11111111-1111-1111-1111-111111111111";

    private final List<RecordView> team = List.of(
            record("ada", "Ada", "/team/leads/", "{\"name\":\"Ada\",\"role\":\"lead\",\"level\":3,\"joined\":\"2021-03-01\","
                    + "\"active\":true,\"tags\":[\"vip\",\"founder\"],\"photo\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + PHOTO + "\"}}"),
            record("bob", "bob", "/team/", "{\"name\":\"bob\",\"role\":\"dev\",\"level\":1.5,\"joined\":\"2023-07-15T09:30:00Z\","
                    + "\"active\":false,\"tags\":[]}"),
            record("cy", "Cy", "/team/", "{\"name\":\"Cy\",\"role\":\"dev\",\"level\":2,\"joined\":\"2022-11-30\",\"active\":true}"),
            record("dee", "Dee", "/alumni/", "{\"name\":\"Dee\",\"role\":\"lead\",\"joined\":null}"));

    @Test
    void comparisonsByType() {
        assertThat(uids("member.role == 'lead'")).containsExactly("ada", "dee");
        assertThat(uids("member.role != 'lead'")).containsExactly("bob", "cy");
        assertThat(uids("member.level > 1.5")).containsExactly("ada", "cy");
        assertThat(uids("member.level >= 1.5")).containsExactly("ada", "bob", "cy");
        assertThat(uids("member.level < 2")).containsExactly("bob");
        assertThat(uids("member.level <= 2")).containsExactly("bob", "cy");
        assertThat(uids("member.level == 2.0")).containsExactly("cy");
        assertThat(uids("member.active == true")).containsExactly("ada", "cy");
        assertThat(uids("member.active")).containsExactly("ada", "cy");
        assertThat(uids("!member.active")).containsExactly("bob", "dee");
    }

    @Test
    void stringsAreCaseSensitiveWithEquals() {
        assertThat(uids("member.name == 'Bob'")).isEmpty();
        assertThat(uids("member.name == 'bob'")).containsExactly("bob");
        assertThat(uids("member.name | lower == 'ada'")).containsExactly("ada");
    }

    @Test
    void datesCompareChronologicallyAcrossDateAndDateTime() {
        assertThat(uids("member.joined > '2022-01-01'")).containsExactly("bob", "cy");
        assertThat(uids("member.joined < '2023-07-15T10:00:00+00:00'")).containsExactly("ada", "bob", "cy");
        assertThat(uids("member.joined == '2021-03-01T00:00:00Z'")).containsExactly("ada");
    }

    @Test
    void nullsAndMissingValues() {
        assertThat(uids("member.joined == null")).containsExactly("dee");
        assertThat(uids("member.level == null")).containsExactly("dee");
        assertThat(uids("member.level != null")).containsExactly("ada", "bob", "cy");
        assertThat(uids("member.level < 100")).containsExactly("ada", "bob", "cy");
        assertThat(uids("member.nope > 0 || member.nope < 0")).isEmpty();
    }

    @Test
    void typeMismatchIsFalseNotAnError() {
        assertThat(uids("member.level == '3'")).isEmpty();
        assertThat(uids("member.name > 1")).isEmpty();
        assertThat(uids("member.active < true")).isEmpty();
    }

    @Test
    void inAgainstArraysAndStrings() {
        assertThat(uids("member.role in ['lead', 'cto']")).containsExactly("ada", "dee");
        assertThat(uids("'vip' in member.tags")).containsExactly("ada");
        assertThat(uids("'ea' in member.role")).containsExactly("ada", "dee");
        assertThat(uids("member.level in [1.5, 2]")).containsExactly("bob", "cy");
    }

    @Test
    void startsWithAndContainsOnTextAndLists() {
        assertThat(uids("member.name startsWith 'D'")).containsExactly("dee");
        assertThat(uids("member.name startsWith 'd'")).as("case-sensitive").isEmpty();
        assertThat(uids("member.name | lower startsWith 'd'")).containsExactly("dee");
        assertThat(uids("member.joined startsWith '2021'")).as("a null joined never matches").containsExactly("ada");
        assertThat(uids("member.level startsWith '3'")).as("text only").isEmpty();
        assertThat(uids("member.nope startsWith ''")).as("a missing value never matches").isEmpty();
        assertThat(uids("member.name endsWith 'y'")).containsExactly("cy");
        assertThat(uids("member.name endsWith 'Y'")).as("case-sensitive").isEmpty();
        assertThat(uids("member.joined endsWith '-01'")).as("a null joined never matches").containsExactly("ada");
        assertThat(uids("member.level endsWith '5'")).as("text only").isEmpty();
        assertThat(uids("member.role contains 'ea'")).containsExactly("ada", "dee");
        assertThat(uids("member.tags contains 'vip'")).as("list membership, the mirror of in").containsExactly("ada");
        assertThat(uids("!(member.role contains 'ea') && member.name startsWith 'C'")).containsExactly("cy");
    }

    @Test
    void referencesCompareByUuid() {
        assertThat(uids("member.photo == '" + PHOTO + "'")).containsExactly("ada");
    }

    @Test
    void groupsAndBooleanOperators() {
        assertThat(uids("(member.role == 'lead' || member.level == 2) && member.active")).containsExactly("ada", "cy");
        assertThat(uids("!(member.role == 'dev')")).containsExactly("ada", "dee");
    }

    @Test
    void metaFields() {
        assertThat(uids("member._uid == 'cy'")).containsExactly("cy");
        assertThat(uids("member._folderPath == '/team/'")).containsExactly("bob", "cy");
        assertThat(uids("member._displayName == 'Dee'")).containsExactly("dee");
    }

    @Test
    void scopeValuesComeFromTheRenderer() {
        Function<Accessor, JsonNode> scope = accessor -> "CMS_PAGE".equals(accessor.path().get(0))
                ? TextNode.valueOf("dev")
                : MissingNode.getInstance();
        DatasetQuery query = query(Map.of("where", "member.role == CMS_PAGE.role"));

        assertThat(DatasetQueryEvaluator.apply(team, query, scope)).extracting(RecordView::uid).containsExactly("bob", "cy");
        assertThat(DatasetQueryEvaluator.apply(team, query, null)).isEmpty();
    }

    @Test
    void defaultOrderIsDisplayNameCaseInsensitiveThenUid() {
        assertThat(DatasetQueryEvaluator.apply(team, DatasetQuery.all("m"), null))
                .extracting(RecordView::uid)
                .containsExactly("ada", "bob", "cy", "dee");
    }

    @Test
    void multiKeySortWithTiesAndMissingLast() {
        assertThat(sorted("role,-level")).containsExactly("cy", "bob", "ada", "dee");
        assertThat(sorted("-role,-level")).containsExactly("ada", "dee", "cy", "bob");
        assertThat(sorted("-level")).containsExactly("ada", "cy", "bob", "dee");
        assertThat(sorted("level")).containsExactly("bob", "cy", "ada", "dee");
        assertThat(sorted("joined")).containsExactly("ada", "cy", "bob", "dee");
        assertThat(sorted("-joined")).containsExactly("bob", "cy", "ada", "dee");
    }

    @Test
    void offsetAndLimit() {
        assertThat(uids(Map.of("limit", "2"))).containsExactly("ada", "bob");
        assertThat(uids(Map.of("offset", "1", "limit", "2"))).containsExactly("bob", "cy");
        assertThat(uids(Map.of("offset", "3", "limit", "5"))).containsExactly("dee");
        assertThat(uids(Map.of("offset", "10"))).isEmpty();
        assertThat(uids(Map.of("limit", "0"))).isEmpty();
    }

    @Test
    void folderIsAPrefixAppliedBeforeWhere() {
        assertThat(uids(Map.of("folder", "team"))).containsExactly("ada", "bob", "cy");
        assertThat(uids(Map.of("folder", "/team/leads"))).containsExactly("ada");
        assertThat(uids(Map.of("folder", "/"))).containsExactly("ada", "bob", "cy", "dee");
        assertThat(uids(Map.of("folder", "tea"))).isEmpty();
    }

    @Test
    void orderOfOperations() {
        // folder → where → sort → offset → limit
        assertThat(uids(Map.of("folder", "team", "where", "member.active", "sort", "-name", "offset", "1", "limit", "1")))
                .containsExactly("ada");
    }

    @Test
    void countIgnoresOffsetAndLimit() {
        DatasetQuery query = query(Map.of("where", "member.role == 'dev'", "limit", "1", "offset", "1"));

        assertThat(DatasetQueryEvaluator.count(team, query.unbounded(), null)).isEqualTo(2);
        assertThat(DatasetQueryEvaluator.apply(team, query, null)).hasSize(1);
    }

    @Test
    void bareFieldMode() {
        DatasetQuery query = DatasetQueryParser.parse(Map.of("where", "role == 'lead' && _folderPath == '/alumni/'"), null, 0, 0).query();

        assertThat(DatasetQueryEvaluator.apply(team, query, null)).extracting(RecordView::uid).containsExactly("dee");
    }

    @Test
    void itemsCarryFieldsMetaAndStayShared() {
        RecordView ada = team.get(0);

        assertThat(ada.item().path("name").asText()).isEqualTo("Ada");
        assertThat(ada.item().path("_uid").asText()).isEqualTo("ada");
        assertThat(ada.item().path("_folderPath").asText()).isEqualTo("/team/leads/");
        assertThat(ada.item().path("_changedAt").asText()).isEqualTo("2026-01-01T00:00:00Z");
        assertThat(ada.item().path("_meta").path("displayName").asText()).isEqualTo("Ada");
        assertThat(ada.item()).isSameAs(ada.item());
    }

    @Test
    void stringCollationIsLocaleIndependent() {
        List<RecordView> records = new ArrayList<>();
        List<String> names = List.of("ärger", "Zebra", "apple", "Apple", "Ißmir", "iss");
        for (int i = 0; i < names.size(); i++) {
            records.add(record("n" + i, names.get(i), "/", "{}"));
        }
        java.util.Locale previous = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(java.util.Locale.forLanguageTag("tr-TR"));
            List<String> turkish = DatasetQueryEvaluator.apply(records, DatasetQuery.all("x"), null).stream()
                    .map(RecordView::displayName).toList();
            java.util.Locale.setDefault(java.util.Locale.GERMANY);
            List<String> german = DatasetQueryEvaluator.apply(records, DatasetQuery.all("x"), null).stream()
                    .map(RecordView::displayName).toList();
            assertThat(turkish).isEqualTo(german).containsExactly("Apple", "apple", "iss", "Ißmir", "Zebra", "ärger");
        } finally {
            java.util.Locale.setDefault(previous);
        }
    }

    @Test
    void maySelectDecidesByFolderAndWhereAndAssumesTheWorstForTheRenderScope() {
        RecordView bob = team.get(1);
        RecordView ada = team.get(0);

        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of()))).isTrue();
        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of("where", "member.role == 'lead'")))).isFalse();
        assertThat(DatasetQueryEvaluator.maySelect(ada, query(Map.of("where", "member.role == 'lead'")))).isTrue();
        assertThat(DatasetQueryEvaluator.maySelect(ada, query(Map.of("folder", "alumni")))).isFalse();
        // Sorting and the window come after the filter, so they never exclude a record here.
        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of("sort", "-level", "limit", "1", "offset", "3")))).isTrue();
        // The render scope is unknown while planning: CMS_PAGE.team could be anything.
        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of("where", "member.role == CMS_PAGE.team")))).isTrue();
        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of("where", "member.role == page:about.role")))).isTrue();
        // ...but a folder the record is outside of still excludes it.
        assertThat(DatasetQueryEvaluator.maySelect(bob, query(Map.of("where", "member.role == CMS_PAGE.team", "folder", "alumni"))))
                .isFalse();
    }

    // ------------------------------------------------------------------

    private List<String> uids(String where) {
        return uids(Map.of("where", where));
    }

    private List<String> uids(Map<String, String> args) {
        return DatasetQueryEvaluator.apply(team, query(args), null).stream().map(RecordView::uid).toList();
    }

    private List<String> sorted(String sort) {
        return uids(Map.of("sort", sort));
    }

    private static DatasetQuery query(Map<String, String> args) {
        DatasetQueryParser.Result result = DatasetQueryParser.parse(args, "member", 1, 1);
        assertThat(result.diagnostics()).as("diagnostics for %s", args).isEmpty();
        return result.query();
    }

    static RecordView record(String uid, String displayName, String folder, String content) {
        try {
            return new RecordView(
                    UUID.nameUUIDFromBytes(uid.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    uid,
                    displayName,
                    folder,
                    "team",
                    Instant.parse("2026-01-01T00:00:00Z"),
                    MAPPER.readTree(content));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
