package com.acme.staticforge.template.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlExpressions;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** M25.1.2: validating, evaluating and renaming a record set's stored query. */
class RecordSetQueriesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final ContentDefinition TEAM = new CdlCompiler().compile("""
            content {
              editor text name { label "Name" required }
              editor select role { label "Role" options [ { value "lead", label "Lead" }, { value "dev", label "Dev" } ] }
              editor date joined { label "Joined" }
              editor number level { label "Level" }
              editor list tags { label "Tags" item { editor text tag { label "Tag" } } }
              editor richtext bio { label "Bio" }
            }
            """).definition();

    private static RecordSetQueries.Compiled compile(String where, String sort, Integer limit, Integer offset) {
        return RecordSetQueries.compile(new RecordSetQuery(where, sort, limit, offset), TEAM);
    }

    private static JsonNode json(String raw) {
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static RecordView member(String uid, String role, int level, String joined) {
        return new RecordView(UUID.randomUUID(), uid, uid, "/team/", "staff", Instant.parse("2026-01-01T00:00:00Z"),
                json("{\"name\":\"%s\",\"role\":\"%s\",\"level\":%d,\"joined\":\"%s\"}".formatted(uid, role, level, joined)));
    }

    private static List<String> uids(List<RecordView> records) {
        return records.stream().map(RecordView::uid).toList();
    }

    @Nested
    @DisplayName("validation")
    class Validation {

        @Test
        void aValidQueryHasNoDiagnostics() {
            RecordSetQueries.Compiled compiled = compile("role == 'lead' && level >= 2", "-joined,name", 3, 1);

            assertThat(compiled.valid()).isTrue();
            assertThat(compiled.diagnostics()).isEmpty();
            assertThat(compiled.query().variable()).isNull();
            assertThat(compiled.query().sort()).containsExactly(SortKey.desc("joined"), SortKey.asc("name"));
            assertThat(compiled.query().limit()).isEqualTo(3);
            assertThat(compiled.query().offset()).isEqualTo(1);
            assertThat(RecordSetQueries.isValid(RecordSetQuery.ALL, TEAM)).isTrue();
            assertThat(RecordSetQueries.isValid(null, TEAM)).isTrue();
        }

        @Test
        void metaFieldsAndNestedPathsAreFields() {
            assertThat(compile("_uid != 'x' && _recordSet == 'staff' && tags.first == 'a'", "_changedAt", null, null).valid())
                    .isTrue();
        }

        @Test
        void anUnknownFieldIsSfTpl0141AtItsPosition() {
            RecordSetQueries.Compiled compiled = compile("role == 'lead' && team == 'core'", "-joined", null, null);

            assertThat(compiled.valid()).isFalse();
            assertThat(compiled.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.field()).isEqualTo("where");
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD);
                assertThat(d.severity()).isEqualTo(Severity.ERROR);
                assertThat(d.message()).contains("team");
                assertThat(d.line()).isEqualTo(1);
                assertThat(d.column()).isEqualTo(19);
            });
        }

        @Test
        void aFieldNameInsideAStringIsNotAPosition() {
            RecordSetQueries.Compiled compiled = compile("name == 'team' || team == 'x'", null, null, null);

            assertThat(compiled.diagnostics()).singleElement().satisfies(d -> assertThat(d.column()).isEqualTo(19));
        }

        @Test
        void aPositionOnALaterLineCountsLines() {
            RecordSetQueries.Compiled compiled = compile("role == 'lead'\n  && squad == 'x'", null, null, null);

            assertThat(compiled.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.line()).isEqualTo(2);
                assertThat(d.column()).isEqualTo(6);
            });
        }

        @Test
        void theRenderScopeIsRejected() {
            RecordSetQueries.Compiled page = compile("role == CMS_PAGE.team", null, null, null);
            RecordSetQueries.Compiled pagination = compile("level > CMS_PAGINATION.page", null, null, null);
            RecordSetQueries.Compiled reference = compile("role == page:home.role", null, null, null);
            RecordSetQueries.Compiled global = compile("role == CMS_GLOBAL.site.role", null, null, null);
            // A $CMS_SET variable is just a name that is not a field.
            RecordSetQueries.Compiled variable = compile("role == wanted", null, null, null);

            assertThat(page.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY);
                assertThat(d.message()).contains("render scope").contains("CMS_PAGE");
                assertThat(d.column()).isEqualTo(9);
            });
            assertThat(pagination.diagnostics()).singleElement()
                    .satisfies(d -> assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY));
            assertThat(reference.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY);
                assertThat(d.message()).contains("page:home");
                assertThat(d.column()).isEqualTo(9);
            });
            assertThat(global.diagnostics()).singleElement()
                    .satisfies(d -> assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY));
            assertThat(variable.diagnostics()).singleElement()
                    .satisfies(d -> assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
        }

        @Test
        void aMalformedWhereIsSfTpl0140AtTheParserColumn() {
            RecordSetQueries.Compiled compiled = compile("role == 'lead' )", null, null, null);

            assertThat(compiled.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.field()).isEqualTo("where");
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY);
                assertThat(d.column()).isEqualTo(16);
            });
        }

        @Test
        void anUnsortableFieldIsSfTpl0142() {
            RecordSetQueries.Compiled compiled = compile(null, "name, -bio", null, null);

            assertThat(compiled.diagnostics()).singleElement().satisfies(d -> {
                assertThat(d.field()).isEqualTo("sort");
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD);
                assertThat(d.message()).contains("bio").contains("richtext");
                assertThat(d.column()).isEqualTo(8);
            });
            assertThat(compile(null, "squad", null, null).diagnostics()).singleElement()
                    .satisfies(d -> assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD));
            assertThat(compile(null, "name,,level", null, null).diagnostics()).singleElement()
                    .satisfies(d -> assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY));
        }

        @Test
        void aNegativeLimitOrOffsetIsSfTpl0140() {
            RecordSetQueries.Compiled compiled = compile(null, null, -1, -2);

            assertThat(compiled.valid()).isFalse();
            assertThat(compiled.diagnostics()).extracting(RecordSetQueryDiagnostic::field).containsExactly("limit", "offset");
            assertThat(compiled.diagnostics()).allSatisfy(d -> {
                assertThat(d.code()).isEqualTo(DiagnosticCodes.OCTL_DATASET_QUERY);
                assertThat(d.column()).isZero();
            });
            assertThat(compile(null, null, 0, 0).valid()).isTrue();
        }

        @Test
        void withoutADefinitionOnlyTheGrammarIsChecked() {
            assertThat(RecordSetQueries.isValid(new RecordSetQuery("anything == 1", "whatever", null, null), null)).isTrue();
            assertThat(RecordSetQueries.isValid(new RecordSetQuery("CMS_PAGE.x == 1", null, null, null), null)).isFalse();
        }

        @Test
        void theInvalidQueryWarningNamesTheSetAndTheReason() {
            Diagnostic warning = RecordSetQueries.invalidQueryWarning("leads", compile(null, "-squad", null, null));

            assertThat(warning.code()).isEqualTo("SF-GEN-0240");
            assertThat(warning.severity()).isEqualTo(Severity.WARNING);
            assertThat(warning.message()).contains("leads").contains("sort: Unknown dataset field in sort: squad");
        }
    }

    @Nested
    @DisplayName("evaluation")
    class Evaluation {

        private final List<RecordView> team = List.of(
                member("ann", "lead", 3, "2021-03-01"),
                member("bob", "dev", 1, "2022-01-01"),
                member("cyd", "lead", 2, "2019-06-01"),
                member("dan", "lead", 5, "2024-02-01"),
                member("eve", "dev", 4, "2020-01-01"));

        @Test
        void whereSortOffsetLimitInThatOrder() {
            List<RecordView> selected =
                    RecordSetQueries.select(team, compile("role == 'lead'", "-joined", 2, 1), List.of());

            assertThat(uids(selected)).containsExactly("ann", "cyd");
        }

        @Test
        void theEmptyQuerySelectsEveryRecordByDisplayName() {
            assertThat(uids(RecordSetQueries.select(team, compile(null, null, null, null), List.of())))
                    .containsExactly("ann", "bob", "cyd", "dan", "eve");
        }

        @Test
        void anInvalidQuerySelectsNothingNeverEverything() {
            RecordSetQueries.Compiled broken = compile("squad == 'x'", null, null, null);

            assertThat(RecordSetQueries.select(team, broken, List.of())).isEmpty();
            assertThat(RecordSetQueries.count(team, broken, List.of())).isZero();
            assertThat(RecordSetQueries.maySelect(team.get(0), broken, null, List.of())).isFalse();
        }

        @Test
        void countIsTheMatchBeforeSlicing() {
            assertThat(RecordSetQueries.count(team, compile("role == 'lead'", null, 1, null), List.of())).isEqualTo(3);
        }

        @Test
        void narrowingAndsWhereResortsAndSlicesTheSetResult() {
            RecordSetQueries.Compiled leadsByJoined = compile("role == 'lead'", "-joined", 3, null);

            List<RecordView> kept = RecordSetQueries.select(team, leadsByJoined, List.of(),
                    new DatasetQuery(null, OctlExpressions.parse("level >= 3").expr(), List.of(), null, null, null), null);
            List<RecordView> resorted = RecordSetQueries.select(team, leadsByJoined, List.of(),
                    new DatasetQuery(null, null, List.of(SortKey.asc("level")), 2, null, null), null);

            // The set picks dan, ann, cyd; narrowing keeps the set's order without a sort of its own.
            assertThat(uids(kept)).containsExactly("dan", "ann");
            assertThat(uids(resorted)).containsExactly("cyd", "ann");
        }

        @Test
        void languageDependentFieldsResolveForTheChain() {
            RecordView parka = new RecordView(UUID.randomUUID(), "parka", "Parka", "/", "shop", null,
                    json("{\"name\":{\"type\":\"L10N\",\"values\":{\"de\":\"Jacke\",\"en\":\"Jacket\"}}}"));
            RecordSetQueries.Compiled jacket = compile("name == 'Jacket'", null, null, null);

            assertThat(RecordSetQueries.select(List.of(parka), jacket, List.of("en", "de"))).hasSize(1);
            assertThat(RecordSetQueries.select(List.of(parka), jacket, List.of("de"))).isEmpty();
            // The planner asks across every language of the project.
            assertThat(RecordSetQueries.maySelect(parka, jacket, null, List.of(List.of("de"), List.of("en", "de")))).isTrue();
            assertThat(RecordSetQueries.maySelect(parka, jacket, null, List.of(List.of("de")))).isFalse();
        }

        @Test
        void maySelectHonoursTheSetWhereAndTheNarrowing() {
            RecordSetQueries.Compiled leads = compile("role == 'lead'", "-joined", 1, null);
            DatasetQuery seniors = new DatasetQuery(null, OctlExpressions.parse("level >= 3").expr(), List.of(), null, null, null);

            assertThat(RecordSetQueries.maySelect(team.get(0), leads, null, List.of())).isTrue();
            assertThat(RecordSetQueries.maySelect(team.get(1), leads, null, List.of())).isFalse();
            assertThat(RecordSetQueries.maySelect(team.get(0), leads, seniors, List.of())).isTrue();
            assertThat(RecordSetQueries.maySelect(team.get(2), leads, seniors, List.of())).isFalse();
        }
    }

    @Nested
    @DisplayName("schema rename")
    class Rename {

        @Test
        void renamesAccessorRootsAndSortKeys() {
            RecordSetQuery renamed = RecordSetQueries.rename(
                    new RecordSetQuery("role == 'lead' && !(level < 2)", "-role,name", 3, 1), Map.of("role", "position"));

            assertThat(renamed).isEqualTo(new RecordSetQuery("position == 'lead' && !(level < 2)", "-position,name", 3, 1));
        }

        @Test
        void aStringLiteralSpellingAFieldNameSurvives() {
            RecordSetQuery renamed = RecordSetQueries.rename(
                    new RecordSetQuery("role == 'role' || name in ['role', \"x\"]", null, null, null), Map.of("role", "position"));

            assertThat(renamed.where()).isEqualTo("position == 'role' || name in ['role', 'x']");
        }

        @Test
        void pathsFiltersAndMetaFieldsAreKept() {
            RecordSetQuery renamed = RecordSetQueries.rename(
                    new RecordSetQuery("tags.role|lower == 'a' && _uid != 'role'", "_displayName", null, null),
                    Map.of("tags", "labels", "role", "position", "_uid", "id"));

            assertThat(renamed.where()).isEqualTo("labels.role|lower == 'a' && _uid != 'role'");
            assertThat(renamed.sort()).isEqualTo("_displayName");
        }

        @Test
        void aQueryWithoutRenamedFieldsIsReturnedAsIs() {
            RecordSetQuery query = new RecordSetQuery("level   >=   2", "name", null, null);

            assertThat(RecordSetQueries.rename(query, Map.of("role", "position"))).isSameAs(query);
            assertThat(RecordSetQueries.rename(RecordSetQuery.ALL, Map.of("role", "position"))).isSameAs(RecordSetQuery.ALL);
        }

        @Test
        void anUnparsableWhereIsLeftUntouched() {
            RecordSetQuery renamed = RecordSetQueries.rename(
                    new RecordSetQuery("role == (", "role", null, null), Map.of("role", "position"));

            assertThat(renamed.where()).isEqualTo("role == (");
            assertThat(renamed.sort()).isEqualTo("position");
        }
    }

    @Nested
    @DisplayName("printing")
    class Printing {

        @Test
        void printedExpressionsParseToTheSameTree() {
            for (String source : List.of(
                    "role == 'lead'",
                    "a == 1 || b != 2.5 && !(c < -3)",
                    "name == \"O'Brien\" || name == 'back\\\\slash\\nline'",
                    "tags in ['a', 1, true] && 'x' in name",
                    "name|truncate(40, '...')|lower == 'x'",
                    "!done && (x >= 2 || y <= 3) && z > 1 && w < 0",
                    "joined > '2024-01-01' && value == null && flag == false",
                    "page:home.title == name")) {
                OctlExpressions.Parsed parsed = OctlExpressions.parse(source);
                assertThat(parsed.ok()).as(source).isTrue();
                String printed = OctlExpressions.print(parsed.expr());
                OctlExpressions.Parsed reparsed = OctlExpressions.parse(printed);
                assertThat(reparsed.ok()).as(printed).isTrue();
                assertThat(reparsed.expr()).as(printed).isEqualTo(parsed.expr());
            }
        }
    }
}
