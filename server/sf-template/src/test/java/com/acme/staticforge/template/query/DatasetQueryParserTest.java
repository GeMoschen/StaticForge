package com.acme.staticforge.template.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.OctlExpressions;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** {@code M19.3.1}: parsing and validating dataset loop arguments. */
class DatasetQueryParserTest {

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

    @Test
    void parsesEveryArgument() {
        DatasetQueryParser.Result result = parse(Map.of(
                "where", "member.role == 'lead' && member.level >= 2",
                "sort", "name,-joined",
                "limit", "6",
                "offset", "2",
                "folder", "team/leads"));

        assertThat(result.diagnostics()).isEmpty();
        DatasetQuery query = result.query();
        assertThat(query.variable()).isEqualTo("member");
        assertThat(query.where()).isInstanceOf(Expr.And.class);
        assertThat(query.sort()).containsExactly(SortKey.asc("name"), SortKey.desc("joined"));
        assertThat(query.limit()).isEqualTo(6);
        assertThat(query.offset()).isEqualTo(2);
        assertThat(query.folder()).isEqualTo("/team/leads/");
    }

    @Test
    void quotesInsideWhereSurvive() {
        DatasetQueryParser.Result result = parse(Map.of("where", "member.name == \"O'Brien\" || member.name == 'Say \\\"hi\\\"'"));

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.query().where()).isInstanceOf(Expr.Or.class);
    }

    @Test
    void invalidArgumentsAreDiagnosticsAtTheInstruction() {
        DatasetQueryParser.Result result = parse(new LinkedHashMap<>(Map.of(
                "where", "member.role ==",
                "sort", "name,,joined",
                "limit", "-1",
                "offset", "x",
                "colour", "red")));

        assertThat(result.hasErrors()).isTrue();
        assertThat(result.diagnostics()).extracting(Diagnostic::code).containsOnly(DiagnosticCodes.OCTL_DATASET_QUERY);
        assertThat(result.diagnostics()).extracting(Diagnostic::line).containsOnly(3);
        assertThat(result.diagnostics()).extracting(Diagnostic::column).containsOnly(7);
        assertThat(result.diagnostics()).extracting(Diagnostic::message).anySatisfy(m -> assertThat(m).startsWith("Invalid where"))
                .anySatisfy(m -> assertThat(m).startsWith("Invalid sort"))
                .anySatisfy(m -> assertThat(m).contains("limit must be a non-negative integer"))
                .anySatisfy(m -> assertThat(m).contains("offset must be a non-negative integer"))
                .anySatisfy(m -> assertThat(m).contains("Unknown dataset loop argument 'colour'"));
    }

    @Test
    void whereErrorsCarryTheColumnInsideTheExpression() {
        assertThat(OctlExpressions.parse("member.role == 'lead' )")).satisfies(p -> {
            assertThat(p.ok()).isFalse();
            assertThat(p.column()).isEqualTo(23);
        });
        assertThat(OctlExpressions.parse("(member.role == 'lead'")).satisfies(p -> assertThat(p.column()).isEqualTo(1));
        assertThat(OctlExpressions.parse("member.name == 'open")).satisfies(p -> {
            assertThat(p.error()).isEqualTo("Unterminated string");
            assertThat(p.column()).isEqualTo(16);
        });
        assertThat(OctlExpressions.parse("member.role lead")).satisfies(p -> {
            assertThat(p.error()).startsWith("Unexpected input 'lead'");
            assertThat(p.column()).isEqualTo(13);
        });
        assertThat(OctlExpressions.parse("   ").ok()).isFalse();
        assertThat(OctlExpressions.parse("!member.active && member.role in ['lead', 'cto']").ok()).isTrue();
    }

    @Test
    void zeroLimitIsValid() {
        assertThat(parse(Map.of("limit", "0")).query().limit()).isZero();
    }

    @Test
    void validatesFieldsAgainstTheSchema() {
        DatasetQuery query = parse(Map.of(
                        "where", "member.nope == 1 || member._uid == 'x' || member.role == CMS_PAGE.role",
                        "sort", "-joined,_displayName,bio,missing,tags"))
                .query();

        List<Diagnostic> diagnostics = DatasetQueryParser.validateFields(query, TEAM, 3, 7);

        assertThat(diagnostics).extracting(Diagnostic::message).containsExactly(
                "Unknown dataset field in where: nope",
                "Cannot sort by bio: richtext editors have no order",
                "Unknown dataset field in sort: missing",
                "Cannot sort by tags: list editors have no order");
        assertThat(diagnostics).extracting(Diagnostic::code).containsExactly(
                DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD,
                DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD,
                DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD);
    }

    @Test
    void scopeAccessesAreTheOnesNotRootedAtTheLoopVariable() {
        DatasetQuery query = parse(Map.of("where", "member.role == CMS_PAGE.role && member.level > minLevel")).query();

        assertThat(DatasetQueryParser.whereFields(query)).containsExactly("role", "level");
        assertThat(DatasetQueryParser.scopeAccesses(query))
                .extracting(a -> String.join(".", a.accessor().path()))
                .containsExactly("CMS_PAGE.role", "minLevel");
    }

    @Test
    void bareFieldModeRejectsAssetReferences() {
        DatasetQueryParser.Result result = DatasetQueryParser.parse(Map.of("where", "role == page:about.role"), null, 0, 0);

        assertThat(result.diagnostics()).extracting(Diagnostic::message)
                .containsExactly("Asset references are not available in this where expression: page:about");
        assertThat(DatasetQueryParser.whereFields(
                        DatasetQueryParser.parse(Map.of("where", "role == 'lead'"), null, 0, 0).query()))
                .containsExactly("role");
    }

    private static DatasetQueryParser.Result parse(Map<String, String> args) {
        return DatasetQueryParser.parse(args, "member", 3, 7);
    }
}
