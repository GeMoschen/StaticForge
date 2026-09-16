package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlNode;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.octl.ReferenceUse;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** {@code M19.3.2}: compiling and rendering {@code $CMS_FOR(x : dataset:uid, …)$}, record values and dereferencing. */
class DatasetLoopRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID TEAM = UUID.fromString("d0000000-0000-0000-0000-000000000001");
    private static final UUID PAGE = UUID.fromString("d0000000-0000-0000-0000-000000000002");

    private static final ContentDefinition TEAM_SCHEMA = new CdlCompiler().compile("""
            content {
              editor text name { label "Name" }
              editor text role { label "Role" }
              editor list tags { label "Tags" item { editor text tag { label "Tag" } } }
            }
            """).definition();

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    /** Resolves {@code dataset:team}, {@code page:about} and {@code record:*}; knows the team schema. */
    private final ReferenceResolver saveResolver = new ReferenceResolver() {
        @Override
        public Optional<UUID> resolve(String assetType, String uid) {
            return switch (assetType + ":" + uid) {
                case "dataset:team" -> Optional.of(TEAM);
                case "page:about" -> Optional.of(PAGE);
                default -> Optional.empty();
            };
        }

        @Override
        public Optional<ContentDefinition> datasetDefinition(UUID datasetUuid) {
            return TEAM.equals(datasetUuid) ? Optional.of(TEAM_SCHEMA) : Optional.empty();
        }
    };

    @Test
    void queryIsCompiledOnceAndAttachedToTheLoop() {
        OctlResult result = compile("$CMS_FOR(m : dataset:team, where=\"m.role == 'lead'\", sort=\"-name\", limit=2)$x$CMS_END_FOR$");

        assertThat(result.hasErrors()).isFalse();
        OctlNode.For loop = (OctlNode.For) result.template().nodes().get(0);
        assertThat(result.template().datasetQuery(loop)).satisfies(q -> {
            assertThat(q.variable()).isEqualTo("m");
            assertThat(q.limit()).isEqualTo(2);
        });
        assertThat(result.template().referenceUses()).isEqualTo(Map.of("dataset:team", Set.of(ReferenceUse.VALUE)));
    }

    @Test
    void theLoopsOverADatasetAreListedByUidIncludingNestedOnes() {
        OctlResult result = new OctlCompiler().compile("""
                $CMS_FOR(m : dataset:team, where="m.role == 'lead'")$\
                $CMS_IF(m.name)$$CMS_FOR(t : dataset:team, folder="alumni")$x$CMS_END_FOR$$CMS_END_IF$\
                $CMS_END_FOR$$CMS_FOR(p : dataset:products)$y$CMS_END_FOR$""", "html", null);

        assertThat(result.template().datasetQueries("team"))
                .extracting(q -> q.variable())
                .containsExactlyInAnyOrder("m", "t");
        assertThat(result.template().datasetQueries("products")).hasSize(1);
        assertThat(result.template().datasetQueries("nope")).isEmpty();
    }

    @Test
    void assetReferencesInsideWhereAreReferencesOfTheTemplate() {
        OctlResult result = compile("$CMS_FOR(m : dataset:team, where=\"m.role == page:about.role\")$x$CMS_END_FOR$");

        assertThat(result.hasErrors()).isFalse();
        assertThat(result.template().references()).containsKeys("dataset:team", "page:about");
        assertThat(result.template().referenceUses().get("page:about")).containsExactly(ReferenceUse.VALUE);
    }

    @Test
    void invalidArgumentsAreCompileErrorsAtTheInstruction() {
        OctlResult result = compile("<ul>\n  $CMS_FOR(m : dataset:team, where=\"m.role ==\", limit=-3, color=red)$x$CMS_END_FOR$");

        assertThat(errors(result)).extracting(Diagnostic::code).containsOnly(DiagnosticCodes.OCTL_DATASET_QUERY).hasSize(3);
        assertThat(errors(result)).extracting(Diagnostic::line).containsOnly(2);
        assertThat(errors(result)).extracting(Diagnostic::column).containsOnly(3);
    }

    @Test
    void aPathOnTheDatasetSourceIsAnError() {
        assertThat(errors(compile("$CMS_FOR(m : dataset:team.records)$x$CMS_END_FOR$")))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_DATASET_QUERY);
    }

    @Test
    void anUnknownDatasetIsUnresolvable() {
        assertThat(errors(compile("$CMS_FOR(m : dataset:nope)$x$CMS_END_FOR$")))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    @Test
    void fieldsAreCheckedAgainstTheSchemaOnlyWhenTheResolverKnowsIt() {
        String source = "$CMS_FOR(x : dataset:team, where=\"x.nope == 1\", sort=\"tags\")$x$CMS_END_FOR$";

        assertThat(errors(compile(source)))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_DATASET_UNKNOWN_FIELD, DiagnosticCodes.OCTL_DATASET_UNSORTABLE_FIELD);
        ReferenceResolver renderTime = (type, uid) -> saveResolver.resolve(type, uid);
        assertThat(compiler.compile(source, "html", renderTime).hasErrors()).isFalse();
    }

    @Test
    void whereScopeAccessorsAreCheckedLikeAnyOtherAccessor() {
        ContentDefinition pageSchema = new CdlCompiler().compile("content { editor text team { label \"Team\" } }").definition();

        assertThat(compiler.compile(
                        "$CMS_FOR(x : dataset:team, where=\"x.role == team && x.name == nope | lower\")$x$CMS_END_FOR$",
                        "html", saveResolver, pageSchema).diagnostics())
                .filteredOn(d -> d.severity() == Severity.ERROR)
                .extracting(Diagnostic::message)
                .containsExactly("Unknown editor name: nope");
        assertThat(errors(compile("$CMS_FOR(x : dataset:team, where=\"x.role | nofilter\")$x$CMS_END_FOR$")))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_UNKNOWN_FILTER);
    }

    @Test
    void recordsAndDatasetsHaveNoUrl() {
        ReferenceResolver resolver = (type, uid) -> Optional.of(UUID.nameUUIDFromBytes((type + uid).getBytes()));

        assertThat(compiler.compile("$CMS_REF(record:jane)$", "html", resolver).diagnostics())
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
        assertThat(compiler.compile("$CMS_REF(dataset:team)$", "html", resolver).diagnostics())
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
        assertThat(compiler.compile("$CMS_REF(record:jane.website)$", "html", resolver).hasErrors()).isFalse();
    }

    @Test
    void whereReadsTheRenderScope() {
        List<RecordView> team = List.of(
                record("ada", "{\"name\":\"Ada\",\"role\":\"lead\"}"),
                record("bob", "{\"name\":\"Bob\",\"role\":\"dev\"}"));
        OctlResult result = compile(
                "$CMS_SET(wanted = 'dev')$$CMS_FOR(x : dataset:team, where=\"x.role == wanted || x.role == CMS_PAGE.role\")$"
                        + "[$CMS_VALUE(x.name)$]$CMS_END_FOR$");

        String output = render(result, team, MAPPER.createObjectNode().put("role", "lead"));

        assertThat(output).isEqualTo("[Ada][Bob]");
    }

    @Test
    void aDatasetLoopDependsOnTheDataset() {
        OctlResult result = compile("$CMS_FOR(x : dataset:team)$$CMS_VALUE(x.name)$$CMS_END_FOR$");

        RenderResult rendered = renderer.render(result.template(), context(List.of(record("ada", "{\"name\":\"Ada\"}")), null));

        assertThat(rendered.dependencies()).contains(TEAM);
    }

    @Test
    void theLoopIterationLimitAppliesToDatasetLoops() {
        List<RecordView> many = new ArrayList<>();
        for (int i = 0; i < RenderBudget.MAX_LOOP_ITERATIONS + 1; i++) {
            many.add(record("r" + i, "{}"));
        }
        OctlResult result = compile("$CMS_FOR(x : dataset:team)$.$CMS_END_FOR$");

        assertThatThrownBy(() -> renderer.render(result.template(), context(many, null)))
                .isInstanceOf(RenderLimitException.class)
                .satisfies(e -> assertThat(((RenderLimitException) e).diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_LOOP_LIMIT));
    }

    @Test
    void withoutAResolverADatasetLoopRendersNothing() {
        OctlResult result = compile("[$CMS_FOR(x : dataset:team)$x$CMS_END_FOR$]");

        assertThat(renderer.render(result.template(), RenderContext.builder().channel("html").build()).output())
                .isEqualTo("[]");
    }

    @Test
    void onlyRecordReferencesAreDereferencedAndOwnFieldsWin() throws Exception {
        RecordView ada = record("ada", "{\"name\":\"Ada\",\"uuid\":\"shadowed\"}");
        AtomicInteger lookups = new AtomicInteger();
        AssetValueResolver values = (type, uuid) -> {
            lookups.incrementAndGet();
            return uuid.equals(ada.uuid()) ? ada.item() : MissingNode.getInstance();
        };
        JsonNode content = MAPPER.readTree("{"
                + "\"author\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + ada.uuid() + "\",\"assetType\":\"RECORD\"},"
                + "\"page\":{\"type\":\"ASSET_REF\",\"uuid\":\"" + ada.uuid() + "\",\"assetType\":\"PAGE\"}}");
        OctlResult result = compiler.compile(
                "$CMS_VALUE(author.name)$|$CMS_VALUE(author.uuid)$|$CMS_VALUE(page.name)$", "html", null);

        RenderResult rendered = renderer.render(result.template(), RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .values(content)
                .assetValueResolver(values)
                .build());

        assertThat(rendered.output()).isEqualTo("Ada|" + ada.uuid() + "|");
        assertThat(rendered.dependencies()).contains(ada.uuid());
        assertThat(lookups).hasValue(1);
    }

    // ------------------------------------------------------------------

    private OctlResult compile(String source) {
        return compiler.compile(source, "html", saveResolver);
    }

    private static List<Diagnostic> errors(OctlResult result) {
        return result.diagnostics().stream().filter(d -> d.severity() == Severity.ERROR).toList();
    }

    private String render(OctlResult result, List<RecordView> records, JsonNode pageValues) {
        assertThat(errors(result)).isEmpty();
        return renderer.render(result.template(), context(records, pageValues)).output();
    }

    private static RenderContext context(List<RecordView> records, JsonNode pageValues) {
        RenderContext.Builder builder = RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .assetValueResolver(new AssetValueResolver() {
                    @Override
                    public JsonNode valueOf(String assetType, UUID uuid) {
                        return MissingNode.getInstance();
                    }

                    @Override
                    public List<RecordView> datasetRecords(UUID datasetUuid) {
                        return TEAM.equals(datasetUuid) ? records : List.of();
                    }
                });
        if (pageValues != null) {
            builder.pageValues(pageValues);
        }
        return builder.build();
    }

    private static RecordView record(String uid, String content) {
        try {
            return new RecordView(
                    UUID.nameUUIDFromBytes(uid.getBytes()), uid, uid, "/", Instant.EPOCH, MAPPER.readTree(content));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
